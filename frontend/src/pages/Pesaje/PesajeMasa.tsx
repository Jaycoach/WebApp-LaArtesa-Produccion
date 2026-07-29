import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useChecklist, useUpdateIngrediente, useConfirmarPesaje, useAjustarPesajeSAP } from '../../hooks/useChecklist';
import { ModalMO } from '../../components/common/ModalMO';
import { useAuthStore } from '../../store/useAuthStore';
import { useCancelarMasa } from '../../hooks/useMasas';
import { formatDate } from '@/utils/formatters';

export const PesajeMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const masaIdNum = Number(masaId);

  const { data: checklist, isLoading, error } = useChecklist(masaIdNum);
  const updateMutation = useUpdateIngrediente();
  const confirmarMutation = useConfirmarPesaje();
  const ajustarSapMutation = useAjustarPesajeSAP();

  const { user } = useAuthStore();
  const puedeEditar = user?.rol === 'admin' || user?.rol === 'supervisor';
  const cancelarMutation = useCancelarMasa();
  const [motivoCancelar, setMotivoCancelar] = useState('');
  const [mostrarCancelar, setMostrarCancelar] = useState(false);
  const hayAlgoPesado = checklist?.ingredientes?.some((ing: any) => ing.pesado) ?? false;
  const handleConfirmarCancelar = async () => {
    if (!motivoCancelar.trim()) return;
    try {
      await cancelarMutation.mutateAsync({ masaId: masaIdNum, motivo: motivoCancelar.trim() });
      setMostrarCancelar(false);
      navigate('/planificacion');
    } catch (error: any) {
      alert(error?.message || 'Error desconocido al cancelar la masa');
    }
  };
  const [showMO, setShowMO] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [pendingAjuste, setPendingAjuste] = useState<{
    ingredienteId: number;
    ingredienteNombre: string;
    pesoAnterior: number;
    pesoNuevo: number;
  } | null>(null);

  const parseFechaVencimiento = (raw: string): string | null => {
    const s = raw.replace(/[^0-9]/g, ''); // solo dígitos
    const hoy = new Date();
    const yy = hoy.getFullYear(); // 2026
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');

    let dia = '', mes = '', anio = '';

    if (s.length === 0) return null;
    if (s.length <= 2) {
      // "27" → 27/mes_actual/año_actual
      dia = s.padStart(2, '0');
      mes = mm;
      anio = String(yy);
    } else if (s.length === 4) {
      // "2702" → 27/02/año_actual
      dia = s.substring(0, 2);
      mes = s.substring(2, 4);
      anio = String(yy);
    } else if (s.length === 6) {
      // "270226" → 27/02/2026
      dia = s.substring(0, 2);
      mes = s.substring(2, 4);
      anio = '20' + s.substring(4, 6);
    } else if (s.length === 8) {
      // "27022026" → 27/02/2026
      dia = s.substring(0, 2);
      mes = s.substring(2, 4);
      anio = s.substring(4, 8);
    } else {
      return null;
    }

    const diaNum = parseInt(dia), mesNum = parseInt(mes), anioNum = parseInt(anio);
    if (diaNum < 1 || diaNum > 31) return null;
    if (mesNum < 1 || mesNum > 12) return null;
    if (anioNum < 2024 || anioNum > 2099) return null;

    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  };

  const [formData, setFormData] = useState<{
    peso_real: string;
    lote: string;
    fecha_vencimiento: string;
    fecha_vencimiento_display?: string;
    lotes_consumo: { batch: string; cantidad_kg: string; fecha_vencimiento?: string }[];
  }>({
    peso_real: '',
    lote: '',
    fecha_vencimiento: '',
    fecha_vencimiento_display: undefined,
    lotes_consumo: [],
  });

  const [stockError, setStockError] = useState<{
    ingredienteId: number;
    mensaje: string;
    lote_fallido: string | null;
    disponible: number | null;
    lotes_actuales: { batch: string; cantidad_disponible: number; expiration_date?: string }[];
  } | null>(null);

  const handleMarcar = async (ingredienteId: number, field: 'disponible' | 'verificado' | 'pesado', value: boolean) => {
    await updateMutation.mutateAsync({
      masaId: masaIdNum,
      ingredienteId,
      data: { [field]: value },
    });
  };

  // Encapsula el flujo completo: marca disponible + verificado (misma lógica de siempre,
  // solo que ahora ocurre en un solo paso invisible para el usuario) y abre el formulario
  // de pesaje directamente — reemplaza los 2 checks manuales + botón "Registrar Pesaje".
  const handleRegistrarPesajeClick = async (ingrediente: any) => {
    if (ingrediente.sin_stock || ingrediente.pesado) return;
    try {
      if (!ingrediente.disponible) await handleMarcar(ingrediente.id, 'disponible', true);
      if (!ingrediente.verificado) await handleMarcar(ingrediente.id, 'verificado', true);
    } catch {
      return; // si falla marcar disponible/verificado, no abrir el formulario
    }
    handleEditar(ingrediente);
  };

  const handleEditar = (ingrediente: any) => {
    setEditando(ingrediente.id);

    // Auto-llenado FEFO: si el backend calculó el reparto automático (lotes_consumo_sugerido)
    // y el ingrediente aún no fue pesado, se usa completo — el operario solo revisa y da "Guardar".
    const yaPesado = ingrediente.pesado && ingrediente.peso_real;
    const sugeridoAuto = (!yaPesado && ingrediente.lotes_consumo_sugerido?.length > 0)
      ? ingrediente.lotes_consumo_sugerido.map((l: any) => {
          const loteInfo = ingrediente.lotes?.find((x: any) => x.batch === l.batch);
          return {
            batch: l.batch,
            cantidad_kg: String(Math.round(l.cantidad_kg * 1000)),
            fecha_vencimiento: loteInfo?.expiration_date ? loteInfo.expiration_date.substring(0, 10) : '',
          };
        })
      : null;

    // Fallback: comportamiento anterior si no hay sugerido automático
    const lotePreseleccionado = ingrediente.lote ||
      ingrediente.lote_sugerido ||
      (ingrediente.lotes && ingrediente.lotes.length > 0 ? ingrediente.lotes[0].batch : '');
    const loteObj = ingrediente.lotes?.find((l: any) => l.batch === lotePreseleccionado);
    const vencimientoPreseleccionado = ingrediente.fecha_vencimiento ||
      (loteObj?.expiration_date ? loteObj.expiration_date.substring(0, 10) : '');

    const pesoAutoLleno = sugeridoAuto
      ? sugeridoAuto.reduce((s: number, l: any) => s + Number(l.cantidad_kg), 0)
      : null;

    setStockError(null);
    setFormData({
      peso_real: ingrediente.peso_real != null
        ? String(ingrediente.peso_real)
        : (pesoAutoLleno != null
            ? String(pesoAutoLleno)
            : (ingrediente.cantidad_gramos != null ? String(ingrediente.cantidad_gramos) : '')),
      lote: sugeridoAuto ? sugeridoAuto[0].batch : lotePreseleccionado,
      fecha_vencimiento: sugeridoAuto ? sugeridoAuto[0].fecha_vencimiento : vencimientoPreseleccionado,
      fecha_vencimiento_display: undefined,
      lotes_consumo: sugeridoAuto || (lotePreseleccionado
        ? [{ batch: lotePreseleccionado, cantidad_kg: ingrediente.pesado && ingrediente.peso_real ? String(ingrediente.peso_real) : '', fecha_vencimiento: vencimientoPreseleccionado }]
        : []),
    });
  };

  const handleGuardar = async (ingredienteId: number) => {
    setStockError(null);

    const ing = checklist?.ingredientes.find((i: any) => i.id === ingredienteId);
    const tieneLotesSAP = ing?.lotes && ing.lotes.length > 0;

    // Validar peso real obligatorio
    const pesoReal = Number(formData.peso_real);
    if (!formData.peso_real || isNaN(pesoReal) || pesoReal <= 0) {
      setStockError({
        ingredienteId,
        mensaje: 'El peso real es obligatorio y debe ser mayor a 0.',
        lote_fallido: null,
        disponible: null,
        lotes_actuales: [],
      });
      return;
    }

    const lotes_consumo = tieneLotesSAP
      ? formData.lotes_consumo
          .filter(l => l.batch && parseFloat(l.cantidad_kg) > 0)
          .map(l => ({ batch: l.batch, cantidad_kg: parseFloat(l.cantidad_kg) / 1000 }))
      : undefined;

    // Validar lote obligatorio para ingredientes con lotes SAP
    if (tieneLotesSAP && (!lotes_consumo || lotes_consumo.length === 0)) {
      setStockError({
        ingredienteId,
        mensaje: 'Debes seleccionar al menos un lote e ingresar los gramos consumidos.',
        lote_fallido: null,
        disponible: null,
        lotes_actuales: [],
      });
      return;
    }

    // Validar que la suma de lotes coincida con el peso real (tolerancia 1g)
    if (lotes_consumo && lotes_consumo.length > 0) {
      const sumaGramos = lotes_consumo.reduce((s, l) => s + l.cantidad_kg * 1000, 0);
      if (Math.abs(sumaGramos - pesoReal) > 1) {
        setStockError({
          ingredienteId,
          mensaje: `La suma de lotes (${sumaGramos.toFixed(0)}g) no coincide con el peso real (${pesoReal.toFixed(0)}g). Ajusta las cantidades.`,
          lote_fallido: null,
          disponible: null,
          lotes_actuales: [],
        });
        return;
      }
    }

    try {
      const yaEstabaPesado = ing?.pesado === true;
      const pesoAnterior = ing?.peso_real != null ? Number(ing.peso_real) : null;

      await updateMutation.mutateAsync({
        masaId: masaIdNum,
        ingredienteId,
        data: {
          pesado: true,
          peso_real: Number(formData.peso_real),
          lote: formData.lote,
          fecha_vencimiento: formData.fecha_vencimiento,
          lotes_consumo,
        },
      });
      setEditando(null);

      // Guardado local completo. Si el pesaje YA fue transmitido a SAP y esto
      // es una edición (no el primer pesaje) con cambio real de peso, se
      // ofrece transmitir el ajuste (excedente/faltante) a SAP.
      if ((checklist as any)?.pesaje_transmitido && yaEstabaPesado && pesoAnterior != null
          && Math.abs(pesoReal - pesoAnterior) >= 0.01) {
        setPendingAjuste({
          ingredienteId,
          ingredienteNombre: ing?.ingrediente_nombre || 'Ingrediente',
          pesoAnterior,
          pesoNuevo: pesoReal,
        });
      }
    } catch (err: any) {
      // handleError de api.ts transforma el error — usa err?.status (no err?.response?.status)
      if (err?.status === 409) {
        setStockError({
          ingredienteId,
          mensaje: err?.message || 'Stock insuficiente',
          lote_fallido: err?.data?.lote_fallido || null,
          disponible: err?.data?.disponible ?? null,
          lotes_actuales: err?.data?.lotes_actuales || [],
        });
      } else if (err?.status === 422) {
        setStockError({
          ingredienteId,
          mensaje: err?.message || 'Dato inválido',
          lote_fallido: null,
          disponible: null,
          lotes_actuales: [],
        });
      } else {
        throw err;
      }
    }
  };

  const [confirmando, setConfirmando] = useState(false);

  const handleConfirmar = async () => {
    if (confirmando || confirmarMutation.isPending) return;
    if (!confirm('¿Confirmar pesaje completo? Esto enviará el consumo a SAP y desbloqueará el amasado.')) return;
    setConfirmando(true);
    try {
      const resultado = await confirmarMutation.mutateAsync(masaIdNum);
      const docNum = resultado?.sap_doc_num ?? resultado?.sap_docentry ?? '—';
      alert(`✅ Pesaje confirmado exitosamente.\nSalida SAP Nº ${docNum} creada.`);
      navigate(`/planificacion/masas/${masaId}`);
    } catch (err: any) {
        const data = err?.data || {};
        const mensaje = err?.message || 'Error al confirmar pesaje';

        // Caso 1: lote inválido o faltante (validación previa a SAP, HTTP 422)
        const sinLote: string[] = data?.sin_lote || [];
        const loteInvalido: string[] = data?.lote_invalido || [];

        if (sinLote.length > 0 || loteInvalido.length > 0) {
          let textoError = `⚠ Lotes incompletos\n\n${mensaje}\n`;
          if (sinLote.length > 0) {
            textoError += `\nIngredientes sin lote registrado:\n`;
            sinLote.forEach((n: string) => { textoError += `  • ${n}\n`; });
          }
          if (loteInvalido.length > 0) {
            textoError += `\nIngredientes con lote no encontrado en SAP:\n`;
            loteInvalido.forEach((n: string) => { textoError += `  • ${n}\n`; });
          }
          textoError += `\nCorrige el lote en el pesaje y vuelve a confirmar.`;
          alert(textoError);

        // Caso 2: stock insuficiente en SAP (HTTP 502)
        } else {
          const loteFallido = data?.lote_fallido || null;
          const alternativas: any[] = data?.alternativas || [];
          let textoError = `⚠ Error SAP\n\n${mensaje}`;
          if (loteFallido) {
            textoError += `\n\nIngrediente: ${loteFallido.item_name || loteFallido.item_code}`;
            textoError += `\nLote sin stock suficiente en SAP: ${loteFallido.batch}`;
          }
          if (alternativas.length > 0) {
            textoError += `\n\nLotes alternativos disponibles:`;
            alternativas.forEach((a: any) => {
              textoError += `\n  • Lote ${a.batch}: ${Number(a.cantidad_disponible).toFixed(3)} kg`;
              if (a.expiration_date) textoError += ` (vence ${formatDate(a.expiration_date.slice(0, 10))})`;
            });
            textoError += `\n\nCambia el lote en el pesaje y vuelve a confirmar.`;
          } else if (loteFallido) {
            textoError += `\n\nNo hay lotes alternativos con stock. Sincroniza el inventario SAP o contacta al supervisor.`;
          }
          alert(textoError);
        }
      } finally {
        setConfirmando(false);
      }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!checklist) {
    const apiError = error as any;
    const status = apiError?.response?.status || apiError?.status;
    const mensaje = apiError?.response?.data?.message || apiError?.message;

    if (status === 403) {
      return (
        <div className="p-6 max-w-lg mx-auto mt-12">
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-6 text-center">
            <div className="text-4xl mb-3">⏸</div>
            <h2 className="text-lg font-bold text-yellow-800 mb-2">Masa no aprobada</h2>
            <p className="text-yellow-700 text-sm mb-4">
              {mensaje || 'Un supervisor o administrador debe aprobar esta masa antes de iniciar el pesaje.'}
            </p>
            <button
              onClick={() => navigate('/planificacion/masas')}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium"
            >
              ← Volver a la lista
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">{mensaje || 'Checklist no disponible'}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-3 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-sm"
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Botón Volver superior */}
        <div>
          <button
            onClick={() => navigate(`/planificacion/masas/${masaId}`)}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
          >
            ← Volver al detalle
          </button>
        </div>
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Pesaje de Masa</h1>
              <p className={`mt-1 font-semibold ${checklist.es_repeticion ? 'text-red-600' : 'text-gray-600'}`}>
                {checklist.es_repeticion && (
                  <span className="inline-block text-xs font-bold bg-red-100 text-red-700 border border-red-400 rounded px-2 py-0.5 mr-2">
                    REPETICIÓN
                  </span>
                )}
                {checklist.tipo_masa}
              </p>
              <p className="text-sm text-gray-500 mt-1">ID Masa: {masaId}</p>
              {checklist.productos_resumen && checklist.productos_resumen.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2">PRODUCTOS A PRODUCIR</p>
                  <div className="space-y-1">
                    {checklist.productos_resumen.map((p: any) => (
                      <div key={p.sap_item_code} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{p.producto_nombre}</span>
                        <div className="flex items-center gap-3 ml-4">
                          <span className="text-gray-400 text-xs">{p.unidades_pedidas} paq pedidos</span>
                          {p.multiplo_divisor > 0 && p.unidades_ajustadas !== p.unidades_programadas && (
                            <span className="text-xs text-amber-600 font-semibold">→ {p.unidades_ajustadas} paq</span>
                          )}
                          <span className="font-bold text-indigo-700">
                            {p.panes_totales} panes
                            <span className="text-xs font-normal text-indigo-400 ml-1">×{p.unidades_por_paquete}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">Progreso</div>
              <div className="text-3xl font-bold text-blue-600">{checklist.progreso}%</div>
              <div className="w-48 bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${checklist.progreso}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Indicadores */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className={`p-4 rounded-lg ${checklist.todosDisponibles ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                {checklist.todosDisponibles ? (
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium text-gray-900">Disponibles</span>
              </div>
            </div>
            <div className={`p-4 rounded-lg ${checklist.todosVerificados ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                {checklist.todosVerificados ? (
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium text-gray-900">Verificados</span>
              </div>
            </div>
            <div className={`p-4 rounded-lg ${checklist.todosPesados ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                {checklist.todosPesados ? (
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium text-gray-900">Pesados</span>
              </div>
            </div>
          </div>
        </div>

        {/* Lista de Ingredientes */}
        <Card title="Checklist de Ingredientes">
          <div className="space-y-4">
            {checklist.sin_stock_count > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg">
                <p className="text-red-800 font-semibold text-sm">
                  ⚠ {checklist.sin_stock_count} ingrediente(s) sin stock suficiente en SAP:
                </p>
                <ul className="mt-1 text-red-700 text-sm list-disc list-inside">
                  {checklist.ingredientes_sin_stock?.map((nombre: string) => (
                    <li key={nombre}>{nombre}</li>
                  ))}
                </ul>
                <p className="mt-1 text-red-600 text-xs">
                  Estos ingredientes están bloqueados. Sincroniza el inventario SAP o informa al supervisor.
                </p>
              </div>
            )}
            {checklist.ingredientes.filter((ing: any) => !ing.es_empaque).map((ing: any) => (
              <div key={ing.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">
                        {ing.ingrediente_nombre}
                        {ing.ingrediente_sap_code && (
                          <span className="ml-2 text-xs font-mono font-normal text-gray-400">{ing.ingrediente_sap_code}</span>
                        )}
                      </h3>
                      {ing.sin_stock && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-300">
                          ⚠ SIN STOCK
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {ing.es_empaque
                        ? `${Number(ing.cantidad_kilos).toFixed(0)} ${ing.uom || 'Und'}`
                        : `${ing.cantidad_gramos}g`}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                      {ing.excluido_stock && (
                        <span className="text-gray-400 italic">
                          Sin validación de stock (insumo propio)
                        </span>
                      )}
                      {ing.lotes && ing.lotes.length > 0 && (
                        <div className="w-full mt-1">
                          <span className="text-purple-700 font-medium">
                            Lote sugerido: {ing.lote_sugerido || ing.lotes[0]?.batch}
                          </span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {ing.lotes.map((l: any) => (
                              <span
                                key={l.batch}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${
                                  l.batch === (ing.lote_sugerido || ing.lotes[0]?.batch)
                                    ? 'bg-purple-100 border-purple-400 text-purple-800 font-semibold'
                                    : 'bg-gray-50 border-gray-300 text-gray-600'
                                }`}
                              >
                                <span>{l.batch}</span>
                                <span className="font-medium">
                                  {typeof l.cantidad_disponible === 'number'
                                    ? l.cantidad_disponible.toFixed(3)
                                    : '?'} {ing.uom || 'kg'}
                                </span>
                                {l.expiration_date && (
                                  <span className="text-gray-400">
                                    vence {formatDate(l.expiration_date.slice(0, 10))}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Checkboxes — decoración no se pesa a mano, se descuenta automático al confirmar */}
                  {ing.es_decoracion ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg">
                      <span className="text-purple-700 text-sm font-semibold">🎨 Decoración</span>
                      <span className="text-purple-500 text-xs">no requiere pesaje — se descuenta solo</span>
                    </div>
                  ) : (
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={ing.pesado}
                          onChange={() => handleRegistrarPesajeClick(ing)}
                          disabled={ing.sin_stock || ing.pesado}
                          className="w-5 h-5 disabled:opacity-50"
                        />
                        <span className="text-sm font-medium">{ing.pesado ? 'Pesado' : 'Registrar Pesaje'}</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Formulario de pesaje — nunca se abre para decoración */}
                {!ing.es_decoracion && ((!ing.pesado && editando === ing.id) || (ing.pesado && editando === ing.id && puedeEditar)) && (
                  <div className="mt-4 grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Peso teórico BOM (g)</label>
                      <div className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-100 text-gray-700 font-semibold">
                        {formData.peso_real || '—'}
                      </div>
                    </div>
                    <div className="col-span-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Lotes a consumir
                        {ing.lotes && ing.lotes.length > 0 && (
                          <span className="ml-2 text-xs text-purple-600 font-normal">
                            Selecciona uno o más lotes e indica la cantidad de cada uno
                          </span>
                        )}
                      </label>

                      {/* Error 409 — stock insuficiente */}
                      {stockError && stockError.ingredienteId === ing.id && (
                        <div className="mb-3 p-3 bg-red-50 border border-red-300 rounded-lg text-sm">
                          <p className="text-red-800 font-semibold">⚠ {stockError.mensaje}</p>
                          {stockError.lote_fallido && (
                            <p className="text-red-700 mt-1">
                              Lote sin stock suficiente: <span className="font-mono font-bold">{stockError.lote_fallido}</span>
                              {stockError.disponible !== null && ` (disponible: ${(stockError.disponible * 1000).toFixed(0)}g)`}
                            </p>
                          )}
                          {stockError.lotes_actuales.length > 0 && (
                            <div className="mt-2">
                              <p className="text-red-700 font-medium">Stock actualizado disponible:</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {stockError.lotes_actuales.map(la => (
                                  <span key={la.batch} className="px-2 py-0.5 bg-white border border-red-200 rounded text-xs text-gray-700">
                                    <span className="font-mono font-bold">{la.batch}</span>: {(Number(la.cantidad_disponible) * 1000).toFixed(0)}g
                                    {la.expiration_date && ` · vence ${formatDate(la.expiration_date.slice(0, 10))}`}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {ing.lotes && ing.lotes.length > 0 ? (
                        <div className="space-y-2">
                          {ing.lotes.map((l: any) => {
                            const entrada = formData.lotes_consumo.find(lc => lc.batch === l.batch);
                            const seleccionado = !!entrada;
                            const esFallido = stockError?.lote_fallido === l.batch;
                            return (
                              <div
                                key={l.batch}
                                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                  esFallido
                                    ? 'bg-red-50 border-red-400'
                                    : seleccionado
                                    ? 'bg-purple-50 border-purple-500 ring-1 ring-purple-300'
                                    : 'bg-white border-gray-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={seleccionado}
                                  onChange={(e) => {
                                    const batchesSeleccionados = e.target.checked
                                      ? [...formData.lotes_consumo.map(lc => lc.batch), l.batch]
                                      : formData.lotes_consumo.filter(lc => lc.batch !== l.batch).map(lc => lc.batch);

                                    // Redistribuir en orden FEFO (mismo orden de ing.lotes) llenando cada
                                    // lote hasta su cantidad_disponible y pasando el remanente al siguiente.
                                    let restanteG = Number(formData.peso_real) || 0;
                                    const nuevos = ing.lotes
                                      .filter((lo: any) => batchesSeleccionados.includes(lo.batch))
                                      .map((lo: any) => {
                                        const venc = lo.expiration_date ? lo.expiration_date.substring(0, 10) : '';
                                        const disponibleG = Number(lo.cantidad_disponible) * 1000;
                                        const aTomar = Math.max(0, Math.min(disponibleG, restanteG));
                                        restanteG -= aTomar;
                                        return {
                                          batch: lo.batch,
                                          cantidad_kg: aTomar > 0 ? String(aTomar) : '',
                                          fecha_vencimiento: venc,
                                        };
                                      });

                                    setFormData({
                                      ...formData,
                                      lote: nuevos[0]?.batch || '',
                                      fecha_vencimiento: nuevos[0]?.fecha_vencimiento || '',
                                      lotes_consumo: nuevos,
                                    });
                                    setStockError(null);
                                  }}
                                  className="w-4 h-4 accent-purple-600 flex-shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-gray-900 text-sm">
                                    {l.batch}
                                    {l.batch === (ing.lote_sugerido || ing.lotes[0]?.batch) && (
                                      <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">sugerido</span>
                                    )}
                                    {esFallido && (
                                      <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">sin stock</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-green-700">
                                    {(Number(l.cantidad_disponible) * 1000).toFixed(0)}g disponibles
                                    {l.expiration_date && ` · vence ${formatDate(l.expiration_date.slice(0, 10))}`}
                                  </div>
                                </div>
                                {seleccionado && (
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <input
                                      type="number"
                                      step="1"
                                      min="1"
                                      placeholder="g"
                                      value={entrada?.cantidad_kg ?? ''}
                                      onChange={(e) => {
                                        const nuevos = formData.lotes_consumo.map(lc =>
                                          lc.batch === l.batch ? { ...lc, cantidad_kg: e.target.value } : lc
                                        );
                                        // Recalcular peso_real como suma de lotes — el campo mostrado como
                                        // "Peso teórico BOM (g)" debe reflejar lo que realmente se va a guardar,
                                        // no quedar congelado en el valor con el que se abrió el formulario.
                                        // Bug detectado 2026-07-28: bloqueaba ajustes de supervisor en modo edición
                                        // porque comparaba contra el peso_real original, nunca actualizado.
                                        const nuevaSuma = nuevos.reduce((s, lc) => s + (parseFloat(lc.cantidad_kg) || 0), 0);
                                        setFormData({ ...formData, lotes_consumo: nuevos, peso_real: String(nuevaSuma) });
                                        setStockError(null);
                                      }}
                                      className="w-24 px-2 py-1 border border-purple-300 rounded text-sm focus:ring-2 focus:ring-purple-400"
                                    />
                                    <span className="text-xs text-gray-500">g</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {/* Indicador de suma vs peso real */}
                          {formData.lotes_consumo.length > 0 && (() => {
                            const pesoReal = Number(formData.peso_real);
                            const suma = formData.lotes_consumo.reduce((s, l) => s + (parseFloat(l.cantidad_kg) || 0), 0);
                            const pendiente = pesoReal - suma;
                            const ok = Math.abs(pendiente) <= 1;
                            return (
                              <div className={`text-xs mt-1 font-medium ${ok ? 'text-green-700' : 'text-amber-700'}`}>
                                Asignado: {suma.toFixed(0)}g / Pendiente: {pendiente.toFixed(0)}g
                                {ok ? ' ✓' : pendiente > 0 ? ` — faltan ${pendiente.toFixed(0)}g` : ` — exceso de ${(-pendiente).toFixed(0)}g`}
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        <div>
                          <input
                            type="text"
                            value={formData.lote}
                            onChange={(e) => setFormData({ ...formData, lote: e.target.value })}
                            placeholder="Ingrese el lote manualmente"
                            className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="text-xs text-amber-600 mt-1">
                            ⚠ No hay lotes registrados en SAP. Sincroniza el inventario o ingresa el lote manualmente.
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Vencimiento
                        {formData.fecha_vencimiento_display && (
                          <span className="ml-2 text-xs text-green-600 font-normal">
                            → {new Date(formData.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        placeholder="27, 2702, 270226, 27/02/26..."
                        value={formData.fecha_vencimiento_display ?? formData.fecha_vencimiento}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parsed = parseFechaVencimiento(raw);
                          setFormData({
                            ...formData,
                            fecha_vencimiento_display: raw,
                            fecha_vencimiento: parsed ?? ''
                          });
                        }}
                        onBlur={(e) => {
                          const parsed = parseFechaVencimiento(e.target.value);
                          if (parsed) {
                            setFormData({
                              ...formData,
                              fecha_vencimiento: parsed,
                              fecha_vencimiento_display: undefined
                            });
                          } else if (e.target.value.trim() !== '') {
                            setFormData({
                              ...formData,
                              fecha_vencimiento: '',
                              fecha_vencimiento_display: undefined
                            });
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="date"
                        value={formData.fecha_vencimiento}
                        onChange={(e) => setFormData({ ...formData, fecha_vencimiento: e.target.value, fecha_vencimiento_display: undefined })}
                        className="w-full mt-1 px-3 py-2 border border-gray-200 rounded text-xs text-gray-500"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2">
                      <button
                        onClick={() => handleGuardar(ing.id)}
                        disabled={
                          ing.lotes?.length > 0 && formData.lotes_consumo.filter(l => parseFloat(l.cantidad_kg) > 0).length === 0
                        }
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          ing.lotes?.length > 0 && formData.lotes_consumo.filter(l => parseFloat(l.cantidad_kg) > 0).length === 0
                            ? 'Selecciona un lote e ingresa la cantidad'
                            : 'Guardar pesaje'
                        }
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => { setEditando(null); setStockError(null); }}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {ing.pesado && puedeEditar && editando !== ing.id && (
                  <button
                    onClick={() => handleEditar(ing)}
                    className="mt-2 px-3 py-1.5 bg-amber-500 text-white rounded hover:bg-amber-600 text-xs font-medium"
                  >
                    ✏️ Editar pesaje
                  </button>
                )}

                {/* Datos de pesaje completado */}
                {ing.pesado && editando === ing.id && puedeEditar && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-700 mb-2">
                    ✏️ Modo edición — solo admin/supervisor
                  </div>
                )}
                {ing.pesado && (
                  <div className="mt-4 grid grid-cols-3 gap-4 text-sm p-4 bg-green-50 rounded">
                    <div>
                      <span className="text-gray-600">Peso Real:</span>
                      <span className="font-semibold ml-2">{ing.peso_real}g</span>
                      {ing.diferencia_gramos !== 0 && (
                        <span className={`ml-2 ${ing.diferencia_gramos > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ({ing.diferencia_gramos > 0 ? '+' : ''}{ing.diferencia_gramos}g)
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-600">Lote:</span>
                      <span className="font-semibold ml-2">{ing.lote}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Vence:</span>
                      <span className="font-semibold ml-2">{ing.fecha_vencimiento ? formatDate(ing.fecha_vencimiento.slice(0, 10)) : '—'}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Botones de acción */}
        <div className="flex justify-between">
          <button
            onClick={() => navigate(`/planificacion/masas/${masaId}`)}
            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            ← Volver
          </button>

          <div className="flex gap-3">
            {puedeEditar && (
              <button
                onClick={() => { setMotivoCancelar(''); setMostrarCancelar(true); }}
                disabled={hayAlgoPesado}
                title={hayAlgoPesado ? 'No se puede cancelar: ya hay ingredientes pesados' : ''}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ✕ Cancelar Masa
              </button>
            )}
            <button
              onClick={() => setShowMO(true)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
            >
              + Mano de obra
            </button>
            {checklist.todosPesados && !checklist.pesaje_completado && (
              <button
                onClick={handleConfirmar}
                disabled={confirmarMutation.isPending || confirmando}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold"
              >
                {(confirmarMutation.isPending || confirmando) ? '⏳ Enviando a SAP...' : '✅ Confirmar Pesaje Completo'}
              </button>
            )}
            {checklist.pesaje_completado && (
              <div className="flex items-center gap-2 px-5 py-3 bg-green-50 border border-green-300 rounded-lg">
                <span className="text-green-700 font-semibold text-sm">
                  ✅ Transmitido a SAP
                </span>
                {checklist.sap_doc_num_pesaje && (
                  <span className="text-xs text-green-600 font-mono bg-green-100 px-2 py-1 rounded">
                    Salida Nº {checklist.sap_doc_num_pesaje}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {showMO && <ModalMO masaId={Number(masaId)} fase="PESAJE" onClose={() => setShowMO(false)} />}
        {pendingAjuste && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Este pesaje ya fue transmitido a SAP</h3>
              <p className="text-sm text-gray-600 mb-4">
                Modificaste <strong>{pendingAjuste.ingredienteNombre}</strong> de{' '}
                {pendingAjuste.pesoAnterior}g a {pendingAjuste.pesoNuevo}g
                {' '}({pendingAjuste.pesoNuevo > pendingAjuste.pesoAnterior ? '+' : ''}
                {(pendingAjuste.pesoNuevo - pendingAjuste.pesoAnterior).toFixed(0)}g).
                El cambio ya se guardó localmente. ¿Transmitir este ajuste a SAP ahora
                (como {pendingAjuste.pesoNuevo > pendingAjuste.pesoAnterior ? 'salida adicional' : 'entrada de devolución'})?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPendingAjuste(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                >
                  Ahora no
                </button>
                <button
                  disabled={ajustarSapMutation.isPending}
                  onClick={async () => {
                    const ajuste = pendingAjuste;
                    setPendingAjuste(null);
                    try {
                      const resultado = await ajustarSapMutation.mutateAsync({
                        masaId: masaIdNum,
                        ingredienteId: ajuste!.ingredienteId,
                      });
                      alert(resultado?.message || 'Ajuste procesado.');
                    } catch (err: any) {
                      alert(`⚠ No se pudo transmitir el ajuste a SAP: ${err?.message || 'Error desconocido'}. El dato local ya quedó guardado; puedes reintentar más tarde.`);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {ajustarSapMutation.isPending ? 'Enviando a SAP...' : 'Transmitir a SAP'}
                </button>
              </div>
            </div>
          </div>
        )}
        {mostrarCancelar && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Cancelar Masa</h3>
              <p className="text-sm text-gray-600 mb-4">
                Se liberará el stock reservado y la OV en SAP. El motivo es obligatorio.
              </p>
              <textarea
                value={motivoCancelar}
                onChange={(e) => setMotivoCancelar(e.target.value)}
                placeholder="Motivo de la cancelación (obligatorio)..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 text-sm resize-none"
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setMostrarCancelar(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
                >
                  Volver
                </button>
                <button
                  onClick={handleConfirmarCancelar}
                  disabled={cancelarMutation.isPending || !motivoCancelar.trim()}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {cancelarMutation.isPending ? 'Cancelando...' : 'Confirmar cancelación'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PesajeMasa;
