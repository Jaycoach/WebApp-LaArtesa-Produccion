import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail, useProductos } from '../../hooks/useMasas';
import { useCompletarFase } from '../../hooks/useFases';

export const DivisionMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const masaIdNum = Number(masaId);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaIdNum);
  const { data: productos, isLoading: loadingProductos } = useProductos(masaIdNum);
  const completarMutation = useCompletarFase();

  const [formData, setFormData] = useState({
    maquina_corte_id: '1',
    temperatura_entrada: '',
    requiere_reposo: false,
    hora_inicio_reposo: '',
    hora_fin_reposo: '',
    observaciones: '',
  });

  const [cantidadesDivididas, setCantidadesDivididas] = useState<Record<number, number>>({});

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
   * Valida la cantidad ingresada para un producto.
   * Retorna null si es válida, o string con el mensaje de error.
   */
  const validarCantidad = (producto: any, cantidad: number): string | null => {
    if (cantidad <= 0) return null; // Aún no ingresó nada

    const minimoRequerido = getMinimoRequerido(producto);
    const divisor = parseInt(producto.multiplo_divisor || 0);

    if (cantidad < minimoRequerido) {
      return `Mínimo ${minimoRequerido} unidades`;
    }

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
      if (cantidad < minimo) {
        erroresFinal.push(`"${nombre}": ingresó ${cantidad}, debe cortar mínimo ${minimo}.`);
        continue;
      }
      if (divisor > 0 && cantidad % divisor !== 0) {
        const inferior = Math.floor(cantidad / divisor) * divisor;
        const superior = inferior + divisor;
        erroresFinal.push(
          `"${nombre}": ${cantidad} no es múltiplo de ${divisor}. Valores válidos: ${inferior} o ${superior}.`
        );
      }
    }

    if (erroresFinal.length > 0) {
      alert('No se puede completar la división:\n\n' + erroresFinal.join('\n'));
      return;
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
      navigate(`/planificacion/masas/${masaId}`);
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
            <div className="text-right">
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
              <p className="text-sm text-gray-600">Total con Merma</p>
              <p className="text-2xl font-bold text-gray-900">
                {Number(masa.total_kilos_con_merma).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Productos</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_productos || 0}</p>
            </div>
          </div>
        </Card>

        {/* Formulario de Control de División */}
        <Card title="Control de División">
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
                  <option value="1">Conic (Automática, 100 kg)</option>
                  <option value="2">Divisora Manual (50 kg)</option>
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

            {/* Reposo pre-división */}
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
        </Card>

        {/* Cantidades divididas por producto */}
        <Card title="Cantidades a Cortar por Producto">
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
                          Pedidas
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          A cortar
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          Divisor
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                          Excedente
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
                        const pedidas    = parseInt(producto.unidades_pedidas || 0);
                        const ajustadas  = parseInt(producto.unidades_ajustadas || producto.unidades_programadas);
                        const excedente  = parseInt(producto.unidades_excedente || 0);
                        const esCorrecto = cantidad > 0 && !error;

                        return (
                          <tr key={producto.id} className={`hover:bg-gray-50 ${excedente > 0 ? 'bg-amber-50/30' : ''}`}>

                            {/* Nombre */}
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-gray-900">{producto.producto_nombre}</p>
                              <p className="text-xs text-gray-400 font-mono">{producto.sap_item_code}</p>
                            </td>

                            {/* Pedidas */}
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-gray-600">{pedidas}</span>
                            </td>

                            {/* A cortar (ajustadas) */}
                            <td className="px-4 py-3 text-right">
                              <span className={`text-base font-bold ${excedente > 0 ? 'text-orange-700' : 'text-blue-700'}`}>
                                {ajustadas}
                              </span>
                            </td>

                            {/* Divisor badge */}
                            <td className="px-4 py-3 text-center">
                              {divisor > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-800">
                                  ×{divisor}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>

                            {/* Excedente */}
                            <td className="px-4 py-3 text-center">
                              {excedente > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                  +{excedente}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>

                            {/* Input cantidad cortada */}
                            <td className="px-4 py-3 text-sm text-right">
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
                                  placeholder={String(ajustadas)}
                                />
                                {error && (
                                  <p className="text-xs text-red-600 text-right max-w-xs">{error}</p>
                                )}
                                {esCorrecto && cantidad > ajustadas && (
                                  <p className="text-xs text-amber-600 text-right">
                                    +{cantidad - pedidas} excedente real
                                  </p>
                                )}
                              </div>
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
                    <span className="font-semibold">Pedidas</span> = unidades en la orden de venta.{' '}
                    <span className="font-semibold">A cortar</span> = mínimo requerido ajustado al múltiplo del divisor de la máquina.{' '}
                    <span className="font-semibold">Excedente</span> = unidades adicionales que se registrarán como inventario extra en SAP.
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

        {/* Botones */}
        <div className="flex justify-between">
          <button
            onClick={() => navigate(`/planificacion/masas/${masaId}`)}
            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            ← Volver
          </button>

          <button
            onClick={handleCompletar}
            disabled={completarMutation.isPending || hayErroresValidacion() || !todasTienenCantidad()}
            className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 font-semibold"
          >
            {completarMutation.isPending ? 'Completando...' : 'Completar División ✓'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default DivisionMasa;
