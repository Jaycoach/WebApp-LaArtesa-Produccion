/**
 * EmpaqueMasa.tsx — ARTESA
 * Vista consolidada de empaque por OV
 * Busca por número de OV, muestra todas las sub-masas,
 * costeo completo y generación de etiqueta INVIMA.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/common';

// ── auth helper ──────────────────────────────────────────────────────────────
const getToken = () => {
  try {
    const a = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return a?.state?.token || a?.state?.accessToken || '';
  } catch { return ''; }
};
const H = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` });
const api = async (path: string, opts?: RequestInit) => {
  const r = await fetch(`/api${path}`, { headers: H(), ...opts });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message || 'Error'), { status: r.status, data: d });
  return d;
};

// ── tipos ────────────────────────────────────────────────────────────────────
interface SubMasa {
  id: number;
  codigo_masa: string;
  estado_horneado: string;
  estado_empaque: string;
  total_kilos_con_merma: number;
}
interface Producto {
  id: number;
  masa_id: number;
  sap_item_code: string;
  producto_nombre: string;
  presentacion: string;
  gramaje_unitario: number;
  unidades_ajustadas: number;
  unidades_producidas: number;
  sap_doc_num: string;
  detalle_id: number | null;
  unidades_empacadas: number | null;
  unidades_merma: number | null;
  empaque_id: number | null;
  empaque_estado: string | null;
  fecha_vencimiento: string | null;
  costo_mp_total_prod: number;
  costo_unitario_final: number;
}
interface MaterialEmpaque {
  item_code_padre: string;
  item_code_comp: string;
  item_name_comp: string;
  cantidad_por_unidad: number;
  uom: string;
  precio_unitario: number;
  stock_disponible: number;
}
interface ResumenCostos {
  costo_mp: number; costo_mo: number;
  costo_empaque: number; costo_indirecto: number; costo_total: number;
}
interface OVData {
  masa_padre: { id: number; codigo: string; tipo: string; total_kg: number };
  sub_masas: SubMasa[];
  todas_horneadas: boolean;
  productos: Producto[];
  materiales_empaque: MaterialEmpaque[];
  resumen_costos: ResumenCostos;
}

const COP = (v: number) => v.toLocaleString('es-CO', { minimumFractionDigits: 0 });

// ── Etiqueta imprimible ──────────────────────────────────────────────────────
const Etiqueta: React.FC<{ data: any; onClose: () => void }> = ({ data, onClose }) => {
  const imprimir = () => {
    const w = window.open('', '_blank', 'width=400,height=220');
    if (!w) return;
    w.document.write(`
      <html><head><title>Etiqueta</title>
      <style>
        @page { size: 10cm 5cm; margin: 0; }
        body { font-family: Arial, sans-serif; font-size: 7pt; margin: 0; padding: 4mm; width: 10cm; height: 5cm; box-sizing: border-box; }
        .nombre { font-size: 10pt; font-weight: bold; margin-bottom: 1mm; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm; }
        .lbl { font-weight: bold; }
        .sep { border-top: 0.5pt solid #333; margin: 1mm 0; }
        .footer { font-size: 6pt; color: #555; margin-top: 1mm; }
      </style></head><body>
      <div class="nombre">${data.nombre_producto}</div>
      <div class="grid">
        <div><span class="lbl">Peso neto:</span> ${data.peso_neto_txt}</div>
        <div><span class="lbl">Vence:</span> ${data.fecha_vencimiento ? new Date(data.fecha_vencimiento + 'T12:00').toLocaleDateString('es-CO') : '--'}</div>
      </div>
      <div class="sep"></div>
      <div><span class="lbl">Ingredientes:</span> ${data.ingredientes_txt || 'N/D'}</div>
      <div><span class="lbl">Alergenos:</span> ${data.alergenos_txt || 'N/D'}</div>
      <div><span class="lbl">Conservacion:</span> ${data.condiciones_txt}</div>
      <div class="sep"></div>
      <div class="footer">
        ${data.fabricante_txt}
        ${data.registro_invima ? ` | Reg. INVIMA: ${data.registro_invima}` : ''}
        ${data.lote ? ` | Lote: ${data.lote}` : ''}
      </div>
      </body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">Etiqueta INVIMA</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">&times;</button>
        </div>
        <div className="border-2 border-dashed border-gray-300 rounded p-3 text-xs mb-4" style={{ fontFamily: 'Arial' }}>
          <div className="font-bold text-sm mb-1">{data.nombre_producto}</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div><span className="font-bold">Peso neto:</span> {data.peso_neto_txt}</div>
            <div><span className="font-bold">Vence:</span> {data.fecha_vencimiento ? new Date(data.fecha_vencimiento + 'T12:00').toLocaleDateString('es-CO') : '--'}</div>
          </div>
          <hr className="my-1 border-gray-300" />
          <div className="text-xs"><span className="font-bold">Ingredientes:</span> {data.ingredientes_txt || 'N/D'}</div>
          <div className="text-xs"><span className="font-bold">Alergenos:</span> {data.alergenos_txt || 'N/D'}</div>
          <div className="text-xs"><span className="font-bold">Conservacion:</span> {data.condiciones_txt}</div>
          <hr className="my-1 border-gray-300" />
          <div className="text-xs text-gray-500">
            {data.fabricante_txt}
            {data.registro_invima && ` | Reg. INVIMA: ${data.registro_invima}`}
            {data.lote && ` | Lote: ${data.lote}`}
          </div>
        </div>
        {!data.ingredientes_txt && (
          <p className="text-amber-600 text-xs mb-3">Sin ingredientes configurados. Configure en Configuracion &gt; Costos &gt; Etiquetas.</p>
        )}
        <div className="flex gap-2">
          <button onClick={imprimir} className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 font-medium">
            Imprimir etiqueta
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Modal MO ─────────────────────────────────────────────────────────────────
const ModalMO: React.FC<{
  masaId: number; fase: string; tiposMO: any[];
  onClose: () => void; onSave: () => void;
}> = ({ masaId, fase, tiposMO, onClose, onSave }) => {
  const [tipoId, setTipoId] = useState('');
  const [horas, setHoras] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const tipo = tiposMO.find(t => String(t.id) === tipoId);
  const costo = tipo && horas ? parseFloat(tipo.costo_hora) * parseFloat(horas) : 0;

  const handleSave = async () => {
    if (!tipoId || !horas) return setErr('Seleccione tipo y horas');
    setSaving(true);
    try {
      await api(`/config/mano-obra/masa/${masaId}`, {
        method: 'POST',
        body: JSON.stringify({ fase, tipo_mo_id: Number(tipoId), horas: parseFloat(horas), observaciones: obs }),
      });
      onSave();
      onClose();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h3 className="font-bold text-lg mb-4">Registrar Mano de Obra — {fase}</h3>
        {err && <p className="text-red-600 text-sm mb-2">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Tipo de operario</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
              <option value="">Seleccionar...</option>
              {tiposMO.map(t => (
                <option key={t.id} value={t.id}>{t.nombre} — ${COP(t.costo_hora)}/h</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Horas trabajadas</label>
            <input type="number" min="0.25" step="0.25" value={horas}
              onChange={e => setHoras(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          {costo > 0 && (
            <div className="bg-blue-50 rounded p-2 text-sm text-blue-800">
              Costo calculado: <strong>${COP(costo)}</strong>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Observaciones (opcional)</label>
            <input type="text" value={obs} onChange={e => setObs(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50 font-medium">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Componente principal ─────────────────────────────────────────────────────
export const EmpaqueMasa: React.FC = () => {
  const qc = useQueryClient();

  const [docNumInput, setDocNumInput] = useState('');
  const [docNumBuscar, setDocNumBuscar] = useState('');
  const [etiquetaData, setEtiquetaData] = useState<any>(null);
  const [modalMO, setModalMO] = useState<{ masaId: number; fase: string } | null>(null);
  const [detallesEdit, setDetallesEdit] = useState<Record<number, { emp: string; merma: string }>>({});
  const [fechaVenc, setFechaVenc] = useState('');
  const [savingEmpaque, setSavingEmpaque] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

  const mostrarMsg = (tipo: 'ok' | 'err', texto: string) => {
    setMsg({ tipo, texto });
    setTimeout(() => setMsg(null), 4000);
  };

  const { data: ovData, isLoading, error: ovError } = useQuery<{ data: OVData[] }>({
    queryKey: ['empaque-ov', docNumBuscar],
    queryFn: () => api(`/empaque/ov/${docNumBuscar}`),
    enabled: !!docNumBuscar,
    retry: false,
  });

  const { data: tiposMOData } = useQuery({
    queryKey: ['tipos-mo'],
    queryFn: () => api('/config/mano-obra'),
  });
  const tiposMO = tiposMOData?.data || [];

  const ov = ovData?.data?.[0];

  const iniciarMut = useMutation({
    mutationFn: (masaId: number) => api(`/empaque/${masaId}/iniciar`, {
      method: 'POST',
      body: JSON.stringify({ fecha_vencimiento: fechaVenc }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] }); mostrarMsg('ok', 'Empaque iniciado'); },
    onError: (e: any) => mostrarMsg('err', e.message),
  });

  const guardarDetalle = async (masaId: number, productoId: number) => {
    const vals = detallesEdit[productoId];
    if (!vals) return;
    setSavingEmpaque(productoId);
    try {
      await api(`/empaque/${masaId}/detalle/${productoId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          unidades_empacadas: parseInt(vals.emp) || 0,
          unidades_merma: parseInt(vals.merma) || 0,
        }),
      });
      qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
      mostrarMsg('ok', 'Guardado');
    } catch (e: any) { mostrarMsg('err', e.message); }
    finally { setSavingEmpaque(null); }
  };

  const completarMut = useMutation({
    mutationFn: (masaId: number) => api(`/empaque/${masaId}/completar`, {
      method: 'POST', body: JSON.stringify({}),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
      const c = data.data?.costos;
      if (c) mostrarMsg('ok', `Completado — Costo total: $${COP(c.total)} | $/ud: $${COP(c.unitario)}`);
    },
    onError: (e: any) => mostrarMsg('err', e.message),
  });

  const verEtiqueta = async (masaId: number, productoId: number) => {
    try {
      const d = await api(`/empaque/${masaId}/etiqueta/${productoId}`);
      setEtiquetaData(d.data);
    } catch (e: any) { mostrarMsg('err', e.message); }
  };

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 text-gray-800">Empaque</h1>

      {msg && (
        <div className={`mb-4 px-4 py-2 rounded text-sm font-medium ${
          msg.tipo === 'ok' ? 'bg-green-100 text-green-800 border border-green-200'
                           : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {msg.texto}
        </div>
      )}

      <Card className="mb-6 p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Buscar por numero de Orden de Venta SAP
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={docNumInput}
            onChange={e => setDocNumInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setDocNumBuscar(docNumInput.trim())}
            placeholder="Ej: 20001"
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={() => setDocNumBuscar(docNumInput.trim())}
            className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 font-medium text-sm"
          >
            Buscar
          </button>
        </div>
      </Card>

      {isLoading && <p className="text-gray-500 text-sm">Buscando OV {docNumBuscar}...</p>}
      {ovError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          No se encontro la OV <strong>{docNumBuscar}</strong>. Verifique el numero.
        </div>
      )}

      {ov && (
        <div className="space-y-6">
          {/* Cabecera OV */}
          <Card className="p-4 border-l-4 border-blue-500">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-800">OV {docNumBuscar}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {ov.masa_padre.tipo} — {ov.masa_padre.codigo} — {ov.masa_padre.total_kg.toFixed(2)} kg
                </p>
              </div>
              {!ov.todas_horneadas ? (
                <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2 py-1 rounded">
                  Pendiente de hornear
                </span>
              ) : (
                <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                  Lista para empacar
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
              {ov.sub_masas.map(sm => (
                <div key={sm.id} className={`rounded p-2 text-xs border ${
                  sm.estado_horneado === 'COMPLETADA'
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-gray-50 border-gray-200 text-gray-500'
                }`}>
                  <div className="font-mono font-bold">{sm.codigo_masa}</div>
                  <div>HORNEADO: {sm.estado_horneado === 'COMPLETADA' ? 'OK' : sm.estado_horneado}</div>
                  <div>EMPAQUE: {sm.estado_empaque || 'BLOQUEADA'}</div>
                  <div>{sm.total_kilos_con_merma} kg</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Fecha de vencimiento */}
          {ov.todas_horneadas && (
            <Card className="p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Fecha de vencimiento del lote
              </label>
              <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)}
                className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
            </Card>
          )}

          {/* Productos por sub-masa */}
          {ov.sub_masas.map(sm => {
            const prodsSM = ov.productos.filter(p => p.masa_id === sm.id);
            const tieneEmpaque = prodsSM.some(p => p.empaque_id !== null);
            const empaqueCompleto = prodsSM.some(p => p.empaque_estado === 'COMPLETADO');

            return (
              <Card key={sm.id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-800">
                    Tanda: <span className="font-mono text-blue-700">{sm.codigo_masa}</span>
                    <span className="ml-2 text-sm text-gray-500 font-normal">({sm.total_kilos_con_merma} kg)</span>
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setModalMO({ masaId: sm.id, fase: 'EMPAQUE' })}
                      className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
                    >
                      MO
                    </button>
                    {!tieneEmpaque && sm.estado_horneado === 'COMPLETADA' && (
                      <button
                        onClick={() => {
                          if (!fechaVenc) return mostrarMsg('err', 'Ingrese fecha de vencimiento');
                          iniciarMut.mutate(sm.id);
                        }}
                        className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Iniciar empaque
                      </button>
                    )}
                    {tieneEmpaque && !empaqueCompleto && (
                      <button
                        onClick={() => completarMut.mutate(sm.id)}
                        disabled={completarMut.isPending}
                        className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {completarMut.isPending ? 'Completando...' : 'Completar empaque'}
                      </button>
                    )}
                    {empaqueCompleto && (
                      <span className="text-xs px-3 py-1 bg-green-100 text-green-800 rounded font-medium">
                        Empacado
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 text-xs">
                        <th className="text-left p-2 border-b">Producto</th>
                        <th className="text-right p-2 border-b">Programadas</th>
                        <th className="text-right p-2 border-b">Empacadas</th>
                        <th className="text-right p-2 border-b">Merma</th>
                        <th className="text-right p-2 border-b">Costo MP</th>
                        <th className="p-2 border-b"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodsSM.map(p => {
                        const edit = detallesEdit[p.id] ?? {
                          emp: String(p.unidades_empacadas ?? p.unidades_ajustadas ?? ''),
                          merma: String(p.unidades_merma ?? '0'),
                        };
                        const faltantes = p.unidades_ajustadas - (parseInt(edit.emp) || 0);
                        return (
                          <tr key={p.id} className="border-b hover:bg-gray-50">
                            <td className="p-2">
                              <div className="font-medium">{p.producto_nombre}</div>
                              <div className="text-xs text-gray-400">{p.sap_item_code} · {p.presentacion}</div>
                            </td>
                            <td className="p-2 text-right font-mono">{p.unidades_ajustadas}</td>
                            <td className="p-2 text-right">
                              {tieneEmpaque && !empaqueCompleto ? (
                                <input
                                  type="number" min="0"
                                  value={edit.emp}
                                  onChange={e => setDetallesEdit(prev => ({
                                    ...prev, [p.id]: { ...edit, emp: e.target.value }
                                  }))}
                                  className="w-20 border border-gray-300 rounded px-2 py-1 text-right text-sm"
                                />
                              ) : (
                                <span className={`font-mono ${faltantes > 0 ? 'text-red-600 font-bold' : 'text-green-700'}`}>
                                  {p.unidades_empacadas ?? '-'}
                                </span>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              {tieneEmpaque && !empaqueCompleto ? (
                                <input
                                  type="number" min="0"
                                  value={edit.merma}
                                  onChange={e => setDetallesEdit(prev => ({
                                    ...prev, [p.id]: { ...edit, merma: e.target.value }
                                  }))}
                                  className="w-16 border border-gray-300 rounded px-2 py-1 text-right text-sm"
                                />
                              ) : (
                                <span className="font-mono text-orange-600">{p.unidades_merma ?? '-'}</span>
                              )}
                            </td>
                            <td className="p-2 text-right text-xs text-gray-600">
                              ${COP(parseFloat(p.costo_mp_total_prod?.toString() || '0'))}
                            </td>
                            <td className="p-2 text-right">
                              <div className="flex gap-1 justify-end">
                                {tieneEmpaque && !empaqueCompleto && (
                                  <button
                                    onClick={() => guardarDetalle(p.masa_id, p.id)}
                                    disabled={savingEmpaque === p.id}
                                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {savingEmpaque === p.id ? '...' : 'Guardar'}
                                  </button>
                                )}
                                <button
                                  onClick={() => verEtiqueta(p.masa_id, p.id)}
                                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                                  title="Ver etiqueta INVIMA"
                                >
                                  Etiqueta
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {empaqueCompleto && prodsSM.some(p => (p.unidades_ajustadas - (p.unidades_empacadas ?? 0)) > 0) && (
                  <div className="mt-2 bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">
                    Hay unidades faltantes en esta tanda
                  </div>
                )}
              </Card>
            );
          })}

          {/* Materiales de empaque */}
          {ov.materiales_empaque.length > 0 && (
            <Card className="p-4">
              <h3 className="font-bold text-gray-800 mb-3">Materiales de empaque (BOM)</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs">
                    <th className="text-left p-2 border-b">Material</th>
                    <th className="text-left p-2 border-b">Producto padre</th>
                    <th className="text-right p-2 border-b">Cant/ud</th>
                    <th className="text-right p-2 border-b">Stock</th>
                    <th className="text-right p-2 border-b">Precio unit.</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.materiales_empaque.map((m, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="p-2">
                        <div className="font-medium">{m.item_name_comp}</div>
                        <div className="text-xs text-gray-400 font-mono">{m.item_code_comp}</div>
                      </td>
                      <td className="p-2 text-xs text-gray-500 font-mono">{m.item_code_padre}</td>
                      <td className="p-2 text-right font-mono">{m.cantidad_por_unidad} {m.uom}</td>
                      <td className={`p-2 text-right font-mono text-xs ${m.stock_disponible < 10 ? 'text-red-600 font-bold' : 'text-gray-700'}`}>
                        {m.stock_disponible} {m.uom}
                        {m.stock_disponible < 10 && ' (bajo)'}
                      </td>
                      <td className="p-2 text-right text-xs">${COP(parseFloat(m.precio_unitario.toString()))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                onClick={() => api('/config/sync-empaque', { method: 'POST' })
                  .then(() => { qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] }); mostrarMsg('ok', 'Precios sincronizados desde SAP'); })
                  .catch((e: any) => mostrarMsg('err', e.message))}
                className="mt-3 text-xs px-3 py-1.5 border border-blue-300 text-blue-600 rounded hover:bg-blue-50"
              >
                Sincronizar precios desde SAP
              </button>
            </Card>
          )}

          {/* Resumen de costos */}
          <Card className="p-4 border-l-4 border-green-500">
            <h3 className="font-bold text-gray-800 mb-3">Resumen de costos consolidado</h3>
            <div className="space-y-1 text-sm">
              {([
                ['Materias primas (MP)', ov.resumen_costos.costo_mp],
                ['Mano de obra (MO)', ov.resumen_costos.costo_mo],
                ['Materiales de empaque', ov.resumen_costos.costo_empaque],
                ['Costos indirectos', ov.resumen_costos.costo_indirecto],
              ] as [string, number][]).map(([label, val]) => (
                <div key={label} className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-gray-600">{label}</span>
                  <span className="font-mono">${COP(val)}</span>
                </div>
              ))}
              <div className="flex justify-between py-2 font-bold text-gray-800">
                <span>COSTO TOTAL</span>
                <span className="font-mono text-green-700">${COP(ov.resumen_costos.costo_total)}</span>
              </div>
              {ov.productos.length > 0 && ov.resumen_costos.costo_total > 0 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Costo estimado por unidad</span>
                  <span className="font-mono">
                    ${COP(ov.resumen_costos.costo_total /
                      ov.productos.reduce((s, p) => s + (p.unidades_ajustadas || 0), 0))}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              * Los costos finales se calculan al completar el empaque de cada tanda.
            </p>
          </Card>
        </div>
      )}

      {modalMO && (
        <ModalMO
          masaId={modalMO.masaId}
          fase={modalMO.fase}
          tiposMO={tiposMO}
          onClose={() => setModalMO(null)}
          onSave={() => qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] })}
        />
      )}

      {etiquetaData && (
        <Etiqueta data={etiquetaData} onClose={() => setEtiquetaData(null)} />
      )}
    </div>
  );
};

export default EmpaqueMasa;
