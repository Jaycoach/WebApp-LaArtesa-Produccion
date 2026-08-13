/**
 * FermentacionMasa.tsx
 * Fase de FERMENTACIÓN — ARTESA
 * Fase 6 (13-ago-2026): fermentación por producto/línea — cada línea
 * entra/sale de cámara de forma independiente (cámara libre entre las 3
 * del catálogo, incluida la fría). La fase se completa explícitamente
 * cuando todas las líneas tienen salida registrada.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalMO } from '../../components/common/ModalMO';
import { BarraNavegacionFases } from '../../components/common/BarraNavegacionFases';
import { bogotaNowForDatetimeLocal, datetimeLocalToBogotaISO, formatBogotaTime } from '../../utils/timezone';

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
type EstadoLinea = 'pendiente' | 'en_camara' | 'completada';

interface EntradaFormState {
  camaraId: string;
  temperatura: string;
  humedad: string;
  horaEntrada: string;
}

interface SalidaFormState {
  horaSalida: string;
}

export const FermentacionMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const queryClient = useQueryClient();

  const [showMO, setShowMO] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [entradaForms, setEntradaForms] = useState<Record<number, EntradaFormState>>({});
  const [salidaForms, setSalidaForms] = useState<Record<number, SalidaFormState>>({});

  // Hora actual en Bogotá (fija, no depende del timezone del navegador/equipo del usuario)
  const ahoraLocal = () => bogotaNowForDatetimeLocal();

  const { data, isLoading } = useQuery({
    queryKey: ['fermentacion', masaId],
    queryFn: () => fetchFermentacion(masaId!),
    enabled: !!masaId,
  });

  const getEntradaForm = (productoId: number): EntradaFormState =>
    entradaForms[productoId] || { camaraId: '', temperatura: '', humedad: '', horaEntrada: ahoraLocal() };

  const setEntradaForm = (productoId: number, patch: Partial<EntradaFormState>) => {
    setEntradaForms(prev => ({ ...prev, [productoId]: { ...getEntradaForm(productoId), ...patch } }));
  };

  const getSalidaForm = (productoId: number): SalidaFormState =>
    salidaForms[productoId] || { horaSalida: ahoraLocal() };

  const setSalidaForm = (productoId: number, patch: Partial<SalidaFormState>) => {
    setSalidaForms(prev => ({ ...prev, [productoId]: { ...getSalidaForm(productoId), ...patch } }));
  };

  const mutacionEntrada = useMutation({
    mutationFn: async ({ productoId, body }: { productoId: number; body: object }) =>
      apiPost(`/api/fermentacion/${masaId}/camara/entrada/${productoId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fermentacion', masaId] });
      setErrorMsg('');
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const mutacionSalida = useMutation({
    mutationFn: async ({ productoId, body }: { productoId: number; body: object }) =>
      apiPost(`/api/fermentacion/${masaId}/camara/salida/${productoId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fermentacion', masaId] });
      setErrorMsg('');
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const mutacionCompletar = useMutation({
    mutationFn: async () => apiPost(`/api/fermentacion/${masaId}/completar`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fermentacion', masaId] });
      setErrorMsg('');
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const masa = data?.masa || {};
  const productos: any[] = data?.productos || [];
  const detalles: any[] = data?.detalles || [];
  const camarasDisponibles: any[] = data?.camaras_disponibles || [];

  const detalleByProducto = new Map(detalles.map((d: any) => [d.producto_masa_id, d]));

  const estadoLinea = (productoId: number): EstadoLinea => {
    const d = detalleByProducto.get(productoId);
    if (!d || !d.hora_entrada_camara) return 'pendiente';
    if (!d.hora_salida_camara) return 'en_camara';
    return 'completada';
  };

  const totalLineas = productos.length;
  const lineasCompletadas = productos.filter(p => estadoLinea(p.id) === 'completada').length;
  const todasLasLineasCompletadas = totalLineas > 0 && lineasCompletadas === totalLineas;

  // La fase queda formalmente completada cuando completarFermentacion corre
  // (desbloquea HORNEADO y avanza masa.fase_actual) — no basta con que todas
  // las líneas tengan salida, falta la acción explícita del operario.
  const faseCompletada = masa.fase_actual && masa.fase_actual !== 'FERMENTACION';

  const formatMinutos = (min: number | null | undefined) => {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <BarraNavegacionFases
          masaId={masaId!}
          codigoMasa={masa.codigo}
          faseAnterior={{ label: 'Formado', ruta: `/formado/${masaId}` }}
          faseSiguiente={{
            label: 'Horneado',
            ruta: `/horneado/${masaId}`,
            habilitada: !!faseCompletada,
          }}
        />

        {/* Header — resumen agregado de líneas, sin tiempos individuales */}
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
            {totalLineas > 0 && (
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-900">{lineasCompletadas} de {totalLineas}</div>
                <div className="text-xs text-gray-500">líneas completadas</div>
              </div>
            )}
          </div>
        </div>

        {/* Productos entrando a fermentación — Kevin: solo nombre, código y cantidad de panes */}
        {productos.length > 0 && !faseCompletada && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Productos en esta masa</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {productos.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-800">{p.producto_nombre}</span>
                    <span className="text-xs text-gray-400 font-mono ml-2">{p.producto_codigo || p.sap_item_code}</span>
                  </div>
                  <span className="font-semibold text-gray-900">{p.cantidad_panes}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">⚠️ {errorMsg}</p>
          </div>
        )}

        {!faseCompletada && (
          <div className="space-y-4">
            {productos.map((p: any) => {
              const estado = estadoLinea(p.id);
              const detalle = detalleByProducto.get(p.id);

              return (
                <div key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-800">{p.producto_nombre}</span>
                      <span className="text-xs text-gray-400 font-mono ml-2">{p.producto_codigo || p.sap_item_code}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">{p.cantidad_panes} panes</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium
                        ${estado === 'pendiente' ? 'bg-gray-100 text-gray-600' : ''}
                        ${estado === 'en_camara' ? 'bg-blue-100 text-blue-700' : ''}
                        ${estado === 'completada' ? 'bg-green-100 text-green-700' : ''}`}>
                        {estado === 'pendiente' && 'Pendiente'}
                        {estado === 'en_camara' && 'En cámara'}
                        {estado === 'completada' && 'Completada'}
                      </span>
                    </div>
                  </div>

                  {estado === 'pendiente' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Cámara <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={getEntradaForm(p.id).camaraId}
                            onChange={e => setEntradaForm(p.id, { camaraId: e.target.value })}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          >
                            <option value="">Seleccionar cámara...</option>
                            {camarasDisponibles.map((c: any) => (
                              <option key={c.id} value={c.id}>{c.nombre}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Temperatura °C</label>
                          <input type="number" value={getEntradaForm(p.id).temperatura}
                            onChange={e => setEntradaForm(p.id, { temperatura: e.target.value })}
                            placeholder="32" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Humedad %</label>
                          <input type="number" value={getEntradaForm(p.id).humedad}
                            onChange={e => setEntradaForm(p.id, { humedad: e.target.value })}
                            placeholder="75" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Hora real de entrada <span className="text-gray-400 font-normal">(por defecto hora actual)</span>
                          </label>
                          <input type="datetime-local" value={getEntradaForm(p.id).horaEntrada}
                            onChange={e => setEntradaForm(p.id, { horaEntrada: e.target.value })}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        </div>
                      </div>
                      <button
                        onClick={() => mutacionEntrada.mutate({
                          productoId: p.id,
                          body: {
                            camara_id: getEntradaForm(p.id).camaraId ? Number(getEntradaForm(p.id).camaraId) : null,
                            temperatura_camara: parseFloat(getEntradaForm(p.id).temperatura) || null,
                            humedad_camara: parseFloat(getEntradaForm(p.id).humedad) || null,
                            hora_entrada_real: datetimeLocalToBogotaISO(getEntradaForm(p.id).horaEntrada),
                          }
                        })}
                        disabled={mutacionEntrada.isPending || !getEntradaForm(p.id).camaraId}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                      >
                        {mutacionEntrada.isPending ? 'Registrando...' : '🌡️ Registrar Entrada'}
                      </button>
                    </>
                  )}

                  {estado === 'en_camara' && detalle && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-gray-500 mb-0.5">Cámara</div>
                          <div className="font-semibold text-gray-800">{detalle.camara_nombre || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-0.5">Entrada</div>
                          <div className="font-semibold text-gray-800">{formatBogotaTime(detalle.hora_entrada_camara)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-0.5">Temperatura</div>
                          <div className="font-semibold text-gray-800">{detalle.temperatura_camara != null ? `${detalle.temperatura_camara}°C` : '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-0.5">Humedad</div>
                          <div className="font-semibold text-gray-800">{detalle.humedad_camara != null ? `${detalle.humedad_camara}%` : '—'}</div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Hora real de salida <span className="text-gray-400 font-normal">(opcional — por defecto hora actual)</span>
                        </label>
                        <input type="datetime-local" value={getSalidaForm(p.id).horaSalida}
                          onChange={e => setSalidaForm(p.id, { horaSalida: e.target.value })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </div>
                      <button
                        onClick={() => mutacionSalida.mutate({
                          productoId: p.id,
                          body: { hora_salida_real: datetimeLocalToBogotaISO(getSalidaForm(p.id).horaSalida) }
                        })}
                        disabled={mutacionSalida.isPending}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                      >
                        {mutacionSalida.isPending ? 'Registrando...' : '⏱️ Registrar Salida'}
                      </button>
                    </>
                  )}

                  {estado === 'completada' && detalle && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Cámara</div>
                        <div className="font-semibold text-gray-800">{detalle.camara_nombre || '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Entrada</div>
                        <div className="font-semibold text-gray-800">{formatBogotaTime(detalle.hora_entrada_camara)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Salida</div>
                        <div className="font-semibold text-gray-800">{formatBogotaTime(detalle.hora_salida_camara)}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-xs text-gray-500 mb-0.5">Tiempo en fermentación</div>
                        <div className="font-semibold text-green-700">{formatMinutos(detalle.tiempo_fermentacion_minutos)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {totalLineas > 0 && (
              <button
                onClick={() => mutacionCompletar.mutate()}
                disabled={!todasLasLineasCompletadas || mutacionCompletar.isPending}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {mutacionCompletar.isPending ? 'Completando...' : '✅ Completar Fermentación'}
              </button>
            )}
          </div>
        )}

        {faseCompletada && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">✅</span>
              <div>
                <h2 className="text-lg font-semibold text-green-800">Fermentación completada</h2>
                <p className="text-green-600 text-sm">Todas las líneas fueron sacadas de cámara.</p>
              </div>
            </div>

            <div className="space-y-2">
              {productos.map((p: any) => {
                const detalle = detalleByProducto.get(p.id);
                return (
                  <div key={p.id} className="bg-gray-50 rounded-lg p-3 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{p.producto_nombre}</span>
                      <span className="text-xs text-gray-400 font-mono ml-2">{p.producto_codigo || p.sap_item_code}</span>
                    </div>
                    <div className="flex items-center gap-4 text-gray-600">
                      <span>{detalle?.camara_nombre || '—'}</span>
                      <span className="font-semibold text-green-700">{formatMinutos(detalle?.tiempo_fermentacion_minutos)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={() => setShowMO(true)}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
              >
                + Mano de obra
              </button>
            </div>
          </div>
        )}
        {showMO && <ModalMO masaId={Number(masaId)} fase="FERMENTACION" onClose={() => setShowMO(false)} />}
      </div>
    </div>
  );
};

export default FermentacionMasa;
