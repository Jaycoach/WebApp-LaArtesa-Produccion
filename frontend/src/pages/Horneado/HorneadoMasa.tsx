/**
 * HorneadoMasa.tsx
 * Fase de HORNEADO — ARTESA
 * Actualizado 2026-03-02
 *
 * Flujo: Iniciar horneado → [actualizar temperaturas/damper] → Completar → ir a Empaque
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalMO } from '../../components/common/ModalMO';

const getToken = () => {
  try {
    const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return auth?.state?.token || auth?.state?.accessToken || '';
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
  const navigate = useNavigate();
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

  const { data, isLoading } = useQuery({
    queryKey: ['horneado', masaId],
    queryFn: () => fetchHorneado(masaId!),
    enabled: !!masaId,
  });

  useEffect(() => {
    if (!data?.registro_actual) return;
    const reg = data.registro_actual;
    // Columnas del controller: hora_entrada (inicio) y hora_salida (fin)
    if (!reg.hora_entrada) setEtapa('inicio');
    else if (!reg.hora_salida) {
      setEtapa('en_progreso');
      setTipoHornoId(reg.tipo_horno_id);
    } else setEtapa('completado');
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
          unidades_terminadas: parseInt(unidadesTerminadas) || null
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

  const programaSeleccionado = programas.find((p: any) => p.id === programaId);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

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
            <button onClick={() => navigate(`/planificacion/masas/${masaId}`)} className="text-sm text-gray-500 hover:text-gray-800">← Volver</button>
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
                <select value={tipoHornoId || ''} onChange={e => setTipoHornoId(Number(e.target.value))}
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400">
                  <option value="">Seleccionar programa...</option>
                  {programas.map((p: any) => (
                    <option key={p.id} value={p.id}>Prog. {p.numero_programa} — {p.nombre}</option>
                  ))}
                </select>
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
            <button
              onClick={() => navigate(`/planificacion/masas/${masaId}`)}
              className="w-full px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium"
            >
              ← Volver al detalle
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

            {/* Unidades divididas (referencia de división, solo lectura) */}
            {(data?.unidades_divididas ?? 0) > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                <p className="text-xs text-blue-500 mb-0.5">Unidades divididas (de división)</p>
                <p className="text-2xl font-bold text-blue-700">{data.unidades_divididas}</p>
              </div>
            )}

            {/* Unidades terminadas — ingresadas por el hornero */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unidades terminadas <span className="text-red-500">*</span>
                {(data?.unidades_divididas ?? 0) > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    (referencia: {data.unidades_divididas} divididas)
                  </span>
                )}
              </label>
              <input
                type="number"
                min="0"
                value={unidadesTerminadas}
                onChange={e => setUnidadesTerminadas(e.target.value)}
                placeholder={String(data?.unidades_divididas ?? '')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones finales</label>
              <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowMO(true)}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
              >
                + Mano de obra
              </button>
              <button
                onClick={() => completarMutation.mutate()}
                disabled={completarMutation.isPending}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {completarMutation.isPending ? 'Completando...' : '✅ Completar Horneado → Ir a Empaque'}
              </button>
            </div>
            <button
              onClick={() => navigate(`/planificacion/masas/${masaId}`)}
              className="w-full px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium"
            >
              ← Volver al detalle
            </button>
            {showMO && <ModalMO masaId={Number(masaId)} fase="HORNEADO" onClose={() => setShowMO(false)} />}
          </div>
        )}

        {/* Navegación entre fases */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(`/fermentacion/${masaId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700 rounded-lg text-sm font-medium shadow-sm transition-colors"
          >
            ← Fermentación
          </button>
          {etapa === 'completado' && (
            <button
              onClick={() => navigate('/empaque')}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              📦 Empaque →
            </button>
          )}
        </div>

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
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <div className="text-xs text-blue-500 mb-0.5">Panes entregados</div>
                    <div className="font-bold text-blue-800 text-lg">{data.registro_actual.unidades_terminadas}</div>
                  </div>
                )}
                {data.registro_actual.hora_entrada && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Entrada horno</div>
                    <div className="font-semibold text-gray-800">{new Date(data.registro_actual.hora_entrada).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                )}
                {data.registro_actual.hora_salida && (
                  <div className="bg-white rounded-lg p-3 border border-green-100">
                    <div className="text-xs text-gray-500 mb-0.5">Salida horno</div>
                    <div className="font-semibold text-gray-800">{new Date(data.registro_actual.hora_salida).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
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
