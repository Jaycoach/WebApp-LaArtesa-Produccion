/**
 * ReporteCostos.tsx — ARTESA
 * Reporte detallado de costos de producción por fecha
 */
import React, { useState } from 'react';

const getToken = () => {
  try {
    const a = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return a?.state?.token || a?.state?.accessToken || '';
  } catch { return ''; }
};
const api = async (path: string) => {
  const r = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'Error');
  return d;
};
const COP = (n: number) => Math.round(n || 0).toLocaleString('es-CO');
const fmt = (d: string) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

export const ReporteCostos: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const [desde, setDesde] = useState(hace7);
  const [hasta, setHasta] = useState(today);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [expandida, setExpandida] = useState<number | null>(null);

  const buscar = async () => {
    setLoading(true); setErr('');
    try {
      const resp = await api(`/reportes/costos?fecha_desde=${desde}&fecha_hasta=${hasta}`);
      setData(resp.data || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const totalGeneral = data.reduce((s, m) => s + (m.costos_resumen?.costo_total || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reporte de Costos de Producción</h1>
          <p className="text-gray-500 text-sm mt-1">Detalle de costos por masa producida, desglosado por MP, MO, empaque e indirectos</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            </div>
            <button onClick={buscar} disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 text-sm">
              {loading ? 'Cargando...' : 'Consultar'}
            </button>
          </div>
          {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        </div>

        {data.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Producciones', val: String(data.length), color: 'text-gray-800' },
              { label: 'Costo MP total', val: `$${COP(data.reduce((s,m) => s+(m.costos_resumen?.costo_mp||0),0))}`, color: 'text-blue-700' },
              { label: 'Costo MO total', val: `$${COP(data.reduce((s,m) => s+(m.costos_resumen?.costo_mo||0),0))}`, color: 'text-purple-700' },
              { label: 'Costo total', val: `$${COP(totalGeneral)}`, color: 'text-green-700' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                <p className={`text-xl font-bold mt-1 ${color}`}>{val}</p>
              </div>
            ))}
          </div>
        )}

        {data.length === 0 && !loading && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            Seleccione un rango de fechas y presione Consultar
          </div>
        )}

        {data.map(masa => (
          <div key={masa.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div
              className="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setExpandida(expandida === masa.id ? null : masa.id)}
            >
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{masa.nombre_masa}</span>
                    {masa.es_subdivision && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Sub-masa</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {masa.codigo_masa} · {fmt(masa.fecha_produccion)} · {masa.total_kilos?.toFixed(2)} kg
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-8 text-right">
                <div>
                  <p className="text-xs text-gray-400">MP</p>
                  <p className="font-mono text-sm font-medium text-blue-700">${COP(masa.costos_resumen?.costo_mp)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">MO</p>
                  <p className="font-mono text-sm font-medium text-purple-700">${COP(masa.costos_resumen?.costo_mo)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">CIF</p>
                  <p className="font-mono text-sm font-medium text-orange-700">${COP(masa.costos_resumen?.costo_cif)}</p>
                </div>
                <div className="border-l border-gray-200 pl-6">
                  <p className="text-xs text-gray-400">Costo/kg</p>
                  <p className="font-mono text-sm font-bold text-gray-800">${COP(masa.costos_resumen?.costo_por_kilo)}</p>
                </div>
                <div className="border-l border-gray-200 pl-6">
                  <p className="text-xs text-gray-400">Total masa</p>
                  <p className="font-mono text-base font-bold text-green-700">${COP(masa.costos_resumen?.costo_total)}</p>
                </div>
                <span className="text-gray-400 text-sm">{expandida === masa.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {expandida === masa.id && (
              <div className="border-t border-gray-100 p-5 space-y-5 bg-gray-50">

                {masa.mano_obra_detalle?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Mano de Obra por Fase</h4>
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                          <tr>
                            <th className="p-3 text-left">Fase</th>
                            <th className="p-3 text-left">Operario</th>
                            <th className="p-3 text-right">Horas</th>
                            <th className="p-3 text-right">Costo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {masa.mano_obra_detalle.map((mo: any, i: number) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="p-3 text-gray-600">{mo.fase}</td>
                              <td className="p-3">{mo.tipo_nombre}</td>
                              <td className="p-3 text-right font-mono">{parseFloat(mo.horas).toFixed(1)}h</td>
                              <td className="p-3 text-right font-mono font-medium">${COP(parseFloat(mo.costo_calculado))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Productos Empacados</h4>
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <tr>
                          <th className="p-3 text-left">Producto</th>
                          <th className="p-3 text-left">OV SAP</th>
                          <th className="p-3 text-right">Uds pedidas</th>
                          <th className="p-3 text-right">Uds producidas</th>
                          <th className="p-3 text-right">Costo MP unit.</th>
                          <th className="p-3 text-right">Costo MO</th>
                          <th className="p-3 text-right">Empaque</th>
                          <th className="p-3 text-right font-bold">Costo unitario</th>
                        </tr>
                      </thead>
                      <tbody>
                        {masa.productos?.map((p: any) => (
                          <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="p-3">
                              <div className="font-medium">{p.producto_nombre}</div>
                              <div className="text-xs text-gray-400">{p.sap_item_code} · {p.presentacion}</div>
                            </td>
                            <td className="p-3 text-gray-600">{p.sap_doc_num || '—'}</td>
                            <td className="p-3 text-right font-mono">{p.unidades_pedidas || 0}</td>
                            {/* A5: mismo criterio de fallback que EmpaqueMasa.tsx (A2) -- unidades_producidas
                                (evolutivo) primero, cantidad_divisiones (historico crudo de Division) como
                                segundo nivel para masas legacy sin desglose por producto (ver masa 429).
                                Este reporte es solo lectura: no toca costo_total_final/costo_unitario_final,
                                que se calculan aparte a partir de uds_empacadas real (empaque.controller.js),
                                no de este campo -- el fallback aqui es puramente de presentacion. */}
                            <td className="p-3 text-right font-mono">
                              {(p.unidades_producidas || 0) > 0 ? p.unidades_producidas : (p.cantidad_divisiones || 0)}
                            </td>
                            <td className="p-3 text-right font-mono text-blue-700">${COP(p.costos?.mp_unitario)}</td>
                            <td className="p-3 text-right font-mono text-purple-700">${COP(p.costos?.mo_total)}</td>
                            <td className="p-3 text-right font-mono text-orange-700">${COP(p.costos?.empaque_total)}</td>
                            <td className="p-3 text-right font-mono font-bold text-green-700 text-base">
                              ${COP(p.costos?.unitario_final)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {masa.empaque && (
                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>Empaque: <strong>{masa.empaque.estado}</strong></span>
                    {masa.empaque.fecha_vencimiento && (
                      <span>Vence: <strong>{fmt(masa.empaque.fecha_vencimiento)}</strong></span>
                    )}
                    {masa.empaque.fecha_completado && (
                      <span>Completado: <strong>{fmt(masa.empaque.fecha_completado)}</strong></span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReporteCostos;
