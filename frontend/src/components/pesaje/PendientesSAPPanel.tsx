import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePendientesSAP, useReenviarPendientesSAP } from '../../hooks/useChecklist';
import { formatDate } from '@/utils/formatters';

/**
 * Panel "Pendientes SAP" — lista transmisiones de pesaje que quedaron con la
 * sincronización a SAP pendiente porque el Service Layer estaba inalcanzable
 * (caída de conexión, no un rechazo de negocio) al momento de confirmar.
 * Solo visible para admin/supervisor.
 */
export const PendientesSAPPanel: React.FC = () => {
  const navigate = useNavigate();
  const { data: pendientes, isLoading, error } = usePendientesSAP(true);
  const reenviarMutation = useReenviarPendientesSAP();
  const [reintentandoId, setReintentandoId] = useState<number | null>(null);
  const [ultimoResultado, setUltimoResultado] = useState<string | null>(null);

  const handleReintentar = async (ids: number[], individual?: number) => {
    if (ids.length === 0) return;
    setUltimoResultado(null);
    if (individual) setReintentandoId(individual);
    try {
      const resultado = await reenviarMutation.mutateAsync(ids);
      const exitosos = resultado.data.filter(r => r.success).length;
      const revision = resultado.data.filter(r => r.requiere_revision).length;
      const siguenPendientes = resultado.data.filter(r => r.pendiente_sap).length;
      let msg = `${exitosos}/${resultado.data.length} sincronizado(s) correctamente.`;
      if (siguenPendientes > 0) msg += ` ${siguenPendientes} sigue(n) sin conexión a SAP.`;
      if (revision > 0) msg += ` ${revision} requiere(n) revisión manual (error de negocio).`;
      setUltimoResultado(msg);
    } catch (err: any) {
      setUltimoResultado(`⚠ Error al reintentar: ${err?.message || 'error desconocido'}`);
    } finally {
      setReintentandoId(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-gray-500 p-4">Cargando pendientes SAP...</p>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
        No se pudo cargar la lista de pendientes SAP: {(error as any)?.message || 'error desconocido'}
      </div>
    );
  }

  const lista = pendientes || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Pendientes de sincronizar con SAP</h3>
          <p className="text-sm text-gray-500">
            Masas cuyo pesaje se confirmó con SAP inalcanzable por caída de conexión. El consumo de
            materia prima ya se descontó localmente — falta transmitir el documento a SAP.
          </p>
        </div>
        <button
          onClick={() => handleReintentar(lista.map(p => p.id))}
          disabled={lista.length === 0 || reenviarMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
        >
          {reenviarMutation.isPending && !reintentandoId ? 'Reintentando...' : `🔄 Reintentar todos (${lista.length})`}
        </button>
      </div>

      {ultimoResultado && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
          {ultimoResultado}
        </div>
      )}

      {lista.length === 0 ? (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
          No hay transmisiones pendientes. Todo el consumo de pesaje está sincronizado con SAP.
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left p-3">Masa</th>
                <th className="text-left p-3">Lote</th>
                <th className="text-left p-3">Fecha</th>
                <th className="text-center p-3">Intentos</th>
                <th className="text-left p-3">Último error</th>
                <th className="text-right p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(p => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="p-3">
                    <div className="font-medium text-gray-900">{p.codigo_masa || `Masa ${p.masa_id}`}</div>
                    <div className="text-xs text-gray-400">{p.tipo_masa}</div>
                  </td>
                  <td className="p-3 text-gray-600">{p.lote_produccion || '—'}</td>
                  <td className="p-3 text-gray-600">{formatDate(p.fecha_operacion?.slice(0, 10))}</td>
                  <td className="p-3 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
                      {p.intentos}
                    </span>
                  </td>
                  <td className="p-3 text-red-600 text-xs max-w-xs truncate" title={p.error_message || ''}>
                    {p.error_message || '—'}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {p.masa_id && (
                      <button
                        onClick={() => navigate(`/pesaje/${p.masa_id}`)}
                        className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 mr-2"
                      >
                        Ver masa
                      </button>
                    )}
                    <button
                      onClick={() => handleReintentar([p.id], p.id)}
                      disabled={reenviarMutation.isPending}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {reintentandoId === p.id && reenviarMutation.isPending ? 'Reintentando...' : 'Reintentar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PendientesSAPPanel;
