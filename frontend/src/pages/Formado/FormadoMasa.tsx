/**
 * FormadoMasa.tsx
 * Fase de FORMADO — ARTESA
 * Actualizado 2026-03-02
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ModalMO } from '../../components/common/ModalMO';

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

  const [maquinaId, setMaquinaId] = useState<number | null>(null);
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
      setMaquinaId(data.registro_actual.maquina_formado_id);
    } else if (data?.registro_actual?.fecha_fin) {
      setEtapa('completar');
    }
  }, [data]);

  const iniciarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/formado/${masaId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ maquina_formado_id: maquinaId, observaciones })
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
      navigate(`/planificacion/masas/${masaId}`);
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
            <button
              onClick={() => navigate(`/planificacion/masas/${masaId}`)}
              className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
            >
              ← Volver al detalle
            </button>
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">⚠️ {errorMsg}</p>
          </div>
        )}

        {/* Productos a formar */}
        {productos.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Productos a formar</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-gray-500 font-medium">Producto</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Und. a Formar</th>
                    <th className="text-center py-2 text-gray-500 font-medium">Gramaje</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-3">
                        <div className="font-medium text-gray-800">{p.producto_nombre}</div>
                        <div className="text-xs text-gray-400">{p.producto_codigo || p.sap_item_code}</div>
                      </td>
                      <td className="text-center py-3 font-semibold text-gray-900">
                        {p.unidades_a_formar || p.cantidad_divisiones || p.unidades_ajustadas || p.unidades_pedidas}
                      </td>
                      <td className="text-center py-3 text-gray-600">
                        {p.gramaje_unitario}g
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Formulario de inicio */}
        {etapa === 'inicio' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Iniciar Formado</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Máquina formadora <span className="text-red-500">*</span>
              </label>
              {maquinas_disponibles.length > 0 ? (
                <select
                  value={maquinaId || ''}
                  onChange={e => setMaquinaId(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">Seleccionar máquina...</option>
                  {maquinas_disponibles.map((m) => (
                    <option key={m.id} value={m.id}>{m.nombre}</option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                  ⚠️ No hay máquinas de formado configuradas. Se registrará como formado manual.
                </div>
              )}
            </div>

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

            <button
              onClick={() => iniciarMutation.mutate()}
              disabled={iniciarMutation.isPending || (maquinas_disponibles.length > 0 && !maquinaId)}
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
              El proceso de formado está activo. Cuando las piezas estén formadas, completa la fase.
            </p>
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
            <button
              onClick={() => completarMutation.mutate()}
              disabled={completarMutation.isPending}
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
            <p className="text-green-700 text-sm mb-4">
              El proceso de formado ha sido registrado exitosamente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowMO(true)}
                className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
              >
                + Mano de obra
              </button>
              <button
                onClick={() => navigate(`/fermentacion/${masaId}`)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
              >
                Ir a Fermentación →
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
