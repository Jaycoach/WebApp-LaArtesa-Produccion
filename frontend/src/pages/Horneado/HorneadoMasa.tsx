/**
 * HorneadoMasa.tsx
 * Fase de HORNEADO — ARTESA
 * Actualizado 2026-03-02
 *
 * Flujo: Iniciar horneado → [actualizar temperaturas/damper] → Completar → ir a Empaque
 */
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalMO } from '../../components/common/ModalMO';
import { BarraNavegacionFases } from '../../components/common/BarraNavegacionFases';
import { formatBogotaTime } from '../../utils/timezone';

const getToken = () => {
  try {
    const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return auth?.state?.token || auth?.state?.accessToken || '';
  } catch { return ''; }
};

const getUsuarioRol = (): string => {
  try {
    const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return auth?.state?.usuario?.rol || auth?.state?.user?.rol || '';
  } catch { return ''; }
};

const fetchHorneado = async (masaId: string) => {
  const res = await fetch(`/api/horneado/${masaId}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.message || 'Error al cargar horneado');
  return d.data;
};

type EtapaHorno = 'inicio' | 'en_progreso' | 'completado';

export const HorneadoMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const queryClient = useQueryClient();

  const [etapa, setEtapa] = useState<EtapaHorno>('inicio');
  const [showMO, setShowMO] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // Form inicio
  const [tipoHornoId, setTipoHornoId] = useState<number | null>(null);
  const [programaId, setProgramaId] = useState<number | null>(null);
  const [tempInicialReal, setTempInicialReal] = useState('');
  const [usaDamper, setUsaDamper] = useState(false);

  // Form completar — claves coinciden con el campo del controller (calidad_color, calidad_coccion)
  const [calidadColor, setCalidadColor] = useState('PERFECTO');
  const [calidadCoccion, setCalidadCoccion] = useState('PERFECTO');
  const [unidadesTerminadas, setUnidadesTerminadas] = useState('');
  const [unidadesPorProducto, setUnidadesPorProducto] = useState<Record<number, string>>({});
  const [modoEdicionRetro, setModoEdicionRetro] = useState(false);
  const [unidadesRetro, setUnidadesRetro] = useState<Record<number, string>>({});
  const [motivoRetro, setMotivoRetro] = useState('');
  const [guardandoRetro, setGuardandoRetro] = useState(false);
  const [msgRetro, setMsgRetro] = useState<{tipo:'ok'|'err', texto:string}|null>(null);
  const rolUsuario = getUsuarioRol();
  const esAdminOSupervisor = ['admin', 'supervisor'].includes(rolUsuario);

  const { data, isLoading } = useQuery({
    queryKey: ['horneado', masaId],
    queryFn: () => fetchHorneado(masaId!),
    enabled: !!masaId,
  });

  useEffect(() => {
    if (!data?.registro_actual) return;
    const reg = data.registro_actual;
    if (!reg.hora_entrada) setEtapa('inicio');
    else if (!reg.hora_salida) {
      setEtapa('en_progreso');
      setTipoHornoId(reg.tipo_horno_id);
    } else setEtapa('completado');

    // Inicializar inputs por producto con datos existentes si los hay
    if (reg.unidades_terminadas_por_producto && data?.productos_horneado?.length) {
      const init: Record<number, string> = {};
      for (const p of data.productos_horneado) {
        const val = reg.unidades_terminadas_por_producto[String(p.id)];
        init[p.id] = val != null ? String(val) : '';
      }
      setUnidadesPorProducto(init);
    } else if (data?.productos_horneado?.length) {
      const init: Record<number, string> = {};
      for (const p of data.productos_horneado) init[p.id] = '';
      setUnidadesPorProducto(init);
    }
  }, [data]);

  const iniciarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/horneado/${masaId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          tipo_horno_id: tipoHornoId,
          programa_horneo_id: programaId,
          temperatura_inicial_real: parseFloat(tempInicialReal) || null,
          uso_damper_real: usaDamper,
          observaciones
        })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onSuccess: () => { setEtapa('en_progreso'); queryClient.invalidateQueries({ queryKey: ['horneado', masaId] }); },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const completarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/horneado/${masaId}/completar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        // Controller espera calidad_color y calidad_coccion (snake_case)
        body: JSON.stringify({
          calidad_color: calidadColor,
          calidad_coccion: calidadCoccion,
          observaciones,
          unidades_terminadas: Object.values(unidadesPorProducto).reduce((s, v) => s + (parseInt(v) || 0), 0) || null,
          unidades_por_producto: Object.fromEntries(
            Object.entries(unidadesPorProducto).map(([k, v]) => [k, parseInt(v) || 0])
          )
        })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onSuccess: () => {
      setEtapa('completado');
      queryClient.invalidateQueries({ queryKey: ['horneado', masaId] });
      queryClient.invalidateQueries({ queryKey: ['fases', masaId] });
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  // Valida que todos los productos activos tengan unidades terminadas > 0
  // antes de permitir completar — mismo criterio que DIVISION (fases.controller.js):
  // SAP no permite crear una OV sin cantidad, así que 0 siempre es error de captura.
  const todasTienenCantidad = (): boolean => {
    if (data?.productos_horneado && data.productos_horneado.length > 0) {
      return data.productos_horneado.every((p: any) => (parseInt(unidadesPorProducto[p.id]) || 0) > 0);
    }
    return (parseInt(unidadesTerminadas) || 0) > 0;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
      </div>
    );
  }

  const masa = data?.masa || {};
  // Controller retorna hornos_disponibles y programas_todos
  const hornos = data?.hornos_disponibles || [];
  const programas = data?.programas_todos || [];

  const hornoSeleccionado = hornos.find((h: any) => h.id === tipoHornoId);
  const programaSeleccionado = programas.find((p: any) => p.id === programaId);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <BarraNavegacionFases
          masaId={masaId!}
          codigoMasa={masa.codigo}
          faseAnterior={{ label: 'Fermentación', ruta: `/fermentacion/${masaId}` }}
          faseSiguiente={{
            label: 'Empaque',
            ruta: `/empaque/${masaId}`,
            habilitada: etapa === 'completado',
          }}
        />

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">🔥</span>
                <h1 className="text-2xl font-bold text-gray-900">Horneado</h1>
                <span className="px-2 py-1 bg-red-100 text-red-700 text-sm rounded-full font-medium">
                  {masa.tipo}
                </span>
              </div>
              <p className="text-gray-500 text-sm">{masa.codigo} — {masa.nombre}</p>
            </div>
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">⚠️ {errorMsg}</p>
          </div>
        )}

        {/* Formulario Inicio */}
        {etapa === 'inicio' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Configurar Horneado</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Horno</label>
                <select value={tipoHornoId || ''} onChange={e => {
                    const id = Number(e.target.value);
                    setTipoHornoId(id);
                    const horno = hornos.find((h: any) => h.id === id);
                    if (horno?.tipo === 'PISO') {
                      const programaUno = programas.find((p: any) => p.numero_programa === 1);
                      setProgramaId(programaUno ? programaUno.id : null);
                    }
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400">
                  <option value="">Seleccionar horno...</option>
                  {hornos.map((h: any) => (
                    <option key={h.id} value={h.id}>{h.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Programa</label>
                <select value={programaId || ''} onChange={e => setProgramaId(Number(e.target.value))}
                  disabled={hornoSeleccionado?.tipo === 'PISO'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:bg-gray-100 disabled:text-gray-500">
                  <option value="">Seleccionar programa...</option>
                  {programas.map((p: any) => (
                    <option key={p.id} value={p.id}>Programa {p.numero_programa}</option>
                  ))}
                </select>
                {hornoSeleccionado?.tipo === 'PISO' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Horno tipo Piso — Programa fijo en 1
                  </p>
                )}
              </div>
            </div>

            {/* Info del programa seleccionado */}
            {programaSeleccionado && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 grid grid-cols-3 gap-3 text-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-700">{programaSeleccionado.temperatura_inicial}°C</div>
                  <div className="text-xs text-gray-500">Temp. inicial</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-700">{programaSeleccionado.temperatura_media}°C</div>
                  <div className="text-xs text-gray-500">Temp. media</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-700">{programaSeleccionado.tiempo_total_minutos} min</div>
                  <div className="text-xs text-gray-500">Tiempo total</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Temperatura real entrada °C</label>
                <input type="number" value={tempInicialReal} onChange={e => setTempInicialReal(e.target.value)}
                  placeholder="180" className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={usaDamper} onChange={e => setUsaDamper(e.target.checked)}
                    className="w-4 h-4 text-red-600" />
                  <span className="text-sm font-medium text-gray-700">Usa damper</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
              <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
            </div>

            <button
              onClick={() => iniciarMutation.mutate()}
              disabled={iniciarMutation.isPending || !tipoHornoId}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {iniciarMutation.isPending ? 'Iniciando...' : '🔥 Iniciar Horneado'}
            </button>
          </div>
        )}

        {/* En progreso */}
        {etapa === 'en_progreso' && (
          <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
              <h2 className="text-lg font-semibold text-red-700">🔥 Horneado en progreso</h2>
            </div>
            <p className="text-gray-600 text-sm">
              Monitorea temperaturas y damper según el programa. Cuando el proceso termine, completa el horneado.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Evaluación de Color</label>
                <select value={calidadColor} onChange={e => setCalidadColor(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400">
                  {['PERFECTO', 'ACEPTABLE', 'BAJO', 'SOBRECOCIDO'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Evaluación de Cocción</label>
                <select value={calidadCoccion} onChange={e => setCalidadCoccion(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400">
                  {['PERFECTO', 'ACEPTABLE', 'CRUDO', 'SOBRECOCIDO'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            </div>

            {/* Unidades terminadas por producto */}
            {data?.productos_horneado && data.productos_horneado.length > 0 ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Unidades terminadas por producto <span className="text-red-500">*</span>
                </label>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Producto</th>
                        <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Divididas</th>
                        <th className="text-right px-3 py-2 text-xs text-gray-500 font-medium">Terminadas <span className="text-red-500">*</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.productos_horneado.map((p: any) => (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-800 text-xs">{p.producto_nombre}</div>
                            <div className="text-xs text-gray-400 font-mono">{p.sap_item_code}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="font-mono text-blue-600 font-semibold">
                              {p.cantidad_divisiones > 0 ? p.cantidad_divisiones : '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min="0"
                              value={unidadesPorProducto[p.id] ?? ''}
                              onChange={e => setUnidadesPorProducto(prev => ({ ...prev, [p.id]: e.target.value }))}
                              placeholder={String(p.cantidad_divisiones || 0)}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:ring-1 focus:ring-red-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td className="px-3 py-2 text-xs font-semibold text-gray-600">Total</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">
                          {data.productos_horneado.reduce((s: number, p: any) => s + (p.cantidad_divisiones || 0), 0)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-green-700">
                          {Object.values(unidadesPorProducto).reduce((s, v) => s + (parseInt(v) || 0), 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unidades terminadas <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={unidadesTerminadas}
                  onChange={e => setUnidadesTerminadas(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones finales</label>
              <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
            </div>

            {!todasTienenCantidad() && (
              <p className="text-xs text-red-500 font-medium">
                ⚠ Debes ingresar las unidades terminadas para todos los productos
              </p>
            )}
            {showMO && <ModalMO masaId={Number(masaId)} fase="HORNEADO" onClose={() => setShowMO(false)} />}
          </div>
        )}

        {/* Botones sticky — nunca requiere scroll para completar */}
        {etapa === 'en_progreso' && (
          <div className="sticky bottom-0 z-10 bg-gray-50 border-t border-gray-200 px-4 py-3 -mx-6 flex gap-3">
            <button
              onClick={() => setShowMO(true)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
            >
              + Mano de obra
            </button>
            <button
              onClick={() => completarMutation.mutate()}
              disabled={completarMutation.isPending || !todasTienenCantidad()}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {completarMutation.isPending ? 'Completando...' : '✅ Completar Horneado → Ir a Empaque'}
            </button>
          </div>
        )}

        {/* Completado */}
        {etapa === 'completado' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">✅</span>
              <div>
                <h2 className="text-lg font-semibold text-green-800">Horneado completado</h2>
                <p className="text-green-600 text-sm">¡Producción exitosa! Listo para empaque.</p>
              </div>
            </div>
            {data?.registro_actual && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {data.registro_actual.horno_nombre && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Horno</div>
                    <div className="font-semibold text-gray-800">{data.registro_actual.horno_nombre}</div>
                  </div>
                )}
                {data.registro_actual.temperatura_inicial_real != null && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Temp. entrada real</div>
                    <div className="font-semibold text-gray-800">{data.registro_actual.temperatura_inicial_real}°C</div>
                  </div>
                )}
                {data.registro_actual.uso_damper_real != null && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Damper</div>
                    <div className="font-semibold text-gray-800">{data.registro_actual.uso_damper_real ? 'Sí' : 'No'}</div>
                  </div>
                )}
                {data.registro_actual.calidad_color && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Color</div>
                    <div className="font-semibold text-gray-800">{data.registro_actual.calidad_color}</div>
                  </div>
                )}
                {data.registro_actual.calidad_coccion && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Cocción</div>
                    <div className="font-semibold text-gray-800">{data.registro_actual.calidad_coccion}</div>
                  </div>
                )}
                {data.registro_actual.unidades_terminadas != null && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 col-span-2">
                    <div className="text-xs text-blue-500 mb-1 font-semibold">Panes entregados</div>
                    {/* Desglose por producto si existe */}
                    {data?.productos_horneado && data.productos_horneado.length > 0 ? (
                      <div className="space-y-1">
                        {data.productos_horneado.map((p: any) => {
                          const terminProd = data.registro_actual.unidades_terminadas_por_producto?.[String(p.id)];
                          return (
                            <div key={p.id} className="flex justify-between items-center text-sm">
                              <span className="text-gray-600 text-xs truncate max-w-[60%]">{p.producto_nombre}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-blue-500 font-mono">{p.cantidad_divisiones} div.</span>
                                <span className={`font-bold font-mono ${terminProd != null ? 'text-blue-800' : 'text-gray-400'}`}>
                                  {terminProd != null ? terminProd : '—'} horn.
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        <div className="border-t border-blue-200 pt-1 flex justify-between">
                          <span className="text-xs font-semibold text-blue-600">Total</span>
                          <span className="font-bold text-blue-800 text-lg">{data.registro_actual.unidades_terminadas}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="font-bold text-blue-800 text-lg">{data.registro_actual.unidades_terminadas}</div>
                    )}
                  </div>
                )}
                {/* Panel edición retroactiva — solo admin/supervisor */}
                {esAdminOSupervisor && data.registro_actual.unidades_terminadas != null && (
                  <div className="col-span-2 border border-amber-200 bg-amber-50 rounded-lg p-3">
                    {!modoEdicionRetro ? (
                      <button
                        onClick={() => {
                          const init: Record<number, string> = {};
                          for (const p of (data.productos_horneado || [])) {
                            const v = data.registro_actual.unidades_terminadas_por_producto?.[String(p.id)];
                            init[p.id] = v != null ? String(v) : '';
                          }
                          setUnidadesRetro(init);
                          setMotivoRetro('');
                          setModoEdicionRetro(true);
                        }}
                        className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 font-medium"
                      >
                        ✏️ Editar unidades (admin)
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-amber-800">Edición retroactiva</span>
                          <button onClick={() => setModoEdicionRetro(false)} className="text-xs text-gray-500 hover:text-gray-700">✕ Cancelar</button>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-amber-700">
                              <th className="text-left pb-1">Producto</th>
                              <th className="text-right pb-1">Divididas</th>
                              <th className="text-right pb-1">Terminadas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(data.productos_horneado || []).map((p: any) => (
                              <tr key={p.id}>
                                <td className="text-xs text-gray-700 py-1">{p.producto_nombre}</td>
                                <td className="text-right text-xs text-blue-600 font-mono pr-2">{p.cantidad_divisiones}</td>
                                <td className="text-right py-1">
                                  <input
                                    type="number" min="0"
                                    value={unidadesRetro[p.id] ?? ''}
                                    onChange={e => setUnidadesRetro(prev => ({ ...prev, [p.id]: e.target.value }))}
                                    className="w-20 border border-amber-300 rounded px-2 py-0.5 text-right text-sm focus:ring-1 focus:ring-amber-400"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="border-t border-amber-200">
                            <tr>
                              <td colSpan={2} className="text-xs font-semibold text-amber-700 pt-1">Nuevo total</td>
                              <td className="text-right font-bold text-amber-800 pt-1">
                                {Object.values(unidadesRetro).reduce((s, v) => s + (parseInt(v) || 0), 0)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                        <div>
                          <label className="block text-xs font-medium text-amber-800 mb-1">
                            Motivo de modificación <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={motivoRetro}
                            onChange={e => setMotivoRetro(e.target.value)}
                            placeholder="Ej: Corrección de conteo manual post-horneado"
                            className="w-full border border-amber-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-amber-400"
                          />
                          {motivoRetro.trim().length < 5 && (
                            <p className="text-xs text-amber-700 mt-1">
                              ⚠️ Ingresa al menos 5 caracteres para habilitar el guardado ({motivoRetro.trim().length}/5)
                            </p>
                          )}
                        </div>
                        {msgRetro && (
                          <div className={`text-xs px-2 py-1 rounded ${msgRetro.tipo === 'ok' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {msgRetro.texto}
                          </div>
                        )}
                        <button
                          disabled={guardandoRetro || motivoRetro.trim().length < 5}
                          onClick={async () => {
                            if (motivoRetro.trim().length < 5) return;
                            setGuardandoRetro(true);
                            try {
                              const payload = Object.fromEntries(
                                Object.entries(unidadesRetro).map(([k, v]) => [k, parseInt(v) || 0])
                              );
                              const res = await fetch(`/api/horneado/${masaId}/unidades-por-producto`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                                body: JSON.stringify({ unidades_por_producto: payload, motivo: motivoRetro }),
                              });
                              const d = await res.json();
                              if (!d.success) throw new Error(d.message);
                              setMsgRetro({ tipo: 'ok', texto: 'Actualizado correctamente. Recargando...' });
                              setTimeout(() => {
                                queryClient.invalidateQueries({ queryKey: ['horneado', masaId] });
                                setModoEdicionRetro(false);
                                setMsgRetro(null);
                              }, 1500);
                            } catch (e: any) {
                              setMsgRetro({ tipo: 'err', texto: e.message });
                            } finally {
                              setGuardandoRetro(false);
                            }
                          }}
                          className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold rounded"
                        >
                          {guardandoRetro ? 'Guardando...' : '💾 Guardar corrección'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {data.registro_actual.hora_entrada && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Entrada horno</div>
                    <div className="font-semibold text-gray-800">{formatBogotaTime(data.registro_actual.hora_entrada)}</div>
                  </div>
                )}
                {data.registro_actual.hora_salida && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Salida horno</div>
                    <div className="font-semibold text-gray-800">{formatBogotaTime(data.registro_actual.hora_salida)}</div>
                  </div>
                )}
              </div>
            )}
            {data?.registro_actual?.observaciones && (
              <div className="bg-white rounded-lg p-3 border border-green-100 text-sm">
                <div className="text-xs text-gray-500 mb-0.5">Observaciones</div>
                <div className="text-gray-800">{data.registro_actual.observaciones}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HorneadoMasa;
