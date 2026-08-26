/**
 * CostosConfig.tsx — ARTESA
 * Configuracion de costos de produccion:
 * - Tipos de mano de obra con costo/hora
 * - Costos indirectos fijos
 * - Configuracion de etiquetas INVIMA por producto
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/common';

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
  if (!r.ok) throw Object.assign(new Error(d.message || 'Error'), { status: r.status });
  return d;
};
const COP = (v: number) => v.toLocaleString('es-CO', { minimumFractionDigits: 0 });

// ── Tipos mano de obra ───────────────────────────────────────────────────────
const SeccionMO: React.FC = () => {
  const qc = useQueryClient();
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', costo_hora: '' });
  const [editando, setEditando] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<number | null>(null);

  const { data } = useQuery({ queryKey: ['tipos-mo'], queryFn: () => api('/config/mano-obra') });
  const tipos = data?.data || [];

  const ok = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const crear = async () => {
    if (!nuevo.nombre || !nuevo.costo_hora) return;
    setSaving(true);
    try {
      await api('/config/mano-obra', {
        method: 'POST',
        body: JSON.stringify({ ...nuevo, costo_hora: parseFloat(nuevo.costo_hora) }),
      });
      qc.invalidateQueries({ queryKey: ['tipos-mo'] });
      setNuevo({ nombre: '', descripcion: '', costo_hora: '' });
      ok('Tipo de MO creado');
    } finally {
      setSaving(false);
    }
  };

  const actualizar = async () => {
    if (!editando) return;
    setSaving(true);
    try {
      await api(`/config/mano-obra/${editando.id}`, {
        method: 'PUT',
        body: JSON.stringify({ nombre: editando.nombre, costo_hora: parseFloat(editando.costo_hora), descripcion: editando.descripcion }),
      });
      qc.invalidateQueries({ queryKey: ['tipos-mo'] });
      setEditando(null);
      ok('Actualizado');
    } finally {
      setSaving(false);
    }
  };

  const eliminar = async (id: number) => {
    setEliminandoId(id);
    try {
      await api(`/config/mano-obra/${id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['tipos-mo'] });
      ok('Desactivado');
    } finally {
      setEliminandoId(null);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-bold text-lg text-gray-800 mb-1">Tipos de Mano de Obra</h2>
      <p className="text-sm text-gray-500 mb-4">Configure los tipos de operario y su costo por hora.</p>
      {msg && <div className="mb-3 text-green-700 text-sm bg-green-50 rounded px-3 py-1.5">{msg}</div>}

      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="bg-gray-50 text-gray-600 text-xs">
            <th className="text-left p-2 border-b">Tipo</th>
            <th className="text-left p-2 border-b">Descripcion</th>
            <th className="text-right p-2 border-b">$/hora</th>
            <th className="p-2 border-b"></th>
          </tr>
        </thead>
        <tbody>
          {tipos.map((t: any) => (
            <tr key={t.id} className="border-b hover:bg-gray-50">
              {editando?.id === t.id ? (
                <>
                  <td className="p-2">
                    <input value={editando.nombre} onChange={e => setEditando({ ...editando, nombre: e.target.value })}
                      className="border rounded px-2 py-1 w-full text-sm" />
                  </td>
                  <td className="p-2">
                    <input value={editando.descripcion || ''} onChange={e => setEditando({ ...editando, descripcion: e.target.value })}
                      className="border rounded px-2 py-1 w-full text-sm" />
                  </td>
                  <td className="p-2">
                    <input type="number" value={editando.costo_hora} onChange={e => setEditando({ ...editando, costo_hora: e.target.value })}
                      className="border rounded px-2 py-1 w-28 text-right text-sm" />
                  </td>
                  <td className="p-2 text-right">
                    <button onClick={actualizar} disabled={saving} className="text-xs text-green-700 font-medium mr-2 disabled:opacity-50">
                      {saving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={() => setEditando(null)} disabled={saving} className="text-xs text-gray-500 disabled:opacity-50">Cancelar</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="p-2 font-medium">{t.nombre}</td>
                  <td className="p-2 text-gray-500 text-xs">{t.descripcion || '—'}</td>
                  <td className="p-2 text-right font-mono">${COP(parseFloat(t.costo_hora))}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => setEditando({ ...t })} className="text-xs text-blue-600 mr-2">Editar</button>
                    <button onClick={() => eliminar(t.id)} disabled={eliminandoId === t.id} className="text-xs text-red-500 disabled:opacity-50">
                      {eliminandoId === t.id ? 'Desactivando...' : 'Desactivar'}
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t pt-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Agregar tipo</p>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Nombre" value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })}
            className="border rounded px-3 py-2 text-sm" />
          <input placeholder="Descripcion (opcional)" value={nuevo.descripcion} onChange={e => setNuevo({ ...nuevo, descripcion: e.target.value })}
            className="border rounded px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <input type="number" placeholder="$/hora" value={nuevo.costo_hora} onChange={e => setNuevo({ ...nuevo, costo_hora: e.target.value })}
              className="border rounded px-3 py-2 text-sm flex-1" />
            <button onClick={crear} disabled={saving} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 text-sm font-medium disabled:opacity-50">
              {saving ? 'Agregando...' : '+ Agregar'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
};

// ── Costos indirectos ────────────────────────────────────────────────────────
const SeccionIndirectos: React.FC = () => {
  const qc = useQueryClient();
  const [vals, setVals] = useState({ costo_indirecto_por_kg: '0', costo_depreciacion_por_kg: '0' });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const ok = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const { data } = useQuery({
    queryKey: ['costos-indirectos'],
    queryFn: () => api('/config/costos-indirectos'),
    select: d => d.data,
  });

  React.useEffect(() => {
    if (data) setVals({
      costo_indirecto_por_kg: String(data.costo_indirecto_por_kg),
      costo_depreciacion_por_kg: String(data.costo_depreciacion_por_kg),
    });
  }, [data]);

  const guardar = async () => {
    setSaving(true);
    try {
      await api('/config/costos-indirectos', {
        method: 'PUT',
        body: JSON.stringify({
          costo_indirecto_por_kg:    parseFloat(vals.costo_indirecto_por_kg),
          costo_depreciacion_por_kg: parseFloat(vals.costo_depreciacion_por_kg),
        }),
      });
      qc.invalidateQueries({ queryKey: ['costos-indirectos'] });
      ok('Costos indirectos actualizados');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-bold text-lg text-gray-800 mb-1">Costos Indirectos Fijos</h2>
      <p className="text-sm text-gray-500 mb-4">Costos fijos asignados por kg producido (arriendo, servicios, maquinaria).</p>
      {msg && <div className="mb-3 text-green-700 text-sm bg-green-50 rounded px-3 py-1.5">{msg}</div>}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Costo indirecto por kg (COP)
            <span className="text-xs text-gray-400 ml-1">— arriendo, servicios</span>
          </label>
          <input type="number" min="0" value={vals.costo_indirecto_por_kg}
            onChange={e => setVals({ ...vals, costo_indirecto_por_kg: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Depreciacion de maquinaria por kg (COP)
          </label>
          <input type="number" min="0" value={vals.costo_depreciacion_por_kg}
            onChange={e => setVals({ ...vals, costo_depreciacion_por_kg: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
      </div>
      <button onClick={guardar} disabled={saving} className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
        {saving ? 'Guardando...' : 'Guardar costos indirectos'}
      </button>
    </Card>
  );
};

// ── Etiquetas INVIMA ─────────────────────────────────────────────────────────
const SeccionEtiquetas: React.FC = () => {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    sap_item_code: '', nombre_producto: '', ingredientes_txt: '',
    alergenos_txt: '', condiciones_txt: 'Mantener en lugar fresco y seco',
    registro_invima: '', peso_neto_txt: '', fabricante_txt: 'La Artesa SAS – Bogota, Colombia',
  });
  const [msg, setMsg] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ok = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const { data } = useQuery({ queryKey: ['etiquetas'], queryFn: () => api('/config/etiquetas') });
  const etiquetas = data?.data || [];

  const cargar = (e: any) => {
    setEditId(e.sap_item_code);
    setForm({ ...e });
  };

  const guardar = async () => {
    setSaving(true);
    try {
      await api('/config/etiquetas', { method: 'POST', body: JSON.stringify(form) });
      qc.invalidateQueries({ queryKey: ['etiquetas'] });
      setEditId(null);
      setForm({
        sap_item_code: '', nombre_producto: '', ingredientes_txt: '', alergenos_txt: '',
        condiciones_txt: 'Mantener en lugar fresco y seco', registro_invima: '', peso_neto_txt: '',
        fabricante_txt: 'La Artesa SAS – Bogota, Colombia',
      });
      ok('Etiqueta guardada');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-bold text-lg text-gray-800 mb-1">Configuracion de Etiquetas INVIMA</h2>
      <p className="text-sm text-gray-500 mb-4">Configure los datos de la etiqueta por producto SAP.</p>
      {msg && <div className="mb-3 text-green-700 text-sm bg-green-50 rounded px-3 py-1.5">{msg}</div>}

      {etiquetas.length > 0 && (
        <div className="mb-4 border rounded overflow-hidden">
          {etiquetas.map((e: any) => (
            <div key={e.sap_item_code} className={`flex items-center justify-between px-3 py-2 border-b hover:bg-gray-50 ${editId === e.sap_item_code ? 'bg-blue-50' : ''}`}>
              <div>
                <span className="font-mono text-xs text-gray-500 mr-2">{e.sap_item_code}</span>
                <span className="font-medium text-sm">{e.nombre_producto}</span>
                {e.registro_invima && <span className="text-xs text-gray-400 ml-2">INVIMA: {e.registro_invima}</span>}
              </div>
              <button onClick={() => cargar(e)} className="text-xs text-blue-600 hover:underline">Editar</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Codigo SAP *</label>
          <input value={form.sap_item_code} onChange={e => setForm({ ...form, sap_item_code: e.target.value })}
            placeholder="Ej: PANPAQ157" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Nombre en etiqueta *</label>
          <input value={form.nombre_producto} onChange={e => setForm({ ...form, nombre_producto: e.target.value })}
            placeholder="Ej: Pan Toscano x2" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Peso neto</label>
          <input value={form.peso_neto_txt} onChange={e => setForm({ ...form, peso_neto_txt: e.target.value })}
            placeholder="Ej: 200g x 2 unidades" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Registro INVIMA</label>
          <input value={form.registro_invima} onChange={e => setForm({ ...form, registro_invima: e.target.value })}
            placeholder="Ej: RSAXX-XXXXXXX" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Lista de ingredientes</label>
          <textarea value={form.ingredientes_txt} onChange={e => setForm({ ...form, ingredientes_txt: e.target.value })}
            rows={2} placeholder="Harina de trigo, agua, sal, levadura..."
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Alergenos</label>
          <input value={form.alergenos_txt} onChange={e => setForm({ ...form, alergenos_txt: e.target.value })}
            placeholder="Contiene: Gluten. Puede contener: Huevo, Lacteos"
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Condiciones de conservacion</label>
          <input value={form.condiciones_txt} onChange={e => setForm({ ...form, condiciones_txt: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Fabricante</label>
          <input value={form.fabricante_txt} onChange={e => setForm({ ...form, fabricante_txt: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm" />
        </div>
      </div>
      <button onClick={guardar} disabled={saving}
        className="mt-4 bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
        {saving ? 'Guardando...' : editId ? 'Actualizar etiqueta' : '+ Guardar etiqueta'}
      </button>
    </Card>
  );
};

// ── Pagina principal ─────────────────────────────────────────────────────────
export const CostosConfig: React.FC = () => {
  const [tab, setTab] = useState<'mo' | 'indirectos' | 'etiquetas'>('mo');

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2 text-gray-800">Configuracion de Costos</h1>
      <p className="text-sm text-gray-500 mb-5">Mano de obra, costos indirectos y etiquetas INVIMA.</p>

      <div className="flex gap-1 mb-5 border-b">
        {([
          { id: 'mo',         label: 'Mano de Obra' },
          { id: 'indirectos', label: 'Costos Indirectos' },
          { id: 'etiquetas',  label: 'Etiquetas INVIMA' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mo'         && <SeccionMO />}
      {tab === 'indirectos' && <SeccionIndirectos />}
      {tab === 'etiquetas'  && <SeccionEtiquetas />}
    </div>
  );
};

export default CostosConfig;
