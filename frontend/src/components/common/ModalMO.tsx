/**
 * ModalMO.tsx — Componente reutilizable para registrar Mano de Obra
 * Usado en todas las fases: Pesaje, Amasado, División, Formado, Fermentación, Horneado, Empaque
 */
import React, { useState } from 'react';

const getToken = () => {
  try {
    const a = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return a?.state?.token || a?.state?.accessToken || '';
  } catch { return ''; }
};

const api = async (path: string, opts?: RequestInit) => {
  const r = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    ...opts,
  });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.message || 'Error'), { status: r.status });
  return d;
};

const COP = (n: number) => Math.round(n).toLocaleString('es-CO');

interface TipoMO { id: number; nombre: string; costo_hora: number; }
interface RegistroMO { id: number; fase: string; tipo_mo_id: number; horas: number; costo_calculado: number; observaciones: string; }

interface Props {
  masaId: number;
  fase: string;
  onClose: () => void;
}

export const ModalMO: React.FC<Props> = ({ masaId, fase, onClose }) => {
  const [tiposMO, setTiposMO] = useState<TipoMO[]>([]);
  const [registros, setRegistros] = useState<RegistroMO[]>([]);
  const [tipoId, setTipoId] = useState('');
  const [horas, setHoras] = useState('');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    const cargar = async () => {
      try {
        const [tipos, regs] = await Promise.all([
          api('/config/mano-obra'),
          api(`/config/mano-obra/masa/${masaId}`),
        ]);
        setTiposMO(tipos.data || []);
        setRegistros((regs.data || []).filter((r: RegistroMO) => r.fase === fase));
        setLoaded(true);
      } catch (e: any) { setErr(e.message); setLoaded(true); }
    };
    cargar();
  }, [masaId, fase]);

  const tipo = tiposMO.find(t => String(t.id) === tipoId);
  const costoPreview = tipo && horas ? parseFloat(tipo.costo_hora as any) * parseFloat(horas) : 0;
  const totalFase = registros.reduce((s, r) => s + parseFloat(r.costo_calculado as any), 0);

  const handleGuardar = async () => {
    if (!tipoId || !horas || parseFloat(horas) <= 0) return setErr('Seleccione tipo y horas válidas');
    setSaving(true); setErr('');
    try {
      await api(`/config/mano-obra/masa/${masaId}`, {
        method: 'POST',
        body: JSON.stringify({ fase, tipo_mo_id: Number(tipoId), horas: parseFloat(horas), observaciones: obs }),
      });
      const regs = await api(`/config/mano-obra/masa/${masaId}`);
      setRegistros((regs.data || []).filter((r: RegistroMO) => r.fase === fase));
      setTipoId(''); setHoras(''); setObs('');
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 className="font-bold text-lg">Mano de Obra</h3>
            <p className="text-sm text-gray-500">Fase: {fase}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {err && <p className="text-red-600 text-sm bg-red-50 rounded p-2">{err}</p>}

          {loaded && registros.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Registrado en {fase}</p>
              {registros.map(r => {
                const t = tiposMO.find(x => x.id === r.tipo_mo_id);
                return (
                  <div key={r.id} className="flex justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                    <span className="text-gray-700">{t?.nombre || `Tipo ${r.tipo_mo_id}`} · {r.horas}h</span>
                    <span className="font-mono font-medium">${COP(parseFloat(r.costo_calculado as any))}</span>
                  </div>
                );
              })}
              <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t border-gray-200">
                <span>Total {fase}</span>
                <span className="text-green-700">${COP(totalFase)}</span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de operario</label>
              <select value={tipoId} onChange={e => setTipoId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none">
                <option value="">Seleccionar...</option>
                {tiposMO.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} — ${COP(parseFloat(t.costo_hora as any))}/h
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Horas trabajadas</label>
              <input type="number" min="0.1" step="0.1" value={horas}
                onChange={e => setHoras(e.target.value)}
                placeholder="Ej: 1.5"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            </div>

            {costoPreview > 0 && (
              <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-blue-600">Costo a registrar: </span>
                <span className="font-bold text-blue-800">${COP(costoPreview)}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Observaciones <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input type="text" value={obs} onChange={e => setObs(e.target.value)}
                placeholder="Ej: Turno mañana"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-5 pt-0">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cerrar
          </button>
          <button onClick={handleGuardar} disabled={saving || !tipoId || !horas}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Guardando...' : '+ Agregar registro'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalMO;
