/**
 * FermentacionMasa.tsx
 * Fase de FERMENTACIÓN — ARTESA
 * Actualizado 2026-03-02
 *
 * Flujo: Entrada Cámara → Salida Cámara → [opcional: Entrada Frío → Salida Frío]
 * La completación de la fase desbloquea HORNEADO
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ─────────────────────────────────────────────
const getToken = () => {
  try {
    const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return auth?.state?.token || auth?.state?.accessToken || '';
  } catch { return ''; }
};

const apiPost = async (url: string, body: object) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body)
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.message || 'Error en la operación');
  return d;
};

const fetchFermentacion = async (masaId: string) => {
  const res = await fetch(`/api/fermentacion/${masaId}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.message || 'Error al cargar fermentación');
  return d.data;
};

// ─────────────────────────────────────────────
type SubEtapa = 'entrada_camara' | 'salida_camara' | 'entrada_frio' | 'salida_frio' | 'completada';

export const FermentacionMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [subEtapa, setSubEtapa] = useState<SubEtapa>('entrada_camara');
  const [temperatura, setTemperatura] = useState('');
  const [humedad, setHumedad] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [horaSalidaReal, setHoraSalidaReal] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['fermentacion', masaId],
    queryFn: () => fetchFermentacion(masaId!),
    enabled: !!masaId,
  });

  useEffect(() => {
    if (!data?.registro_actual) return;
    const reg = data.registro_actual;
    // Columnas del controller: hora_entrada_camara, hora_salida_camara_real, requiere_camara_frio, hora_entrada_frio, hora_salida_frio
    if (!reg.hora_entrada_camara) setSubEtapa('entrada_camara');
    else if (!reg.hora_salida_camara_real) setSubEtapa('salida_camara');
    else if (reg.requiere_camara_frio && !reg.hora_entrada_frio) setSubEtapa('entrada_frio');
    else if (reg.requiere_camara_frio && !reg.hora_salida_frio) setSubEtapa('salida_frio');
    else setSubEtapa('completada');
  }, [data]);

  const mutacion = useMutation({
    mutationFn: async ({ endpoint, body }: { endpoint: string; body: object }) =>
      apiPost(`/api/fermentacion/${masaId}/${endpoint}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fermentacion', masaId] });
      setErrorMsg('');
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const avanzar = (endpoint: string, body: object = {}) => {
    mutacion.mutate({ endpoint, body: { ...body, observaciones } });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const masa = data?.masa || {};
  const registro = data?.registro_actual;
  // Columna real del controller: hora_salida_camara_sugerida
  const horaSalidaSugerida = registro?.hora_salida_camara_sugerida;
  // requiere_camara_frio viene dentro de data.masa (no en data directamente)
  const requiereFrio = data?.masa?.requiere_camara_frio || false;

  const pasos: { key: SubEtapa; label: string; icono: string }[] = [
    { key: 'entrada_camara', label: 'Entrada cámara', icono: '🌡️' },
    { key: 'salida_camara', label: 'Salida cámara', icono: '⏱️' },
    ...(requiereFrio
      ? [
          { key: 'entrada_frio' as SubEtapa, label: 'Entrada frío', icono: '❄️' },
          { key: 'salida_frio' as SubEtapa, label: 'Salida frío', icono: '✅' },
        ]
      : []),
  ];

  const pasoActualIdx = pasos.findIndex(p => p.key === subEtapa);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">🌡️</span>
                <h1 className="text-2xl font-bold text-gray-900">Fermentación</h1>
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-sm rounded-full font-medium">
                  {masa.tipo}
                </span>
              </div>
              <p className="text-gray-500 text-sm">{masa.codigo} — {masa.nombre}</p>
            </div>
            <button
              onClick={() => navigate(`/planificacion/masas/${masaId}`)}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              ← Volver
            </button>
          </div>
        </div>

        {/* Barra de progreso de sub-etapas */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            {pasos.map((paso, idx) => {
              const completado = idx < pasoActualIdx || subEtapa === 'completada';
              const activo = paso.key === subEtapa;
              return (
                <React.Fragment key={paso.key}>
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg
                      ${completado ? 'bg-green-100' : activo ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-gray-100'}`}>
                      {completado ? '✅' : paso.icono}
                    </div>
                    <span className={`text-xs font-medium ${activo ? 'text-blue-700' : completado ? 'text-green-700' : 'text-gray-400'}`}>
                      {paso.label}
                    </span>
                  </div>
                  {idx < pasos.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 ${idx < pasoActualIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">⚠️ {errorMsg}</p>
          </div>
        )}

        {/* Panel de acción */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">

          {subEtapa === 'entrada_camara' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800">Entrada a Cámara de Fermentación</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Temperatura °C</label>
                  <input type="number" value={temperatura} onChange={e => setTemperatura(e.target.value)}
                    placeholder="32" className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Humedad %</label>
                  <input type="number" value={humedad} onChange={e => setHumedad(e.target.value)}
                    placeholder="75" className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
                <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                  rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
              <button
                onClick={() => avanzar('camara/entrada', { temperatura_camara: parseFloat(temperatura), humedad_camara: parseFloat(humedad) })}
                disabled={mutacion.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {mutacion.isPending ? 'Registrando...' : '🌡️ Registrar Entrada a Cámara'}
              </button>
            </>
          )}

          {subEtapa === 'salida_camara' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800">Salida de Cámara de Fermentación</h2>
              {horaSalidaSugerida && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-blue-800 text-sm">
                    ⏰ Salida sugerida: <strong>{new Date(horaSalidaSugerida).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</strong>
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hora real de salida <span className="text-gray-400 font-normal">(opcional — por defecto hora actual)</span>
                </label>
                <input
                  type="datetime-local"
                  value={horaSalidaReal}
                  onChange={e => setHoraSalidaReal(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
                <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                  rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
              <button
                onClick={() => avanzar('camara/salida', { hora_salida_real: horaSalidaReal || undefined })}
                disabled={mutacion.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {mutacion.isPending ? 'Registrando...' : '⏱️ Registrar Salida de Cámara'}
              </button>
            </>
          )}

          {subEtapa === 'entrada_frio' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                ❄️ Entrada a Cámara de Frío
              </h2>
              <p className="text-gray-600 text-sm">Esta masa requiere paso por cámara de frío.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
                <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                  rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
              <button
                onClick={() => avanzar('frio/entrada')}
                disabled={mutacion.isPending}
                className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {mutacion.isPending ? 'Registrando...' : '❄️ Registrar Entrada a Frío'}
              </button>
            </>
          )}

          {subEtapa === 'salida_frio' && (
            <>
              <h2 className="text-lg font-semibold text-gray-800">Salida de Cámara de Frío</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Hora real de salida <span className="text-gray-400 font-normal">(opcional — por defecto hora actual)</span>
                </label>
                <input
                  type="datetime-local"
                  value={horaSalidaReal}
                  onChange={e => setHoraSalidaReal(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
                <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                  rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              </div>
              <button
                onClick={() => avanzar('frio/salida', { hora_salida_real: horaSalidaReal || undefined })}
                disabled={mutacion.isPending}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {mutacion.isPending ? 'Completando...' : '✅ Registrar Salida y Completar Fermentación'}
              </button>
            </>
          )}

          {subEtapa === 'completada' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">✅</span>
                <div>
                  <h2 className="text-lg font-semibold text-green-800">Fermentación completada</h2>
                  <p className="text-green-600 text-sm">La fase de fermentación ha sido registrada.</p>
                </div>
              </div>
              <button
                onClick={() => navigate(`/horneado/${masaId}`)}
                className="bg-orange-600 hover:bg-orange-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                🔥 Ir a Horneado →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FermentacionMasa;
