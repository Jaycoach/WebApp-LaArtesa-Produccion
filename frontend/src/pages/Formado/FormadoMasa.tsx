/**
 * FormadoMasa.tsx
 * Fase de FORMADO — ARTESA
 * Actualizado 2026-03-02
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalMO } from '../../components/common/ModalMO';
import { BarraNavegacionFases } from '../../components/common/BarraNavegacionFases';

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────
interface FormadoInfo {
  masa: {
    id: number;
    codigo: string;
    tipo: string;
    nombre: string;
    estado: string;
    fase_actual: string;
  };
  productos: any[];
  maquinas_disponibles: Array<{ id: number; nombre: string; tipo: string }>;
  registro_actual: any | null;
  detalles: Array<{
    id: number;
    producto_masa_id: number;
    maquina_formado_id: number | null;
    maquina_nombre: string | null;
    unidades_formadas: number;
    fecha_actualizacion: string;
  }>;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const getToken = () => {
  try {
    const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return auth?.state?.token || auth?.state?.accessToken || '';
  } catch { return ''; }
};

const fetchFormado = async (masaId: string): Promise<FormadoInfo> => {
  const res = await fetch(`/api/formado/${masaId}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Error al cargar formado');
  return data.data;
};

// ─────────────────────────────────────────────
// Componente Principal
// ─────────────────────────────────────────────
export const FormadoMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [detallesLocal, setDetallesLocal] = useState<Record<number, { maquina_formado_id: number | null; unidades_formadas: string }>>({});
  const [observaciones, setObservaciones] = useState('');
  const [etapa, setEtapa] = useState<'inicio' | 'progreso' | 'completar'>('inicio');
  const [showMO, setShowMO] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['formado', masaId],
    queryFn: () => fetchFormado(masaId!),
    enabled: !!masaId,
  });

  // Al cargar, si ya hay registro iniciado → ir a etapa de completar
  React.useEffect(() => {
    if (data?.registro_actual && !data.registro_actual.fecha_fin) {
      setEtapa('progreso');
      setObservaciones(data.registro_actual.observaciones || '');
      const init: Record<number, { maquina_formado_id: number | null; unidades_formadas: string }> = {};
      for (const d of data.detalles || []) {
        init[d.producto_masa_id] = {
          maquina_formado_id: d.maquina_formado_id,
          unidades_formadas: d.unidades_formadas > 0 ? String(d.unidades_formadas) : '',
        };
      }
      setDetallesLocal(init);
    } else if (data?.registro_actual?.fecha_fin) {
      setEtapa('completar');
      setObservaciones(data.registro_actual.observaciones || '');
    }
  }, [data]);

  const iniciarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/formado/${masaId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ observaciones })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onSuccess: () => {
      setEtapa('progreso');
      queryClient.invalidateQueries({ queryKey: ['formado', masaId] });
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const actualizarDetalleMutation = useMutation({
    mutationFn: async ({ productoMasaId, maquina_formado_id, unidades_formadas }: {
      productoMasaId: number; maquina_formado_id?: number | null; unidades_formadas?: number;
    }) => {
      const res = await fetch(`/api/formado/${masaId}/detalle/${productoMasaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ maquina_formado_id, unidades_formadas })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['formado', masaId] }),
    onError: (e: any) => setErrorMsg(e.message)
  });

  const completarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/formado/${masaId}/completar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ observaciones })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fases', masaId] });
      queryClient.invalidateQueries({ queryKey: ['formado', masaId] });
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if ((data as any)?.no_requiere_formado) {
    const info = (data as any);
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">ℹ️</span>
              <h2 className="text-lg font-semibold text-gray-800">Esta masa no requiere formado</h2>
            </div>
            <p className="text-gray-500 text-sm">
              {info.masa.codigo} — {info.masa.nombre}. Puedes continuar directamente a la siguiente fase.
            </p>
          </div>
          <div className="sticky bottom-4 flex justify-end gap-3 bg-white border border-gray-200 rounded-xl shadow-md p-4">
            <button
              onClick={() => navigate(`/planificacion/masas/${masaId}`)}
              className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium"
            >
              ← Volver al detalle
            </button>
            <button
              onClick={() => navigate(`/fermentacion/${masaId}`)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
            >
              Ir a Fermentación →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{(error as any)?.message || 'Error al cargar datos de formado'}</p>
        </div>
      </div>
    );
  }

  const { masa, maquinas_disponibles, productos } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <BarraNavegacionFases
          masaId={masaId!}
          codigoMasa={masa.codigo}
          faseAnterior={{ label: 'División', ruta: `/division/${masaId}` }}
          faseSiguiente={{
            label: 'Fermentación',
            ruta: `/fermentacion/${masaId}`,
            habilitada: etapa === 'completar',
          }}
        />

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">🫓</span>
                <h1 className="text-2xl font-bold text-gray-900">Formado</h1>
                <span className="px-2 py-1 bg-orange-100 text-orange-700 text-sm rounded-full font-medium">
                  {masa.tipo}
                </span>
              </div>
              <p className="text-gray-500 text-sm">
                {masa.codigo} — {masa.nombre}
              </p>
            </div>
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">⚠️ {errorMsg}</p>
          </div>
        )}

        {/* Productos a formar — vista previa antes de iniciar */}
        {etapa === 'inicio' && productos.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Productos a formar</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-gray-500 font-medium">Producto</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Und. a Formar</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Gramaje Unitario</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Gramaje Total</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p: any) => {
                    const unidades = p.unidades_a_formar || p.cantidad_divisiones || p.unidades_ajustadas || p.unidades_pedidas || 0;
                    const gramajeUnitario = Number(p.gramaje_unitario) || 0;
                    const gramajeTotal = unidades * gramajeUnitario;
                    return (
                      <tr key={p.id} className="border-b border-gray-50">
                        <td className="py-3">
                          <div className="font-medium text-gray-800">{p.producto_nombre}</div>
                          <div className="text-xs text-gray-400">{p.producto_codigo || p.sap_item_code}</div>
                        </td>
                        <td className="text-center py-3 font-semibold text-gray-900">
                          {unidades}
                        </td>
                        <td className="text-center py-3 text-gray-600">
                          {gramajeUnitario}g
                        </td>
                        <td className="text-center py-3 font-semibold text-gray-900">
                          {(gramajeTotal / 1000).toFixed(2)} kg
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Formulario de inicio */}
        {etapa === 'inicio' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Iniciar Formado</h2>

            <p className="text-sm text-gray-500">
              Al iniciar se crea un registro por cada producto de la tabla de arriba —
              la máquina y las unidades formadas se registran individualmente producto
              por producto en el siguiente paso.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                rows={3}
                placeholder="Observaciones del proceso de formado..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
            </div>
          </div>
        )}

        {/* Botón sticky — nunca requiere scroll para iniciar */}
        {etapa === 'inicio' && (
          <div className="sticky bottom-0 z-10 bg-gray-50 border-t border-gray-200 px-4 py-3 -mx-6">
            <button
              onClick={() => iniciarMutation.mutate()}
              disabled={iniciarMutation.isPending}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {iniciarMutation.isPending ? 'Iniciando...' : '▶ Iniciar Formado'}
            </button>
          </div>
        )}

        {/* En progreso */}
        {etapa === 'progreso' && (
          <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse"></div>
              <h2 className="text-lg font-semibold text-orange-700">Formado en progreso</h2>
            </div>
            <p className="text-gray-600 text-sm">
              Registra la máquina y las unidades formadas de cada producto. Cuando todos
              tengan unidades formadas, completa la fase.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-gray-500 font-medium">Producto</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Und. a Formar</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Máquina</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Unidades Formadas</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p: any) => {
                    const unidades = p.unidades_a_formar || p.cantidad_divisiones || p.unidades_ajustadas || p.unidades_pedidas || 0;
                    const local = detallesLocal[p.id] || { maquina_formado_id: null, unidades_formadas: '' };
                    return (
                      <tr key={p.id} className="border-b border-gray-50">
                        <td className="py-3">
                          <div className="font-medium text-gray-800">{p.producto_nombre}</div>
                          <div className="text-xs text-gray-400">{p.producto_codigo || p.sap_item_code}</div>
                        </td>
                        <td className="text-center py-3 text-gray-600">{unidades}</td>
                        <td className="text-center py-3">
                          <select
                            value={local.maquina_formado_id || ''}
                            onChange={e => {
                              const nuevoValor = e.target.value ? Number(e.target.value) : null;
                              setDetallesLocal(prev => ({
                                ...prev,
                                [p.id]: { ...local, maquina_formado_id: nuevoValor }
                              }));
                              actualizarDetalleMutation.mutate({
                                productoMasaId: p.id,
                                maquina_formado_id: nuevoValor,
                              });
                            }}
                            className="border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-orange-400"
                          >
                            <option value="">Sin máquina...</option>
                            {maquinas_disponibles.map((m) => (
                              <option key={m.id} value={m.id}>{m.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td className="text-center py-3">
                          <input
                            type="number"
                            min="0"
                            value={local.unidades_formadas}
                            onChange={e => setDetallesLocal(prev => ({
                              ...prev,
                              [p.id]: { ...local, unidades_formadas: e.target.value }
                            }))}
                            onBlur={() => actualizarDetalleMutation.mutate({
                              productoMasaId: p.id,
                              unidades_formadas: parseInt(local.unidades_formadas) || 0,
                            })}
                            placeholder={String(unidades)}
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:ring-1 focus:ring-orange-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones finales</label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                rows={3}
                placeholder="Resultado del formado, observaciones..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              />
            </div>

            {productos.some((p: any) => !(parseInt(detallesLocal[p.id]?.unidades_formadas || '0') > 0)) && (
              <p className="text-xs text-amber-700">
                ⚠️ Faltan unidades formadas en: {productos
                  .filter((p: any) => !(parseInt(detallesLocal[p.id]?.unidades_formadas || '0') > 0))
                  .map((p: any) => p.producto_nombre).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Botón sticky — nunca requiere scroll para completar, aunque la tabla de arriba sea larga */}
        {etapa === 'progreso' && (
          <div className="sticky bottom-0 z-10 bg-gray-50 border-t border-gray-200 px-4 py-3 -mx-6">
            <button
              onClick={() => completarMutation.mutate()}
              disabled={
                completarMutation.isPending ||
                productos.some((p: any) => !(parseInt(detallesLocal[p.id]?.unidades_formadas || '0') > 0))
              }
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {completarMutation.isPending ? 'Completando...' : '✅ Completar Formado → Ir a Fermentación'}
            </button>
          </div>
        )}

        {/* Ya completado */}
        {etapa === 'completar' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">✅</span>
              <h2 className="text-lg font-semibold text-green-800">Formado completado</h2>
            </div>
            <div className="bg-white rounded-lg border border-green-100 p-4 mb-4 space-y-2 text-sm">
              {(data.detalles || []).map((d) => {
                const prod = productos.find((p: any) => p.id === d.producto_masa_id);
                return (
                  <div key={d.id} className="flex justify-between">
                    <span className="text-gray-500">{prod?.producto_nombre || `Producto ${d.producto_masa_id}`}</span>
                    <span className="font-medium text-gray-800">
                      {d.unidades_formadas} und. — {d.maquina_nombre || 'sin máquina'}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between">
                <span className="text-gray-500">Duración</span>
                <span className="font-medium text-gray-800">
                  {data.registro_actual?.duracion_minutos != null ? `${Math.round(Number(data.registro_actual.duracion_minutos))} min` : '—'}
                </span>
              </div>
              {data.registro_actual?.observaciones && (
                <div>
                  <span className="text-gray-500 block mb-1">Observaciones</span>
                  <p className="text-gray-800 bg-gray-50 rounded p-2 whitespace-pre-wrap">{data.registro_actual.observaciones}</p>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMO(true)}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
              >
                + Mano de obra
              </button>
            </div>
          </div>
        )}
        {showMO && <ModalMO masaId={Number(masaId)} fase="FORMADO" onClose={() => setShowMO(false)} />}
      </div>
    </div>
  );
};

export default FormadoMasa;
