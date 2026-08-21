import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail, useProductos } from '../../hooks/useMasas';
import { useCompletarFase } from '../../hooks/useFases';
import { useMaquinasCorte } from '../../hooks/useConfig';
import { ModalMO } from '../../components/common/ModalMO';
import { BarraNavegacionFases } from '../../components/common/BarraNavegacionFases';
import { upqDesdeProducto } from '../../utils/unidadesPorPaquete';

export const DivisionMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const masaIdNum = Number(masaId);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaIdNum);
  const { data: productos, isLoading: loadingProductos } = useProductos(masaIdNum);
  const { data: maquinasCorte } = useMaquinasCorte();
  const completarMutation = useCompletarFase();

  const [showMO, setShowMO] = useState(false);
  const [formData, setFormData] = useState({
    maquina_corte_id: '',
    temperatura_entrada: '',
    requiere_reposo: false,
    hora_inicio_reposo: '',
    hora_fin_reposo: '',
    observaciones: '',
  });

  const [cantidadesDivididas, setCantidadesDivididas] = useState<Record<number, number>>({});

  // Prellenar cantidades ya guardadas (ej. división parcial guardada previamente)
  // para que el input no aparezca vacío al volver a consultar mientras sigue en DIVISION.
  useEffect(() => {
    if (masa?.fase_actual === 'DIVISION' && productos && (productos as any[]).length > 0) {
      setCantidadesDivididas(prev => {
        if (Object.keys(prev).length > 0) return prev; // no pisar lo que el usuario ya está editando
        const inicial: Record<number, number> = {};
        for (const p of productos as any[]) {
          if (Number(p.unidades_producidas) > 0) inicial[p.id] = Number(p.unidades_producidas);
        }
        return inicial;
      });
    }
  }, [masa?.fase_actual, productos]);

  // Preseleccionar la primera máquina del catálogo al cargar, sin pisar una
  // selección que el usuario ya haya hecho.
  useEffect(() => {
    if (maquinasCorte && maquinasCorte.length > 0) {
      setFormData(prev =>
        prev.maquina_corte_id ? prev : { ...prev, maquina_corte_id: String(maquinasCorte[0].id) }
      );
    }
  }, [maquinasCorte]);

  // ── Helpers ────────────────────────────────────────────────────

  const calcularTiempoReposo = () => {
    if (!formData.hora_inicio_reposo || !formData.hora_fin_reposo) return 0;
    const inicio = new Date(formData.hora_inicio_reposo).getTime();
    const fin    = new Date(formData.hora_fin_reposo).getTime();
    const minutos = Math.round((fin - inicio) / 1000 / 60);
    return minutos > 0 ? minutos : 0;
  };

  /**
   * Retorna el mínimo requerido para cortar: unidades_ajustadas si existe,
   * sino unidades_programadas.
   */
  const getMinimoRequerido = (producto: any): number => {
    const ajustadas  = parseInt(producto.unidades_ajustadas || 0);
    const programadas = parseInt(producto.unidades_programadas || 0);
    return ajustadas > 0 ? ajustadas : programadas;
  };

  /**
   * FIX B5 (2026-08-04): panes sugeridos a cortar, redondeados al múltiplo
   * del divisor de la máquina (multiplo_divisor, en PANES — no confundir con
   * unidades_ajustadas del backend, que redondea PAQUETES y no aplica aquí).
   * Antes esta pantalla sugería el bruto sin redondear (ej. 130 con divisor
   * 20), lo cual no es cortable en la máquina — el usuario tenía que darse
   * cuenta solo al chocar con el error de validación al guardar.
   * Ej: 130 panes, divisor 20 → sugiere 140.
   */
  const getPanesSugeridos = (producto: any): number => {
    const xPaq = upqDesdeProducto(producto.unidades_por_paquete, producto.producto_nombre);
    const programadas = parseInt(producto.unidades_programadas || producto.unidades_pedidas || 0);
    const panesBrutos = programadas * xPaq;
    const divisor = parseInt(producto.multiplo_divisor || 0);
    if (divisor > 0 && panesBrutos % divisor !== 0) {
      return (Math.floor(panesBrutos / divisor) + 1) * divisor;
    }
    return panesBrutos;
  };

  /**
   * Valida la cantidad ingresada para un producto.
   * Retorna null si es válida, o string con el mensaje de error.
   */
  const validarCantidad = (producto: any, cantidad: number): string | null => {
    if (cantidad <= 0) return null; // Aún no ingresó nada

    const divisor = parseInt(producto.multiplo_divisor || 0);

    // Solo validar múltiplo cuando aplica — cantidad menor al proyectado
    // es válida (cubre OVs de repetición y producción parcial)
    if (divisor > 0 && cantidad % divisor !== 0) {
      const inferior = Math.floor(cantidad / divisor) * divisor;
      const superior = inferior + divisor;
      return `Debe ser múltiplo de ${divisor}. Cercanos: ${inferior} o ${superior}`;
    }

    return null;
  };

  const handleCantidadChange = (productoId: number, cantidad: string) => {
    setCantidadesDivididas({
      ...cantidadesDivididas,
      [productoId]: Number(cantidad) || 0,
    });
  };

  const hayErroresValidacion = (): boolean => {
    if (!productos) return false;
    return (productos as any[]).some((p: any) => {
      const cantidad = cantidadesDivididas[p.id] || 0;
      if (cantidad <= 0) return false;
      return validarCantidad(p, cantidad) !== null;
    });
  };

  const todasTienenCantidad = (): boolean => {
    if (!productos || (productos as any[]).length === 0) return false;
    return (productos as any[]).every((p: any) => (cantidadesDivididas[p.id] || 0) > 0);
  };

  // ── Submit ─────────────────────────────────────────────────────

  const handleCompletar = async () => {
    if (!formData.temperatura_entrada) {
      alert('Por favor ingresa la temperatura de entrada');
      return;
    }

    if (formData.requiere_reposo && (!formData.hora_inicio_reposo || !formData.hora_fin_reposo)) {
      alert('Por favor registra las horas de inicio y fin del reposo');
      return;
    }

    if (!productos || (productos as any[]).length === 0) {
      alert('No hay productos para dividir');
      return;
    }

    const erroresFinal: string[] = [];

    for (const p of productos as any[]) {
      const cantidad  = cantidadesDivididas[p.id] || 0;
      const minimo    = getMinimoRequerido(p);
      const divisor   = parseInt(p.multiplo_divisor || 0);
      const nombre    = `${p.producto_nombre}${p.presentacion ? ' ' + p.presentacion : ''}`;

      if (cantidad <= 0) {
        erroresFinal.push(`"${nombre}": debe ingresar la cantidad a cortar (mínimo ${minimo}).`);
        continue;
      }
      // Advertencia informativa si se cortan menos del proyectado (no bloquea)
      if (cantidad < minimo) {
        erroresFinal.push(`⚠️ "${nombre}": se cortaron ${cantidad} de ${minimo} proyectadas (faltante: ${minimo - cantidad}). Esto se registrará como división parcial.`);
      }
      if (divisor > 0 && cantidad % divisor !== 0) {
        const inferior = Math.floor(cantidad / divisor) * divisor;
        const superior = inferior + divisor;
        erroresFinal.push(
          `❌ "${nombre}": ${cantidad} no es múltiplo de ${divisor}. Valores válidos: ${inferior} o ${superior}.`
        );
      }
    }

    const erroresBlockeantes = erroresFinal.filter(e => e.startsWith('❌'));
    const advertencias = erroresFinal.filter(e => e.startsWith('⚠️'));

    if (erroresBlockeantes.length > 0) {
      alert('No se puede completar la división:\n\n' + erroresBlockeantes.join('\n'));
      return;
    }

    if (advertencias.length > 0) {
      const confirmar = window.confirm(
        'Atención — división con faltantes:\n\n' +
        advertencias.join('\n') +
        '\n\n¿Confirmar y registrar como división parcial?'
      );
      if (!confirmar) return;
    }

    const tiempoReposo = calcularTiempoReposo();

    try {
      await completarMutation.mutateAsync({
        masaId: masaId!,
        fase: 'division',
        data: {
          datos: {
            maquina_corte_id:      Number(formData.maquina_corte_id),
            temperatura_entrada:   Number(formData.temperatura_entrada),
            requiere_reposo:       formData.requiere_reposo,
            hora_inicio_reposo:    formData.requiere_reposo ? formData.hora_inicio_reposo : null,
            hora_fin_reposo:       formData.requiere_reposo ? formData.hora_fin_reposo    : null,
            tiempo_reposo_minutos: formData.requiere_reposo ? tiempoReposo : 0,
            cantidades_divididas: cantidadesDivididas,
            observaciones: formData.observaciones,
          },
        },
      });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Error desconocido al completar división';
      alert('Error al completar la división:\n\n' + msg);
    }
  };

  // ── Loading / Not found ────────────────────────────────────────

  if (loadingMasa || loadingProductos) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!masa) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">Masa no encontrada</p>
        </div>
      </div>
    );
  }

  // ── Verificar si hay productos con ajuste de divisor ──────────
  const productosConAjuste = productos
    ? (productos as any[]).filter((p: any) => parseInt(p.unidades_excedente || 0) > 0)
    : [];

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        <BarraNavegacionFases
          masaId={masaId!}
          codigoMasa={masa.codigo_masa}
          faseAnterior={{ label: 'Amasado', ruta: `/amasado/${masaId}` }}
          faseSiguiente={{
            label: 'Formado',
            ruta: `/formado/${masaId}`,
            habilitada: masa.fase_actual !== 'DIVISION',
          }}
        />

        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">División de Masa</h1>
              <p className="text-gray-600 mt-1">{masa.tipo_masa}</p>
              <p className="text-sm text-gray-500 mt-1">ID Masa: {masaId}</p>
              {masa.lote_produccion && (
                <p className="text-sm font-semibold text-indigo-700 mt-1">
                  Lote: {masa.lote_produccion}
                </p>
              )}
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                {masa.fase_actual}
              </span>
            </div>
          </div>
        </div>

        {/* Alerta de ajuste por divisor — solo si hay productos con excedente */}
        {productosConAjuste.length > 0 && (
          <div className="bg-amber-50 border-l-4 border-amber-400 rounded-lg p-4">
            <div className="flex gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-bold text-amber-800 mb-1">
                  Ajuste de producción por múltiplo divisor
                </h3>
                <p className="text-sm text-amber-700 mb-3">
                  Los siguientes productos requieren producir más unidades de las pedidas para completar
                  un ciclo de división exacto en la máquina. El excedente se registrará como inventario adicional.
                </p>
                <table className="text-sm w-full">
                  <thead>
                    <tr className="text-amber-800 font-semibold">
                      <th className="text-left pb-1">Producto</th>
                      <th className="text-right pb-1">Pedidas</th>
                      <th className="text-right pb-1">Divisor</th>
                      <th className="text-right pb-1">A producir</th>
                      <th className="text-right pb-1">Excedente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosConAjuste.map((p: any) => (
                      <tr key={p.id} className="text-amber-700">
                        <td className="py-0.5">{p.producto_nombre}</td>
                        <td className="text-right py-0.5">{p.unidades_pedidas}</td>
                        <td className="text-right py-0.5">
                          <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-semibold">
                            ×{p.multiplo_divisor}
                          </span>
                        </td>
                        <td className="text-right py-0.5 font-bold text-amber-900">
                          {p.unidades_ajustadas}
                        </td>
                        <td className="text-right py-0.5">
                          <span className="text-orange-600 font-semibold">+{p.unidades_excedente}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Información de la Masa */}
        <Card title="Información de la Masa">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total Pesado</p>
              <p className="text-2xl font-bold text-gray-900">
                {Number(masa.total_kilos_pesado_real).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Productos</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_productos || 0}</p>
            </div>
          </div>
        </Card>

        {/* Formulario de Control de División — solo editable si la fase es DIVISION */}
        <Card title="Control de División">
          {masa.fase_actual !== 'DIVISION' ? (
            /* ── Vista histórico (read-only) ── */
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400 uppercase font-medium mb-1">Máquina de corte</p>
                <p className="font-semibold text-gray-800">
                  {(maquinasCorte || []).find((m: any) => String(m.id) === formData.maquina_corte_id)?.nombre
                    || `Máquina #${formData.maquina_corte_id}`}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400 uppercase font-medium mb-1">Temperatura de entrada</p>
                <p className="font-semibold text-gray-800">
                  {formData.temperatura_entrada ? `${formData.temperatura_entrada} °C` : '—'}
                </p>
              </div>
              {formData.requiere_reposo && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 uppercase font-medium mb-1">Inicio reposo</p>
                    <p className="font-semibold text-gray-800">{formData.hora_inicio_reposo || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 uppercase font-medium mb-1">Fin reposo</p>
                    <p className="font-semibold text-gray-800">{formData.hora_fin_reposo || '—'}</p>
                  </div>
                  <div className="col-span-2 bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-400 uppercase font-medium mb-1">Tiempo de reposo</p>
                    <p className="font-semibold text-blue-700">{calcularTiempoReposo()} minutos</p>
                  </div>
                </>
              )}
              {formData.observaciones && (
                <div className="col-span-2 bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 uppercase font-medium mb-1">Observaciones</p>
                  <p className="text-gray-700">{formData.observaciones}</p>
                </div>
              )}
            </div>
          ) : (
            /* ── Formulario editable ── */
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Máquina de Corte <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.maquina_corte_id}
                    onChange={(e) => setFormData({ ...formData, maquina_corte_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    {(maquinasCorte || []).map((m: any) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.nombre} ({m.tipo === 'MANUAL' ? 'Manual' : 'Automática'}, {parseFloat(m.capacidad_kg)} kg)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Temperatura de Entrada (°C) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.temperatura_entrada}
                    onChange={(e) => setFormData({ ...formData, temperatura_entrada: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="25.0"
                  />
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-center gap-3 mb-4">
                  <input
                    type="checkbox"
                    id="requiere_reposo"
                    checked={formData.requiere_reposo}
                    onChange={(e) => setFormData({ ...formData, requiere_reposo: e.target.checked })}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                  <label htmlFor="requiere_reposo" className="text-sm font-medium text-gray-700">
                    Esta masa requiere reposo pre-división
                  </label>
                </div>
                {formData.requiere_reposo && (
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Hora Inicio Reposo <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={formData.hora_inicio_reposo}
                        onChange={(e) => setFormData({ ...formData, hora_inicio_reposo: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Hora Fin Reposo <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={formData.hora_fin_reposo}
                        onChange={(e) => setFormData({ ...formData, hora_fin_reposo: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {formData.hora_inicio_reposo && formData.hora_fin_reposo && (
                      <div className="col-span-2">
                        <p className="text-sm text-gray-700">
                          Tiempo de reposo:{' '}
                          <span className="font-semibold text-blue-600">{calcularTiempoReposo()} minutos</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Observaciones</label>
                <textarea
                  value={formData.observaciones}
                  onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Observaciones opcionales..."
                />
              </div>
            </div>
          )}
        </Card>

        {/* Cantidades divididas por producto */}
        <Card title={masa.fase_actual !== 'DIVISION' ? 'Cantidades Cortadas (Histórico)' : 'Cantidades a Cortar por Producto'}>
          <div className="space-y-4">
            {productos && (productos as any[]).length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Producto
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Paquetes
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Panes sugeridos a cortar
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Peso Unitario Masa
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          Divisor
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          Peso Total del Corte
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Cantidad de divisiones
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Unidades cortadas <span className="text-red-500">*</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(productos as any[]).map((producto) => {
                        const cantidad   = cantidadesDivididas[producto.id] || 0;
                        const error      = cantidad > 0 ? validarCantidad(producto, cantidad) : null;
                        const divisor    = parseInt(producto.multiplo_divisor || 0);
                        const excedente  = parseInt(producto.unidades_excedente || 0);
                        const esCorrecto = cantidad > 0 && !error;
                        // Peso unitario: U_JZ_PesMasDiv con respaldo en gramaje_unitario — misma fuente que la columna "Peso Unitario Masa"
                        const pesoUnitario     = parseFloat(producto.peso_masa_dividida || producto.gramaje_unitario || 0);
                        // Peso Total del Corte = Divisor Masa (SAP) × Peso Neto Masa Dividida — peso de la pieza que sale de la máquina antes de subdividir a mano
                        const pesoTotalMasa    = divisor > 0 && pesoUnitario > 0 ? divisor * pesoUnitario : 0;
                        // Peso Total División = Peso Unitario Masa × Unidades Cortadas ingresadas por el usuario
                        const pesoTotalDivision = cantidad > 0 && pesoUnitario > 0 ? cantidad * pesoUnitario : 0;
                        // Validación B4: divisor guardado (snapshot al sincronizar) vs. valor vivo en SAP
                        const divisorSapActual = producto.multiplo_divisor_sap_actual != null
                          ? parseInt(producto.multiplo_divisor_sap_actual) : null;
                        const divisorDesincronizado = divisorSapActual != null && divisorSapActual !== divisor;

                        return (
                          <tr key={producto.id} className={`hover:bg-gray-50 ${excedente > 0 ? 'bg-amber-50/30' : ''}`}>

                            {/* Nombre */}
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-gray-900">{producto.producto_nombre}</p>
                              <p className="text-xs text-gray-400 font-mono">{producto.sap_item_code}</p>
                            </td>

                            {/* Paquetes */}
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-gray-600">
                                {parseInt(producto.unidades_programadas || producto.unidades_pedidas || 0)}
                              </span>
                            </td>

                            {/* Panes sugeridos — ya redondeados al múltiplo del divisor */}
                            <td className="px-4 py-3 text-right">
                              {(() => {
                                const xPaq = upqDesdeProducto(producto.unidades_por_paquete, producto.producto_nombre);
                                const programadas = parseInt(producto.unidades_programadas || producto.unidades_pedidas || 0);
                                const panesBrutos = programadas * xPaq;
                                const panesSugeridosAjustados = getPanesSugeridos(producto);
                                const fueAjustado = panesSugeridosAjustados !== panesBrutos;
                                return (
                                  <span className="text-base font-bold text-indigo-700">
                                    {panesSugeridosAjustados}
                                    <span className="text-xs font-normal text-indigo-400 ml-1">×{xPaq}</span>
                                    {fueAjustado && (
                                      <span className="block text-xs font-normal text-amber-600">
                                        ajustado desde {panesBrutos}
                                      </span>
                                    )}
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Peso Unitario Masa — U_JZ_PesMasDiv, es el dato que usa el divisor */}
                            <td className="px-4 py-3 text-right">
                              {producto.peso_masa_dividida ? (
                                <span className="text-sm font-semibold text-blue-700">
                                  {parseFloat(producto.peso_masa_dividida).toFixed(0)} g
                                </span>
                              ) : (
                                <span className="text-xs text-amber-600" title="Sin U_JZ_PesMasDiv en SAP — usando Gramaje unitario como respaldo">
                                  {producto.gramaje_unitario ? `${parseFloat(producto.gramaje_unitario).toFixed(0)} g*` : '—'}
                                </span>
                              )}
                            </td>

                            {/* Divisor badge */}
                            <td className="px-4 py-3 text-center">
                              {divisor > 0 ? (
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                                    divisorDesincronizado
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-orange-100 text-orange-800'
                                  }`}
                                  title={
                                    divisorDesincronizado
                                      ? `Desincronizado: en Orbit está ×${divisor}, en SAP ahora es ×${divisorSapActual}. Sincroniza BOM para actualizar.`
                                      : undefined
                                  }
                                >
                                  {divisorDesincronizado && '⚠️'}×{divisor}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>

                            {/* Peso Total del Corte — Divisor Masa (SAP) × Peso Neto Masa Dividida */}
                            <td className="px-4 py-3 text-center">
                              {pesoTotalMasa > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                                  {pesoTotalMasa.toFixed(0)} g
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>

                            {/* Cantidad de divisiones = Panes sugeridos ÷ Divisor */}
                            <td className="px-4 py-3 text-right">
                              {divisor > 0 ? (
                                <span className="text-sm font-semibold text-gray-700">
                                  {Math.ceil(getPanesSugeridos(producto) / divisor)}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>

                            {/* Input cantidad cortada — editable solo si fase es DIVISION */}
                            <td className="px-4 py-3 text-sm text-right">
                              {masa.fase_actual !== 'DIVISION' ? (
                                <span className={`font-mono font-semibold text-sm ${
                                  Number(producto.unidades_producidas) > 0 ? 'text-yellow-700' : 'text-gray-400'
                                }`}>
                                  {Number(producto.unidades_producidas) > 0 ? producto.unidades_producidas : '—'}
                                </span>
                              ) : (
                                <div className="flex flex-col items-end gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={cantidadesDivididas[producto.id] || ''}
                                    onChange={(e) => handleCantidadChange(producto.id, e.target.value)}
                                    className={`w-32 px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 text-right ${
                                      error
                                        ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200'
                                        : esCorrecto
                                        ? 'border-green-400 bg-green-50'
                                        : 'border-gray-300'
                                    }`}
                                    placeholder={String(getPanesSugeridos(producto))}
                                  />
                                  {cantidad > 0 && pesoTotalDivision > 0 && (
                                    <p className="text-xs text-blue-600 text-right">
                                      Peso Total División: {pesoTotalDivision.toFixed(0)} g
                                    </p>
                                  )}
                                  {error && (
                                    <p className="text-xs text-red-600 text-right max-w-xs">{error}</p>
                                  )}
                                  {esCorrecto && (() => {
                                    const panesSugeridos = getPanesSugeridos(producto);
                                    return cantidad > panesSugeridos ? (
                                      <p className="text-xs text-amber-600 text-right">
                                        +{cantidad - panesSugeridos} excedente real
                                      </p>
                                    ) : null;
                                  })()}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Nota informativa */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>Columnas:</strong>{' '}
                    <span className="font-semibold">Paquetes</span> = unidades en la orden de venta.{' '}
                    <span className="font-semibold">Panes sugeridos a cortar</span> = total de panes a producir (paquetes × unidades por paquete), ajustado al múltiplo del divisor de la máquina.{' '}
                    <span className="font-semibold">Peso Unitario Masa</span> = peso individual de cada pan a dividir (campo SAP U_JZ_PesMasDiv); es el dato que usa la divisora. Si no está configurado en SAP, se muestra el Gramaje unitario como respaldo (marcado con *).{' '}
                    <span className="font-semibold">Peso Total del Corte</span> = Divisor × Peso Unitario Masa — el peso de la pieza que sale de la máquina antes de subdividir a mano.{' '}
                    <span className="font-semibold">Peso Total División</span> (bajo el campo de Unidades cortadas) = Peso Unitario Masa × las unidades que se registren.{' '}
                    <span className="font-semibold">Cantidad de divisiones</span> = Panes sugeridos a cortar ÷ Divisor — el número de cortes que debe hacer la máquina.
                    Los productos con <span className="inline-flex items-center px-1 rounded bg-orange-100 text-orange-800 text-xs font-semibold">×N</span> deben cortarse en múltiplos exactos.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-gray-500">No hay productos para dividir</p>
            )}
          </div>
        </Card>

        {/* Guía de Proceso */}
        <Card title="Guía de Proceso">
          <div className="space-y-2 text-sm text-gray-700">
            <p>1. Verificar que la masa haya completado el amasado correctamente</p>
            <p>2. Si requiere reposo, dejar reposar la masa el tiempo indicado (generalmente 10–20 min)</p>
            <p>3. Seleccionar la máquina de corte adecuada (Conic para grandes volúmenes)</p>
            <p>4. Medir y registrar la temperatura de entrada de la masa</p>
            <p>5. Cortar la masa según el gramaje de cada producto — respetar la columna <strong>"A cortar"</strong></p>
            <p>6. Si la máquina exige múltiplos exactos (columna <strong>Divisor</strong>), producir las unidades indicadas incluyendo el excedente</p>
            <p>7. Registrar las unidades realmente cortadas en el campo de entrada</p>
          </div>
        </Card>

        {/* Botones — sticky para que "Completar División" nunca requiera scroll */}
        <div className="sticky bottom-0 z-10 bg-gray-50 border-t border-gray-200 px-4 py-3 -mx-6 flex justify-end items-center">
          <div className="flex gap-3 items-center">
            <button
              onClick={() => setShowMO(true)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
            >
              + Mano de obra
            </button>
            {masa.fase_actual === 'DIVISION' && (
              <div className="flex flex-col items-end gap-1">
                {!todasTienenCantidad() && (
                  <p className="text-xs text-red-500 font-medium">
                    ⚠ Debes ingresar la cantidad cortada para todos los productos
                  </p>
                )}
                <button
                  onClick={handleCompletar}
                  disabled={completarMutation.isPending || hayErroresValidacion() || !todasTienenCantidad()}
                  className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 font-semibold"
                >
                  {completarMutation.isPending ? 'Completando...' : 'Completar División ✓'}
                </button>
              </div>
            )}
          </div>
        </div>
        {showMO && <ModalMO masaId={Number(masaId)} fase="DIVISION" onClose={() => setShowMO(false)} />}

      </div>
    </div>
  );
};

export default DivisionMasa;
