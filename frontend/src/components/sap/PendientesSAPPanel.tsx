import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePendientesSAP, useReenviarPendientesSAP } from '../../hooks/useChecklist';
import { formatDate } from '@/utils/formatters';

/**
 * Panel "Pendientes de sincronizar con SAP" — vive dentro de Sincronizar SAP
 * (no dentro de Pesaje). Lista, agrupadas por fecha de producción, las
 * transmisiones de pesaje que quedaron pendientes porque el Service Layer
 * estaba inalcanzable o falló la autenticación (no un rechazo de negocio) al
 * confirmar el pesaje. El consumo de materia prima ya se descontó localmente
 * — falta transmitir el documento a SAP. Reintentar por grupo (o "todas")
 * limpia solas las que sincronizan; las que siguen fallando permanecen con
 * su motivo visible. Solo visible para admin/supervisor.
 */
export const PendientesSAPPanel: React.FC = () => {
  const navigate = useNavigate();
  const { data: grupos, isLoading, error } = usePendientesSAP(true);
  const reenviarMutation = useReenviarPendientesSAP();
  const [grupoReintentando, setGrupoReintentando] = useState<string | null>(null);
  const [idReintentando, setIdReintentando] = useState<number | null>(null);
  const [ultimoResultado, setUltimoResultado] = useState<string | null>(null);

  const describirResultado = (data: { success: boolean; requiere_revision?: boolean; pendiente_sap?: boolean }[]) => {
    const exitosos = data.filter((r) => r.success).length;
    const revision = data.filter((r) => r.requiere_revision).length;
    const siguenPendientes = data.filter((r) => r.pendiente_sap).length;
    let msg = `${exitosos}/${data.length} sincronizado(s) correctamente.`;
    if (siguenPendientes > 0) msg += ` ${siguenPendientes} sigue(n) sin conexión/autenticación con SAP.`;
    if (revision > 0) msg += ` ${revision} requiere(n) revisión manual (error de negocio).`;
    return msg;
  };

  const handleReintentarGrupo = async (fechaProduccion: string) => {
    setUltimoResultado(null);
    setGrupoReintentando(fechaProduccion);
    try {
      const resultado = await reenviarMutation.mutateAsync({ fechaProduccion });
      setUltimoResultado(describirResultado(resultado.data));
    } catch (err: any) {
      setUltimoResultado(`⚠ Error al reintentar: ${err?.message || 'error desconocido'}`);
    } finally {
      setGrupoReintentando(null);
    }
  };

  const handleReintentarUno = async (id: number) => {
    setUltimoResultado(null);
    setIdReintentando(id);
    try {
      const resultado = await reenviarMutation.mutateAsync({ ids: [id] });
      setUltimoResultado(describirResultado(resultado.data));
    } catch (err: any) {
      setUltimoResultado(`⚠ Error al reintentar: ${err?.message || 'error desconocido'}`);
    } finally {
      setIdReintentando(null);
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

  const listaGrupos = grupos || [];
  const totalGeneral = listaGrupos.reduce((acc, g) => acc + g.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Pendientes de sincronizar con SAP</h3>
          <p className="text-sm text-gray-500">
            Masas cuyo pesaje se confirmó con SAP inalcanzable (conexión o autenticación). El
            consumo de materia prima ya se descontó localmente — falta transmitir el documento a
            SAP. Agrupadas por día de producción.
          </p>
        </div>
        {totalGeneral > 0 && (
          <button
            onClick={() => handleReintentarGrupo('todas')}
            disabled={reenviarMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
          >
            {grupoReintentando === 'todas' && reenviarMutation.isPending
              ? 'Sincronizando...'
              : `🔄 Sincronizar todas (${totalGeneral})`}
          </button>
        )}
      </div>

      {ultimoResultado && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
          {ultimoResultado}
        </div>
      )}

      {listaGrupos.length === 0 ? (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
          No hay transmisiones pendientes. Todo el consumo de pesaje está sincronizado con SAP.
        </p>
      ) : (
        <div className="space-y-4">
          {listaGrupos.map((grupo) => (
            <div key={grupo.fecha_produccion} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200">
                <span className="font-medium text-gray-800 text-sm">
                  {grupo.fecha_produccion === 'sin_fecha'
                    ? 'Sin fecha de producción'
                    : formatDate(grupo.fecha_produccion)}
                  <span className="ml-2 text-xs text-gray-500">({grupo.total} pendiente{grupo.total !== 1 ? 's' : ''})</span>
                </span>
                <button
                  onClick={() => handleReintentarGrupo(grupo.fecha_produccion)}
                  disabled={reenviarMutation.isPending}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {grupoReintentando === grupo.fecha_produccion && reenviarMutation.isPending
                    ? 'Sincronizando...'
                    : 'Sincronizar este día'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white text-xs text-gray-500">
                      <th className="text-left p-3">Masa</th>
                      <th className="text-left p-3">Lote</th>
                      <th className="text-center p-3">Intentos</th>
                      <th className="text-left p-3">Último error</th>
                      <th className="text-right p-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.masas.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100">
                        <td className="p-3">
                          <div className="font-medium text-gray-900">{p.codigo_masa || `Masa ${p.masa_id}`}</div>
                          <div className="text-xs text-gray-400">{p.tipo_masa}</div>
                        </td>
                        <td className="p-3 text-gray-600">{p.lote_produccion || '—'}</td>
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
                            onClick={() => handleReintentarUno(p.id)}
                            disabled={reenviarMutation.isPending}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {idReintentando === p.id && reenviarMutation.isPending ? 'Reintentando...' : 'Reintentar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PendientesSAPPanel;
