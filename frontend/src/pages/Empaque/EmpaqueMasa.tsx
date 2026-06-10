/**
 * EmpaqueMasa.tsx — ARTESA
 * Módulo de empaque con dos modos de acceso:
 *   A) Lista de masas listas (horneado completo, empaque pendiente)
 *   B) Búsqueda manual por número de OV SAP
 *
 * Para masas con múltiples OVs, el formulario agrupa los productos por OV.
 * Si hay faltantes, se exige observación obligatoria antes de completar.
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
interface ProductoPendiente {
  id: number;
  sap_item_code: string;
  producto_nombre: string;
  presentacion: string;
  gramaje_unitario: number;
  unidades_programadas: number;    // panes sugeridos (pedidas × xPaq)
  unidades_divididas: number;      // cantidad_divisiones real por producto
  unidades_horneadas: number;      // unidades_producidas post-horneado por producto
  unidades_referencia: number;     // para faltante: horneadas > divididas > sugeridas
  division_completada: boolean;
  unidades_producidas: number;
  unidades_por_paquete: number | null;
  sap_doc_num: string | null;
  sap_doc_entry: number | null;
  unidades_terminadas_horneado: number | null;
}
interface OVPendiente {
  doc_num: string;
  productos: ProductoPendiente[];
}
interface MaterialAlistamiento {
  item_code: string;
  nombre: string;
  uom: string;
  cantidad_total: number;
  precio_unitario: number;
  stock_disponible: number;
}
interface MasaPendiente {
  id: number;
  codigo_masa: string;
  nombre_masa: string;
  tipo_masa: string;
  total_kilos_con_merma: number;
  fecha_produccion: string;
  es_subdivision: boolean;
  estado_empaque: string;
  estado_horneado: string;
  horneado_completo: boolean;
  lote_produccion: string | null;
  empaque_iniciado: boolean;
  empaque_id: number | null;
  fecha_vencimiento: string | null;
  sap_doc_entry_entrada: number | null;
  sap_doc_entry_salida: number | null;
  sap_error_entrada: string | null;
  sap_error_salida: string | null;
  materiales_alistamiento: MaterialAlistamiento[];
  ovs: OVPendiente[];
}

interface SubMasa {
  id: number;
  codigo_masa: string;
  estado_horneado: string;
  estado_empaque: string;
  total_kilos_con_merma: number;
  sap_doc_entry_entrada: number | null;
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
  costo_mp: number;
  costo_mo: number;
  costo_empaque: number;
  costo_indirecto: number;
  costo_total: number;
}
interface OVData {
  masa_padre: { id: number; codigo: string; tipo: string; total_kg: number };
  sub_masas: SubMasa[];
  todas_horneadas: boolean;
  productos: Producto[];
  materiales_empaque: MaterialEmpaque[];
  resumen_costos: ResumenCostos;
}

const COP = (v: number) => isNaN(v) ? '0' : v.toLocaleString('es-CO', { minimumFractionDigits: 0 });
const fmtFecha = (s: string) => new Date(s + 'T12:00').toLocaleDateString('es-CO');

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
        <div><span class="lbl">Vence:</span> ${data.fecha_vencimiento ? fmtFecha(data.fecha_vencimiento) : '--'}</div>
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
            <div><span className="font-bold">Vence:</span> {data.fecha_vencimiento ? fmtFecha(data.fecha_vencimiento) : '--'}</div>
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

// ── Modal observación de faltantes ──────────────────────────────────────────
const ModalFaltantes: React.FC<{
  faltantes: { nombre: string; ov: string; faltante: number }[];
  onConfirmar: (obs: string) => void;
  onCancelar: () => void;
}> = ({ faltantes, onConfirmar, onCancelar }) => {
  const [obs, setObs] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="font-bold text-lg mb-3 text-amber-700">Unidades faltantes</h3>
        <p className="text-sm text-gray-600 mb-3">
          Se detectaron faltantes en los siguientes productos. Ingrese una observación obligatoria para continuar:
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 space-y-1">
          {faltantes.map((f, i) => (
            <div key={i} className="text-sm flex justify-between">
              <span className="text-gray-700">
                {f.nombre} <span className="text-xs text-gray-400">(OV {f.ov})</span>
              </span>
              <span className="font-bold text-red-600">−{f.faltante} und</span>
            </div>
          ))}
        </div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Observación <span className="text-red-500">*</span>
        </label>
        <textarea
          value={obs}
          onChange={e => setObs(e.target.value)}
          rows={3}
          placeholder="Ej: 15 unidades quemadas en horno, se dejaron solo 170 paquetes para OV 343..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 resize-none"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { if (obs.trim()) onConfirmar(obs.trim()); }}
            disabled={!obs.trim()}
            className="flex-1 bg-amber-600 text-white py-2 rounded hover:bg-amber-700 disabled:opacity-40 font-medium"
          >
            Confirmar y completar
          </button>
          <button onClick={onCancelar} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Modal MO ─────────────────────────────────────────────────────────────────
const ModalMO: React.FC<{
  masaId: number;
  fase: string;
  tiposMO: any[];
  onClose: () => void;
  onSave: () => void;
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

// ── Botón de etiqueta rápida desde la lista ──────────────────────────────────
const EtiquetaRapida: React.FC<{ masaId: number; productoId: number }> = ({ masaId, productoId }) => {
  const [etiquetaData, setEtiquetaData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const ver = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const d = await api(`/empaque/${masaId}/etiqueta/${productoId}`);
      setEtiquetaData(d.data);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  return (
    <>
      <button
        onClick={ver}
        disabled={loading}
        className="text-xs px-2 py-0.5 border border-gray-300 rounded hover:bg-white hover:border-blue-400 text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
        title="Imprimir etiqueta INVIMA"
      >
        {loading ? '...' : '🏷 Etiqueta'}
      </button>
      {etiquetaData && (
        <Etiqueta data={etiquetaData} onClose={() => setEtiquetaData(null)} />
      )}
    </>
  );
};

// ── Panel: lista de masas pendientes ─────────────────────────────────────────
const PanelPendientes: React.FC<{
  masas: MasaPendiente[];
  onSeleccionar: (masa: MasaPendiente) => void;
}> = ({ masas, onSeleccionar }) => {
  if (!masas.length)
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No hay masas pendientes de empaque en este momento.
      </div>
    );
  return (
    <div className="space-y-3">
      {masas.map(masa => {
        const totalOVs = masa.ovs.filter(o => o.doc_num !== 'SIN_OV').length;
        const totalProductos = masa.ovs.reduce((s, o) => s + o.productos.length, 0);
        return (
          <div
            key={masa.id}
            className={`border rounded-lg p-4 transition-all ${
              masa.horneado_completo
                ? 'border-green-300 bg-green-50'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            {/* Cabecera clickeable → abre formulario de empaque */}
            <div
              onClick={() => onSeleccionar(masa)}
              className="flex items-start justify-between cursor-pointer hover:opacity-80"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-bold text-gray-800">{masa.nombre_masa}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                    {masa.codigo_masa}
                  </span>
                  {masa.horneado_completo
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-200 text-green-800 font-medium">✅ Listo para empacar</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 font-medium">🕐 En producción — alistamiento</span>
                  }
                  {(masa.sap_error_entrada || masa.sap_error_salida) && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium">
                      ⚠ Error SAP pendiente
                    </span>
                  )}
                  {masa.empaque_iniciado && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">En progreso</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>{masa.tipo_masa}</span>
                  <span>{masa.total_kilos_con_merma.toFixed(2)} kg</span>
                  <span>{fmtFecha(masa.fecha_produccion)}</span>
                  {masa.lote_produccion && (
                    <span className="font-mono font-semibold text-indigo-700 bg-indigo-50 px-1.5 rounded">
                      Lote: {masa.lote_produccion}
                    </span>
                  )}
                  <span>{totalOVs > 0 ? `${totalOVs} OV${totalOVs > 1 ? 's' : ''}` : 'Sin OV asignada'}</span>
                  <span>{totalProductos} producto{totalProductos !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {masa.ovs.filter(o => o.doc_num !== 'SIN_OV').map(o => (
                    <span key={o.doc_num}
                      className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded font-mono">
                      OV {o.doc_num}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-gray-400 text-lg ml-3">→</div>
            </div>

            {/* Sección de alistamiento anticipado — visible siempre */}
            {masa.ovs.map(ov => (
              <div key={ov.doc_num} className="mt-3 border-t border-gray-200 pt-3">
                {ov.doc_num !== 'SIN_OV' && (
                  <div className="text-xs font-semibold text-gray-500 mb-2">OV {ov.doc_num}</div>
                )}
                <div className="space-y-1">
                  {ov.productos.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-700 truncate block">{p.producto_nombre}</span>
                        <span className="text-gray-400 font-mono">{p.sap_item_code} · {p.presentacion}</span>
                      </div>
                      <div className="flex items-center gap-3 ml-3 shrink-0">
                        <span className="text-purple-700 font-semibold">
                          {p.unidades_programadas} paq
                        </span>
                        {p.division_completada && (
                          <span className="text-blue-600 font-semibold">{p.unidades_referencia} div.</span>
                        )}
                        <EtiquetaRapida masaId={masa.id} productoId={p.id} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Materiales de empaque para alistar */}
            {masa.materiales_alistamiento && masa.materiales_alistamiento.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <div className="text-xs font-semibold text-gray-500 mb-2">📦 Materiales de empaque a alistar</div>
                <div className="grid grid-cols-1 gap-1">
                  {masa.materiales_alistamiento.map(mat => (
                    <div key={mat.item_code} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1 border border-gray-100">
                      <span className="text-gray-700 font-medium">{mat.nombre}</span>
                      <div className="flex items-center gap-3 text-gray-500">
                        <span>
                          Necesita: <span className="font-bold text-gray-800">
                            {mat.cantidad_total % 1 === 0 ? mat.cantidad_total : mat.cantidad_total.toFixed(2)}
                          </span> {mat.uom}
                        </span>
                        <span className={mat.stock_disponible >= mat.cantidad_total ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                          Stock: {mat.stock_disponible % 1 === 0 ? mat.stock_disponible : mat.stock_disponible.toFixed(2)} {mat.uom}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Panel: formulario de empaque por masa ────────────────────────────────────
const PanelEmpaqueMasa: React.FC<{
  masa: MasaPendiente;
  onVolver: () => void;
  onCompletado: () => void;
  tiposMO: any[];
}> = ({ masa, onVolver, onCompletado, tiposMO }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Re-fetch del estado real de la masa para detectar cambios post-iniciar
  const { data: masaActualData, refetch: refetchMasaActual } = useQuery({
    queryKey: ['empaque-masa-actual', masa.id],
    queryFn: () => api(`/empaque/${masa.id}`),
    refetchInterval: false,
  });
  const estadoEmpaqueActual: string =
    masaActualData?.data?.masa?.estado_empaque || masa.estado_empaque;
  const empaque_iniciado: boolean =
    masaActualData?.data?.registro_empaque != null || masa.empaque_iniciado;
  const lote_produccion: string | null =
    masa.lote_produccion || masaActualData?.data?.masa?.lote_produccion || null;
  const yaEnviadoSAP: boolean =
    !!(masaActualData?.data?.registro_empaque?.sap_doc_entry_entrada ?? masa.sap_doc_entry_entrada);
  // El formulario activo solo cuando EMPAQUE está EN_PROGRESO (horneado terminado)
  // Si está PENDIENTE → solo consulta, sin iniciar ni guardar
  const puedeOperar = estadoEmpaqueActual === 'EN_PROGRESO';

  const [detalles, setDetalles] = useState<Record<number, { emp: string; merma: string }>>(() => {
    const init: Record<number, { emp: string; merma: string }> = {};
    masa.ovs.forEach(ov => ov.productos.forEach(p => {
      init[p.id] = { emp: '', merma: '' };
    }));
    return init;
  });

  // Cargar valores guardados desde la DB cuando llegan
  useEffect(() => {
    if (!masaActualData?.data?.productos) return;
    setDetalles(prev => {
      const next = { ...prev };
      for (const p of masaActualData.data.productos) {
        const empacadas = p.unidades_producidas ?? null;
        // Solo sobreescribir si el campo está vacío (no tocar lo que el usuario está editando)
        if (next[p.id] !== undefined && next[p.id].emp === '') {
          next[p.id] = {
            emp:   empacadas !== null && empacadas > 0 ? String(empacadas) : '',
            merma: '',
          };
        }
      }
      return next;
    });
  }, [masaActualData]);

  const fechaVencInicial = masa.fecha_vencimiento
    || (masaActualData?.data?.masa?.empaque_datos_fase as Record<string, string> | null)?.fecha_vencimiento_sugerida
    || '';
  const [fechaVenc, setFechaVenc] = useState(fechaVencInicial);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [modalMO, setModalMO] = useState(false);
  const [modalFaltantes, setModalFaltantes] = useState<{ faltantes: any[] } | null>(null);
  const [etiquetaData, setEtiquetaData] = useState<any>(null);
  const [guardadoIds, setGuardadoIds] = useState<Set<number>>(new Set());

  const mostrar = (tipo: 'ok' | 'err', texto: string) => {
    setMsg({ tipo, texto });
    if (tipo === 'ok') setTimeout(() => setMsg(null), 4000);
    // Los errores no se auto-cierran — requieren OK del usuario
  };

  const iniciar = async () => {
    if (!fechaVenc) return mostrar('err', 'Ingrese la fecha de vencimiento');
    setSaving(true);
    try {
      await api(`/empaque/${masa.id}/iniciar`, {
        method: 'POST',
        body: JSON.stringify({ fecha_vencimiento: fechaVenc }),
      });
      await refetchMasaActual();
      qc.invalidateQueries({ queryKey: ['empaque-pendientes'] });
      mostrar('ok', 'Empaque iniciado — ya puedes ingresar las cantidades');
    } catch (e: any) { mostrar('err', e.message); }
    finally { setSaving(false); }
  };

  const guardarDetalle = async (productoId: number) => {
    const vals = detalles[productoId];
    if (!vals) return;
    setSavingId(productoId);
    try {
      await api(`/empaque/${masa.id}/detalle/${productoId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          unidades_empacadas: parseInt(vals.emp) || 0,
          unidades_merma: (() => {
            const prod = masaActualData?.data?.productos?.find((p: any) => p.id === productoId);
            const emp = parseInt(vals.emp) || 0;
            const base = prod ? (prod.cantidad_divisiones > 0 ? prod.cantidad_divisiones : (prod.unidades_terminadas_horneado || 0)) : 0;
            return Math.max(0, base - emp);
          })(),
        }),
      });
      setGuardadoIds(prev => { const n = new Set(prev); n.add(productoId); return n; });
      await refetchMasaActual();
      qc.invalidateQueries({ queryKey: ['empaque-pendientes'] });
      mostrar('ok', 'Guardado correctamente');
    } catch (e: any) { mostrar('err', e.message); }
    finally { setSavingId(null); }
  };

  const handleCompletar = async (obsOverride?: string) => {
    const faltantes: { nombre: string; ov: string; faltante: number }[] = [];
    masa.ovs.forEach(ov => {
      ov.productos.forEach(p => {
        const empacadas = parseInt(detalles[p.id]?.emp || '0') || 0;
        const faltante = p.unidades_referencia - empacadas;
        if (faltante > 0) faltantes.push({ nombre: p.producto_nombre, ov: ov.doc_num, faltante });
      });
    });

    if (faltantes.length && !obsOverride) {
      setModalFaltantes({ faltantes });
      return;
    }

    setSaving(true);
    try {
      const ahora = new Date();
      const fecha_local = `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-${String(ahora.getDate()).padStart(2,'0')}`;
      const resultado = await api(`/empaque/${masa.id}/completar`, {
        method: 'POST',
        body: JSON.stringify({ observaciones: obsOverride || null, fecha_local }),
      });
      qc.invalidateQueries({ queryKey: ['empaque-pendientes'] });
      refetchMasaActual();
      if (resultado?.sap_advertencias?.length > 0) {
        mostrar('err', `⚠ Empaque guardado, pero hubo errores en SAP:\n${resultado.sap_advertencias.join('\n')}\n\nContacta al supervisor para corregir el movimiento en SAP.`);
        // No navegar — dejar al usuario ver el error
      } else {
        mostrar('ok', 'Empaque completado');
        setTimeout(() => onCompletado(), 1500);
      }
    } catch (e: any) {
      const itemSinStock = e?.data?.item_sin_stock;
      if (itemSinStock) {
        mostrar('err',
          `⚠ Sin stock de "${itemSinStock.nombre}" (${itemSinStock.codigo}) en SAP. ` +
          `Informa a compras para verificar saldo en almacén ALMP antes de reintentar.`
        );
      } else {
        mostrar('err', e?.data?.message || e.message);
      }
    }
    finally { setSaving(false); }
  };

  const verEtiqueta = async (productoId: number) => {
    try {
      const d = await api(`/empaque/${masa.id}/etiqueta/${productoId}`);
      setEtiquetaData(d.data);
    } catch (e: any) { mostrar('err', e.message); }
  };

  const totalProductos = masa.ovs.reduce((s, o) => s + o.productos.length, 0);
  const totalProgramadas = masa.ovs.reduce((s, o) =>
    s + o.productos.reduce((ss, p) => ss + (p.unidades_programadas || 0), 0), 0);
  const totalDivision = masa.ovs.reduce((s, o) =>
    s + o.productos.reduce((ss, p) => ss + (p.unidades_divididas || 0), 0), 0);
  const totalHorneadas = masa.ovs.reduce((s, o) =>
    s + o.productos.reduce((ss, p) => ss + (p.unidades_horneadas || 0), 0), 0);
  const totalEmpacadas = Object.values(detalles).reduce((s, v) => s + (parseInt(v.emp) || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onVolver} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium">
          ← Lista
        </button>
        <button
          onClick={() => navigate(`/horneado/${masa.id}`)}
          className="flex items-center gap-1 px-4 py-2 bg-white border border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-600 hover:text-red-700 rounded-lg text-sm font-medium shadow-sm transition-colors"
        >
          ← Horneado
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-800">{masa.nombre_masa}</h2>
          <p className="text-xs text-gray-500 font-mono">{masa.codigo_masa} · {masa.total_kilos_con_merma.toFixed(2)} kg</p>
        </div>
        {empaque_iniciado && puedeOperar && (
          <button
            onClick={() => setModalMO(true)}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
          >
            + Mano de obra
          </button>
        )}
      </div>

      {/* Banner de lote */}
      {lote_produccion && (
        <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
          <span className="text-indigo-600 font-medium text-sm">Lote:</span>
          <span className="font-mono font-bold text-indigo-800 text-base tracking-wider">{lote_produccion}</span>
        </div>
      )}

      {/* Banner PENDIENTE + materiales de alistamiento */}
      {!puedeOperar && !yaEnviadoSAP && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
            <span className="text-amber-500 text-xl">⏳</span>
            <div>
              <p className="text-amber-800 font-semibold text-sm">Empaque en alistamiento</p>
              <p className="text-amber-700 text-xs mt-0.5">
                El horneado aún no ha finalizado. Puedes consultar los productos y materiales
                a alistar mientras avanza la producción.
              </p>
            </div>
          </div>

          {/* Productos a empacar */}
          {masa.ovs.map(ov => (
            <Card key={ov.doc_num} className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  ov.doc_num === 'SIN_OV' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-800'
                }`}>
                  {ov.doc_num === 'SIN_OV' ? 'Sin OV asignada' : `OV ${ov.doc_num}`}
                </span>
                <span className="text-xs text-gray-400">{ov.productos.length} producto{ov.productos.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {ov.productos.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{p.producto_nombre}</div>
                      <div className="text-xs text-gray-400 font-mono">{p.sap_item_code} · {p.presentacion}</div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-lg font-bold text-gray-800">{p.unidades_programadas}</div>
                      <div className="text-xs text-gray-500">
                        paquetes
                        {p.unidades_por_paquete && p.unidades_por_paquete > 1 && (
                          <span className="text-gray-400 ml-1">
                            · {p.unidades_programadas * p.unidades_por_paquete} panes
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}

          {/* Materiales de empaque a alistar */}
          {masa.materiales_alistamiento && masa.materiales_alistamiento.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">📦 Materiales de empaque a alistar</div>
              <div className="space-y-2">
                {masa.materiales_alistamiento.map(mat => (
                  <div key={mat.item_code} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-700">{mat.nombre}</div>
                      <div className="text-xs text-gray-400 font-mono">{mat.item_code}</div>
                    </div>
                    <div className="text-right shrink-0 ml-3 space-y-0.5">
                      <div className="text-sm font-bold text-gray-800">
                        {mat.cantidad_total % 1 === 0 ? mat.cantidad_total : mat.cantidad_total.toFixed(2)} {mat.uom}
                      </div>
                      <div className={`text-xs font-semibold ${
                        mat.stock_disponible >= mat.cantidad_total ? 'text-green-600' : 'text-red-600'
                      }`}>
                        Stock: {mat.stock_disponible % 1 === 0 ? mat.stock_disponible : mat.stock_disponible.toFixed(2)} {mat.uom}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {msg && msg.tipo === 'ok' && (
        <div className="px-4 py-2 rounded text-sm font-medium bg-green-100 text-green-800 border border-green-200">
          {msg.texto}
        </div>
      )}
      {msg && msg.tipo === 'err' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border-l-4 border-red-500">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-red-500 text-2xl shrink-0">⚠️</span>
              <div>
                <div className="font-bold text-gray-800 mb-1">Error al completar el empaque</div>
                <p className="text-sm text-gray-700 leading-relaxed">{msg.texto}</p>
              </div>
            </div>
            <button
              onClick={() => setMsg(null)}
              className="w-full bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 font-medium text-sm"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-2">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-gray-800">{totalProductos}</div>
          <div className="text-xs text-gray-500">Productos</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-gray-600">{totalProgramadas}</div>
          <div className="text-xs text-gray-400">Pedidas</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-blue-700">{totalDivision || '—'}</div>
          <div className="text-xs text-blue-500">Divididas</div>
        </div>
        <div className="bg-orange-50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-orange-700">{totalHorneadas || '—'}</div>
          <div className="text-xs text-orange-500">Horneadas</div>
        </div>
        <div className={`rounded-lg p-3 text-center ${
          masa.estado_empaque === 'COMPLETADA'
            ? (totalEmpacadas >= totalHorneadas ? 'bg-green-50' : 'bg-amber-50')
            : 'bg-gray-100'
        }`}>
          <div className={`text-xl font-bold ${
            masa.estado_empaque === 'COMPLETADA'
              ? (totalEmpacadas >= totalHorneadas ? 'text-green-700' : 'text-amber-700')
              : 'text-gray-400'
          }`}>
            {masa.estado_empaque === 'COMPLETADA' ? totalEmpacadas : '—'}
          </div>
          <div className={`text-xs ${
            masa.estado_empaque === 'COMPLETADA' ? 'text-green-500' : 'text-gray-400'
          }`}>Empacadas</div>
        </div>
      </div>

      {puedeOperar && !empaque_iniciado && (
        <Card className="p-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Fecha de vencimiento del lote <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              value={fechaVenc}
              onChange={e => setFechaVenc(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={iniciar}
              disabled={saving || !fechaVenc || !puedeOperar || empaque_iniciado}
              className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
            >
              {saving ? 'Iniciando...' : 'Iniciar empaque'}
            </button>
          </div>
        </Card>
      )}

      {/* Fecha de vencimiento editable en modo PENDIENTE (pre-llenado para cuando se habilite) */}
      {!puedeOperar && (
        <Card className="p-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Fecha de vencimiento <span className="text-gray-400 font-normal text-xs">(se guardará al iniciar)</span>
          </label>
          <input
            type="date"
            value={fechaVenc}
            onChange={e => setFechaVenc(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400"
          />
        </Card>
      )}

      {masa.ovs.map(ov => (
        <Card key={ov.doc_num} className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${
              ov.doc_num === 'SIN_OV'
                ? 'bg-gray-100 text-gray-600'
                : 'bg-blue-100 text-blue-800'
            }`}>
              {ov.doc_num === 'SIN_OV' ? 'Sin OV asignada' : `OV ${ov.doc_num}`}
            </span>
            <span className="text-xs text-gray-400">
              {ov.productos.length} producto{ov.productos.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-xs">
                  <th className="text-left p-2 border-b">Producto</th>
                  <th className="text-right p-2 border-b">Pedidas</th>
                  <th className="text-right p-2 border-b">Divididas</th>
                  <th className="text-right p-2 border-b">Horneadas</th>
                  <th className="text-right p-2 border-b">Empacadas</th>
                  <th className="text-right p-2 border-b">Merma</th>
                  <th className="text-right p-2 border-b">Faltante</th>
                  <th className="p-2 border-b"></th>
                </tr>
              </thead>
              <tbody>
                {ov.productos.map(p => {
                  const det = detalles[p.id] ?? { emp: '0', merma: '0' };
                  const empacadas = parseInt(det.emp) || 0;
                  const mermaCalculada = (p.unidades_divididas > 0 ? p.unidades_divididas : p.unidades_horneadas) - empacadas;
                  const faltante = p.unidades_referencia - empacadas;
                  return (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="p-2">
                        <div className="font-medium text-gray-800">{p.producto_nombre}</div>
                        <div className="text-xs text-gray-400 font-mono">
                          {p.sap_item_code} · {p.presentacion}
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono text-gray-500">
                        {p.unidades_programadas}
                      </td>
                      <td className="p-2 text-right">
                        <span className={`font-mono font-medium ${
                          p.division_completada && p.unidades_divididas > 0 ? 'text-blue-700' : 'text-gray-400'
                        }`}>
                          {p.division_completada && p.unidades_divididas > 0 ? p.unidades_divididas : '—'}
                        </span>
                        {!p.division_completada && (
                          <div className="text-xs text-gray-400">Sin división</div>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <span className={`font-mono font-medium ${
                          p.unidades_horneadas > 0 ? 'text-orange-600' : 'text-gray-400'
                        }`}>
                          {p.unidades_horneadas > 0 ? p.unidades_horneadas : '—'}
                        </span>
                      </td>
                      <td className="p-2 text-right">
                        {empaque_iniciado && puedeOperar ? (
                          <input
                            type="number" min="0"
                            value={det.emp}
                            onChange={e => setDetalles(prev => ({
                              ...prev, [p.id]: { ...det, emp: e.target.value }
                            }))}
                            className="w-20 border border-gray-300 rounded px-2 py-1 text-right text-sm focus:ring-1 focus:ring-blue-400"
                          />
                        ) : (
                          <span className="text-gray-400 font-mono">—</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {empaque_iniciado && puedeOperar ? (
                          <span className={`font-mono font-medium text-sm ${mermaCalculada > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                            {mermaCalculada > 0 ? mermaCalculada : 0}
                          </span>
                        ) : (
                          <span className="text-gray-400 font-mono">—</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {empaque_iniciado && puedeOperar ? (
                          <span className={`font-mono text-sm font-bold ${
                            faltante > 0 ? 'text-red-600' : faltante < 0 ? 'text-blue-600' : 'text-green-600'
                          }`}>
                            {faltante > 0 ? `−${faltante}` : faltante < 0 ? `+${Math.abs(faltante)}` : '✓'}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {empaque_iniciado && puedeOperar && (
                            guardadoIds.has(p.id) ? (
                              <button
                                onClick={() => { setGuardadoIds(prev => { const n = new Set(prev); n.delete(p.id); return n; }); }}
                                className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded border border-green-200 font-medium hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-300"
                                title="Guardado — clic para editar de nuevo"
                              >
                                ✓ Guardado
                              </button>
                            ) : (
                              <button
                                onClick={() => guardarDetalle(p.id)}
                                disabled={savingId === p.id}
                                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                {savingId === p.id ? '...' : 'Guardar'}
                              </button>
                            )
                          )}
                          <button
                            onClick={() => verEtiqueta(p.id)}
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
          {/* Materiales de empaque por OV — trazabilidad visual */}
          {(() => {
            const matsOv = (masaActualData?.data?.materiales_alistamiento || masa.materiales_alistamiento)
              .map((mat: any) => {
                // Filtrar solo materiales que corresponden a productos de ESTA OV
                const prodIdsOv = new Set(ov.productos.map((p: any) => p.id));
                if (!mat.por_producto) return null;
                let cantidadOv = 0;
                for (const [prodId, cantPorUnidad] of Object.entries(mat.por_producto)) {
                  if (!prodIdsOv.has(Number(prodId))) continue;
                  const empacadas = parseInt(detalles[Number(prodId)]?.emp || '0') || 0;
                  // Si hay empacadas usar empacadas, si no usar programadas como estimado
                  const unidades = empacadas > 0
                    ? empacadas
                    : ov.productos.find((p: any) => p.id === Number(prodId))?.unidades_programadas || 0;
                  cantidadOv += (cantPorUnidad as number) * unidades;
                }
                if (cantidadOv === 0) return null;
                return { ...mat, cantidad_ov: cantidadOv };
              })
              .filter(Boolean);

            if (!matsOv.length) return null;

            return (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-xs font-semibold text-gray-500 mb-2">
                  📦 Empaque requerido para esta OV
                </div>
                <div className="flex flex-wrap gap-2">
                  {matsOv.map((mat: any) => (
                    <div key={mat.item_code}
                      className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5 text-xs"
                    >
                      <span className="font-medium text-gray-700">{mat.nombre}</span>
                      <span className="text-gray-400 font-mono">{mat.item_code}</span>
                      <span className="font-bold text-blue-700 ml-1">
                        {mat.cantidad_ov % 1 === 0 ? mat.cantidad_ov : mat.cantidad_ov.toFixed(3)} {mat.uom}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>
      ))}

      {/* Panel de materiales de empaque con stock — solo en modo activo */}
      {empaque_iniciado && puedeOperar && masa.materiales_alistamiento.length > 0 && (() => {
        // Calcular consumo real por material usando BOM por producto
        const materialesConConsumo = (masaActualData?.data?.materiales_alistamiento || masa.materiales_alistamiento).map((mat: any) => {
          let consumoReal = 0;
          if (mat.por_producto) {
            // BOM desglosado: sumar cantidad_por_unidad × empacadas por cada producto
            for (const [prodId, cantPorUnidad] of Object.entries(mat.por_producto)) {
              const emp = parseInt(detalles[Number(prodId)]?.emp || '0') || 0;
              consumoReal += (cantPorUnidad as number) * emp;
            }
          } else {
            // Fallback: ratio proporcional sobre total programadas
            const totalProg = masa.ovs.reduce((s: number, ov: any) =>
              s + ov.productos.reduce((ss: number, p: any) => ss + (p.unidades_programadas || 0), 0), 0);
            const totalEmp = masa.ovs.reduce((s: number, ov: any) =>
              s + ov.productos.reduce((ss: number, p: any) => ss + (parseInt(detalles[p.id]?.emp || '0') || 0), 0), 0);
            consumoReal = totalProg > 0 ? (mat.cantidad_total / totalProg) * totalEmp : 0;
          }
          return { ...mat, consumo_real: consumoReal };
        });

        const hayUnidades = materialesConConsumo.some((m: any) => m.consumo_real > 0);

        return (
          <Card className="p-4 border border-blue-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-blue-800">📦 Materiales de empaque — stock disponible</div>
              <button
                onClick={() => api('/config/sync-empaque', { method: 'POST' })
                  .then(() => { refetchMasaActual(); qc.invalidateQueries({ queryKey: ['empaque-pendientes'] }); mostrar('ok', 'Stock sincronizado desde SAP'); })
                  .catch((e: any) => mostrar('err', `Error al sincronizar: ${e.message}`))}
                className="text-xs px-3 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50"
              >
                🔄 Actualizar stock
              </button>
            </div>
            <div className="space-y-2">
              {materialesConConsumo.map((mat: any) => {
                const consumo = mat.consumo_real;
                const sinDato = consumo === 0;
                const stockOk = mat.stock_disponible >= consumo;
                const sinStock = !sinDato && mat.stock_disponible === 0;
                return (
                  <div key={mat.item_code} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm border ${
                    sinDato  ? 'bg-gray-50 border-gray-200' :
                    sinStock ? 'bg-red-50 border-red-200' :
                    !stockOk ? 'bg-yellow-50 border-yellow-200' :
                               'bg-green-50 border-green-100'
                  }`}>
                    <div>
                      <span className="font-medium text-gray-800">{mat.nombre}</span>
                      <span className="text-gray-400 font-mono text-xs ml-2">{mat.item_code}</span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 ml-3 text-xs">
                      <div className="text-right text-gray-600">
                        <div className={`font-semibold ${sinDato ? 'text-gray-400' : 'text-gray-800'}`}>
                          {sinDato ? '—' : (consumo % 1 === 0 ? consumo : consumo.toFixed(3))} {mat.uom}
                        </div>
                        <div>a consumir</div>
                      </div>
                      <div className={`text-right font-semibold ${
                        sinDato ? 'text-gray-400' : sinStock ? 'text-red-700' : !stockOk ? 'text-yellow-700' : 'text-green-700'
                      }`}>
                        <div>
                          {mat.stock_disponible % 1 === 0 ? mat.stock_disponible : mat.stock_disponible.toFixed(3)} {mat.uom}
                        </div>
                        <div className="font-normal">
                          {sinDato ? 'Ingresa unidades' : sinStock ? '⚠ Sin stock' : !stockOk ? '⚠ Stock bajo' : '✓ Stock OK'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!hayUnidades && (
              <p className="text-xs text-gray-400 mt-2">
                Ingresa las unidades empacadas por producto para ver el consumo estimado de cada material.
              </p>
            )}
            {materialesConConsumo.some((m: any) => m.consumo_real > 0 && m.stock_disponible < m.consumo_real) && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700">
                ⚠ Hay materiales con stock insuficiente. SAP rechazará el movimiento al completar. Informa a compras para verificar saldos en almacén ALEMP.
              </div>
            )}
          </Card>
        );
      })()}

      {empaque_iniciado && puedeOperar && (
        <div className="flex justify-end">
          <button
            onClick={() => handleCompletar()}
            disabled={saving || yaEnviadoSAP}
            className="bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            {saving ? 'Completando...' : yaEnviadoSAP ? 'Empaque enviado a SAP ✓' : 'Completar empaque'}
          </button>
        </div>
      )}

      {modalMO && (
        <ModalMO
          masaId={masa.id}
          fase="EMPAQUE"
          tiposMO={tiposMO}
          onClose={() => setModalMO(false)}
          onSave={() => {}}
        />
      )}
      {modalFaltantes && (
        <ModalFaltantes
          faltantes={modalFaltantes.faltantes}
          onConfirmar={(obs) => { setModalFaltantes(null); handleCompletar(obs); }}
          onCancelar={() => setModalFaltantes(null)}
        />
      )}
      {etiquetaData && (
        <Etiqueta data={etiquetaData} onClose={() => setEtiquetaData(null)} />
      )}

      <div className="pt-2 border-t border-gray-100">
        <button onClick={onVolver} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium">
          ← Volver a la lista
        </button>
      </div>
    </div>
  );
};

// ── Tipos para resumen variedad ──────────────────────────────────────────────
interface MaterialResumen {
  item_code: string;
  nombre: string;
  cantidad_por_unidad: number;
  uom: string;
  cantidad_total: number;
}
interface ProductoResumen {
  sap_item_code: string;
  producto_nombre: string;
  gramaje_unitario: number;
  unidades_por_paquete: number;
  unidades_pan_por_paquete: number;
  total_unidades: number;
  total_paquetes: number;
  cant_masas: number;
  tipos_masa: string;
  tiene_pendiente: boolean;
  tiene_en_progreso: boolean;
  materiales: MaterialResumen[];
}
interface ResumenVariedad {
  fecha: string;
  total_skus: number;
  total_unidades: number;
  total_paquetes: number;
  productos: ProductoResumen[];
}

// ── Panel: resumen por variedad para bodega ──────────────────────────────────
const PanelResumenVariedad: React.FC<{ fecha: string }> = ({ fecha }) => {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [filtroBusqueda, setFiltroBusqueda] = useState('');

  const toggleItem = (key: string) =>
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const expandirTodo = (productos: ProductoResumen[]) =>
    setExpandidos(new Set(productos.filter(p => p.materiales.length > 0).map(p => p.sap_item_code || p.producto_nombre)));

  const contraerTodo = () => setExpandidos(new Set());

  const todosExpandidos = (productos: ProductoResumen[]) =>
    productos.filter(p => p.materiales.length > 0).every(p => expandidos.has(p.sap_item_code || p.producto_nombre));

  const { data, isLoading, error } = useQuery<{ data: ResumenVariedad }>({
    queryKey: ['empaque-resumen-variedad', fecha],
    queryFn: () => api(`/empaque/resumen-variedad?fecha=${fecha}`),
    refetchInterval: 60000,
  });

  const resumen = data?.data;

  const handleImprimir = () => window.print();

  const estiloImpresion = `
    @media screen {
      .solo-impresion { display: none !important; }
    }
    @media print {
      @page { margin: 15mm; size: A4; }
      nav, header, aside, footer, .no-print { display: none !important; }
      .solo-impresion { display: block !important; }
      .solo-pantalla { display: none !important; }
      body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  if (isLoading) return (
    <div className="text-center py-10 text-gray-400 text-sm">Cargando resumen...</div>
  );
  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
      Error al cargar el resumen de variedades.
    </div>
  );
  if (!resumen || resumen.productos.length === 0) return (
    <div className="text-center py-10 text-gray-400 text-sm">
      No hay masas con empaque activo para la fecha seleccionada.
    </div>
  );

  const productosFiltrados = resumen.productos.filter(p =>
    !filtroBusqueda ||
    p.producto_nombre.toLowerCase().includes(filtroBusqueda.toLowerCase()) ||
    p.sap_item_code?.toLowerCase().includes(filtroBusqueda.toLowerCase())
  );

  // Expandidos al tope, resto debajo — así la impresión prioriza los seleccionados
  const expandidosArr = productosFiltrados.filter(p => expandidos.has(p.sap_item_code || p.producto_nombre));
  const noExpandidosArr = productosFiltrados.filter(p => !expandidos.has(p.sap_item_code || p.producto_nombre));
  const productosOrdenados = [...expandidosArr, ...noExpandidosArr];

  const hayConMateriales = productosFiltrados.some(p => p.materiales.length > 0);

  return (
    <>
      <style>{estiloImpresion}</style>
      <div id="empaque-resumen-print" className="space-y-4">

        {/* Cabecera — visible en pantalla e impresión */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-700">{resumen.total_skus}</div>
            <div className="text-xs text-blue-500">Variedades</div>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-700">{Math.ceil(resumen.total_paquetes).toLocaleString()}</div>
            <div className="text-xs text-green-500">Unidades totales</div>
          </div>
          <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-700">{resumen.total_unidades.toLocaleString()}</div>
            <div className="text-xs text-purple-500">Paquetes totales</div>
          </div>
        </div>

        {/* Controles — se ocultan al imprimir */}
        <div className="no-print flex gap-2 flex-wrap">
          <input
            type="text"
            value={filtroBusqueda}
            onChange={e => setFiltroBusqueda(e.target.value)}
            placeholder="Buscar variedad o código..."
            className="flex-1 min-w-48 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400"
          />
          {hayConMateriales && (
            todosExpandidos(productosFiltrados) ? (
              <button
                onClick={contraerTodo}
                className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
              >
                ▲ Contraer todo
              </button>
            ) : (
              <button
                onClick={() => expandirTodo(productosFiltrados)}
                className="px-4 py-2 border border-blue-300 text-blue-600 rounded text-sm hover:bg-blue-50"
              >
                ▼ Expandir todo
              </button>
            )
          )}
          <button
            onClick={handleImprimir}
            className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1"
          >
            🖨 Imprimir
          </button>
        </div>

        {/* ── LISTA SOLO PARA IMPRESIÓN ── */}
        <div id="lista-impresion" className="solo-impresion">
          {/* Encabezado del documento */}
          <div style={{ borderBottom: '2px solid #000', paddingBottom: '8px', marginBottom: '16px' }}>
            <div style={{ fontSize: '16pt', fontWeight: 'bold' }}>La Artesa SAS — Solicitud de Materiales de Empaque</div>
            <div style={{ fontSize: '10pt', color: '#555', marginTop: '4px' }}>
              Fecha de producción: <strong>{fecha}</strong>
              &nbsp;·&nbsp;
              {expandidos.size > 0
                ? `${expandidos.size} variedad${expandidos.size > 1 ? 'es' : ''} seleccionadas con materiales`
                : 'Lista completa de variedades'}
              &nbsp;·&nbsp;
              Total: {resumen.total_unidades.toLocaleString()} unidades · {Math.ceil(resumen.total_paquetes).toLocaleString()} paquetes
            </div>
          </div>

          {/* Primero los expandidos, luego el resto */}
          {productosOrdenados.map((p, idx) => {
            const key = p.sap_item_code || p.producto_nombre;
            const abierto = expandidos.has(key);
            return (
              <div key={key} style={{
                marginBottom: '12px',
                pageBreakInside: 'avoid',
                borderLeft: abierto ? '3px solid #3b82f6' : '3px solid #e5e7eb',
                paddingLeft: '10px',
              }}>
                {/* Fila del producto */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: abierto ? '6px' : '0' }}>
                  {/* Checkbox de entrega */}
                  <div style={{
                    width: '16px', height: '16px', border: '1.5px solid #555',
                    borderRadius: '3px', flexShrink: 0, marginTop: '2px',
                  }} />
                  {/* Datos del producto */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '11pt' }}>
                      {String(idx + 1).padStart(2, '0')}. {p.producto_nombre}
                    </div>
                    <div style={{ fontSize: '9pt', color: '#555' }}>
                      {p.sap_item_code}
                      {p.gramaje_unitario > 0 && ` · ${p.gramaje_unitario}g/und`}
                    </div>
                  </div>
                  {/* Cantidades */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '12pt' }}>
                      {p.total_unidades.toLocaleString()} und
                    </div>
                    <div style={{ fontSize: '9pt', color: '#555' }}>
                      {Math.ceil(p.total_paquetes)} paquetes
                    </div>
                  </div>
                </div>

                {/* Materiales — solo si estaba expandido */}
                {abierto && p.materiales.length > 0 && (
                  <div style={{ marginLeft: '24px', marginTop: '4px' }}>
                    <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#1d4ed8', marginBottom: '4px' }}>
                      Materiales a entregar:
                    </div>
                    {p.materiales.map(m => (
                      <div key={m.item_code} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        marginBottom: '3px', fontSize: '10pt',
                      }}>
                        {/* Checkbox de material */}
                        <div style={{
                          width: '13px', height: '13px', border: '1.5px solid #555',
                          borderRadius: '2px', flexShrink: 0,
                        }} />
                        <div style={{ flex: 1 }}>
                          {m.nombre}
                          <span style={{ color: '#888', fontSize: '9pt', marginLeft: '6px' }}>
                            {m.item_code}
                          </span>
                        </div>
                        <div style={{ fontWeight: 'bold', color: '#1d4ed8', flexShrink: 0 }}>
                          {m.cantidad_total.toLocaleString()} {m.uom}
                        </div>
                        {/* Línea para firma/cantidad real entregada */}
                        <div style={{ flexShrink: 0, fontSize: '9pt', color: '#555' }}>
                          Entregado: <span style={{
                            display: 'inline-block', width: '50px',
                            borderBottom: '1px solid #555', marginLeft: '4px',
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pie de firma */}
          <div style={{ marginTop: '32px', borderTop: '1px solid #ccc', paddingTop: '16px', display: 'flex', gap: '60px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #000', marginBottom: '4px', height: '32px' }} />
              <div style={{ fontSize: '9pt', color: '#555' }}>Firma Almacén / Entregó</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: '1px solid #000', marginBottom: '4px', height: '32px' }} />
              <div style={{ fontSize: '9pt', color: '#555' }}>Firma Empaque / Recibió</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '9pt', color: '#555', marginBottom: '4px' }}>Fecha y hora de entrega:</div>
              <div style={{ borderBottom: '1px solid #000', height: '32px' }} />
            </div>
          </div>
        </div>

        {/* ── TABLA SOLO PARA PANTALLA ── */}
        <div id="tabla-pantalla" className="solo-pantalla border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs border-b border-gray-200">
                <th className="text-left p-3">Variedad / SKU</th>
                <th className="text-right p-3">Unidades</th>
                <th className="text-right p-3">Paquetes</th>
                <th className="text-right p-3">Gramaje</th>
                <th className="text-center p-3 no-print">Estado</th>
                <th className="text-center p-3 no-print">Materiales</th>
              </tr>
            </thead>
            <tbody>
              {productosOrdenados.map(p => {
                const key = p.sap_item_code || p.producto_nombre;
                const abierto = expandidos.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                        abierto ? 'bg-blue-50 font-medium' : ''
                      }`}
                      onClick={() => toggleItem(key)}
                    >
                      <td className="p-3">
                        <div className="font-medium text-gray-800">{p.producto_nombre}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.sap_item_code}</div>
                        <div className="text-xs text-gray-400 no-print">{p.tipos_masa}</div>
                      </td>
                      <td className="p-3 text-right">
                        <span className="font-bold text-gray-800 text-base">{p.total_unidades.toLocaleString()}</span>
                      </td>
                      <td className="p-3 text-right">
                        <span className="font-semibold text-purple-700">{Math.ceil(p.total_paquetes)}</span>
                        {p.unidades_pan_por_paquete > 1 && (
                          <div className="text-xs text-gray-400">x{p.unidades_pan_por_paquete} und/paq</div>
                        )}
                      </td>
                      <td className="p-3 text-right text-xs text-gray-500">
                        {p.gramaje_unitario > 0 ? `${p.gramaje_unitario}g` : '—'}
                      </td>
                      <td className="p-3 text-center no-print">
                        <div className="flex flex-col gap-1 items-center">
                          {p.tiene_en_progreso && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">En empaque</span>
                          )}
                          {p.tiene_pendiente && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Alistamiento</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center text-xs text-gray-500 no-print">
                        {p.materiales.length > 0
                          ? <span className="text-blue-600 font-medium">{p.materiales.length} mat. {abierto ? '▲' : '▼'}</span>
                          : '—'}
                      </td>
                    </tr>
                    {/* Fila de materiales: visible si expandido en pantalla, siempre visible en impresión si estaba expandido */}
                    {abierto && p.materiales.length > 0 && (
                      <tr className="bg-blue-50 border-b border-blue-100 print-expandido">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="text-xs font-semibold text-blue-700 mb-2">📦 Materiales de empaque</div>
                          <div className="grid grid-cols-1 gap-1">
                            {p.materiales.map(m => (
                              <div key={m.item_code} className="flex items-center justify-between bg-white rounded px-3 py-1.5 border border-blue-100 text-xs">
                                <div>
                                  <span className="font-medium text-gray-700">{m.nombre}</span>
                                  <span className="text-gray-400 font-mono ml-2">{m.item_code}</span>
                                </div>
                                <div className="flex items-center gap-4 text-gray-600">
                                  <span className="no-print">{m.cantidad_por_unidad} {m.uom}/unidad</span>
                                  <span className="font-bold text-blue-700">{m.cantidad_total.toLocaleString()} {m.uom} total</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>{/* cierre tabla-pantalla */}

        <p className="text-xs text-gray-400 text-center no-print">
          Incluye masas con EMPAQUE en alistamiento anticipado y en progreso · {fecha}
          {expandidos.size > 0 && (
            <span className="ml-2 text-blue-500">· {expandidos.size} variedad{expandidos.size > 1 ? 'es' : ''} con materiales visibles — aparecerán primeras al imprimir</span>
          )}
        </p>
      </div>
    </>
  );
};

// ── Componente principal ─────────────────────────────────────────────────────
export const EmpaqueMasa: React.FC = () => {
  const qc = useQueryClient();
  const { masaId: masaIdParam } = useParams<{ masaId?: string }>();

  const [modo, setModo] = useState<'lista' | 'masa' | 'ov' | 'resumen'>('lista');
  const [fechaLista, setFechaLista] = useState(new Date().toISOString().slice(0, 10));
  const [fechaResumen, setFechaResumen] = useState(new Date().toISOString().slice(0, 10));
  const [masaSeleccionada, setMasaSeleccionada] = useState<MasaPendiente | null>(null);

  // Búsqueda por OV (modo legado)
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

  const { data: pendientesData, isLoading: loadingPendientes, refetch: refetchPendientes } =
    useQuery<{ data: MasaPendiente[] }>({
      queryKey: ['empaque-pendientes', fechaLista],
      queryFn: () => api(`/empaque/pendientes?fecha=${fechaLista}`),
      refetchInterval: 30000,
    });
  const masasPendientes = pendientesData?.data || [];

  // ID objetivo: URL param o sessionStorage
  const targetMasaId = masaIdParam || sessionStorage.getItem('artesa_masa_activa') || null;

  // Fetch directo por masaId cuando hay contexto — independiente de fecha y lista
  const { data: directMasaData } = useQuery({
    queryKey: ['empaque-direct', targetMasaId],
    queryFn: () => api(`/empaque/${targetMasaId}`),
    enabled: !!targetMasaId && !masaSeleccionada,
  });

  useEffect(() => {
    if (!directMasaData?.data || masaSeleccionada) return;
    const m = directMasaData.data.masa;
    const registro = directMasaData.data.registro_empaque;
    const productos = directMasaData.data.productos || [];

    // Construir MasaPendiente compatible desde getEmpaqueInfo
    const ovsMap: Record<string, any[]> = {};
    for (const p of productos) {
      const ov = p.sap_doc_num || 'SIN_OV';
      if (!ovsMap[ov]) ovsMap[ov] = [];
      const xSAP = parseFloat(String(p.unidades_por_paquete || 0));
      const xNombre = p.producto_nombre?.match(/ X ?(\d+)/i);
      const xPaq = xSAP > 1 ? xSAP : (xNombre ? parseInt(xNombre[1]) : 1);
      // Paquetes programados = unidades_programadas (ya incluye delta)
      const paquetesProgramados = p.unidades_programadas || 0;
      // Panes: para referencia interna en fases de división/horneado
      const panesDivididos = p.division_completada && (p.cantidad_divisiones || 0) > 0
        ? parseInt(p.cantidad_divisiones)
        : 0;
      const panesHorneados = p.unidades_terminadas_horneado
        ?? (p.unidades_producidas > 0 ? p.unidades_producidas : 0);
      const panesReferencia = panesHorneados || panesDivididos || (paquetesProgramados * xPaq);
      ovsMap[ov].push({
        id: p.id,
        sap_item_code: p.sap_item_code,
        producto_nombre: p.producto_nombre,
        presentacion: p.presentacion,
        gramaje_unitario: p.gramaje_unitario,
        unidades_programadas: paquetesProgramados,
        unidades_divididas: panesDivididos,
        unidades_horneadas: panesHorneados,
        unidades_referencia: panesReferencia,
        division_completada: p.division_completada || false,
        unidades_producidas: p.unidades_producidas || 0,
        unidades_por_paquete: p.unidades_por_paquete || null,
        sap_doc_num: p.sap_doc_num || null,
        sap_doc_entry: p.sap_doc_entry || null,
      });
    }
    const ovs: { doc_num: string; productos: any[] }[] = Object.entries(ovsMap).map(
      ([doc_num, prods]) => ({ doc_num, productos: prods })
    );

    // Horneado completado + empaque BLOQUEADA/PENDIENTE → forzar EN_PROGRESO para que puedeOperar=true
    const estadoEmpaqueEfectivo = m.estado_empaque === 'COMPLETADA'
      ? 'COMPLETADA'
      : 'EN_PROGRESO';

    const masaCompatible: MasaPendiente = {
      id: m.id,
      codigo_masa: m.codigo_masa,
      nombre_masa: m.nombre_masa,
      tipo_masa: m.tipo_masa,
      total_kilos_con_merma: parseFloat(String(m.total_kilos_con_merma)) || 0,
      fecha_produccion: m.fecha_produccion?.slice(0, 10) || '',
      es_subdivision: false,
      estado_empaque: estadoEmpaqueEfectivo,
      estado_horneado: 'COMPLETADA',
      horneado_completo: true,
      lote_produccion: m.lote_produccion || null,
      empaque_iniciado: registro != null,
      empaque_id: registro?.id || null,
      fecha_vencimiento: registro?.fecha_vencimiento
        || (m.empaque_datos_fase as any)?.fecha_vencimiento_sugerida
        || m.fecha_vencimiento_sugerida
        || null,
      materiales_alistamiento: directMasaData?.data?.materiales_alistamiento || [],
      ovs,
    };

    setMasaSeleccionada(masaCompatible);
    setModo('masa');
  }, [directMasaData]);

  const { data: ovData, isLoading: loadingOV, error: ovError } = useQuery<{ data: OVData[] }>({
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
      mostrarMsg('ok', 'Empaque iniciado');
    },
    onError: (e: any) => mostrarMsg('err', e.message),
  });

  const guardarDetalleOV = async (masaId: number, productoId: number) => {
    const vals = detallesEdit[productoId];
    if (!vals) return;
    setSavingEmpaque(productoId);
    try {
      await api(`/empaque/${masaId}/detalle/${productoId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          unidades_empacadas: parseInt(vals.emp) || 0,
          unidades_merma: (() => {
            const prod = ov?.productos?.find((p: any) => p.id === productoId);
            const emp = parseInt(vals.emp) || 0;
            const base = prod ? (prod.unidades_divididas > 0 ? prod.unidades_divididas : prod.unidades_horneadas) : 0;
            return Math.max(0, base - emp);
          })(),
        }),
      });
      qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
      mostrarMsg('ok', 'Guardado');
    } catch (e: any) { mostrarMsg('err', e.message); }
    finally { setSavingEmpaque(null); }
  };

  const completarMut = useMutation({
    mutationFn: (masaId: number) => api(`/empaque/${masaId}/completar`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
      const c = data.data?.costos;
      if (c) mostrarMsg('ok', `Completado — Costo total: $${COP(c.total)} | $/ud: $${COP(c.unitario)}`);
    },
    onError: (e: any) => {
      // 409 = entrada ya enviada a SAP — bloquear sin mensaje de error genérico
      if (e?.status === 409 && e?.data?.already_sent) {
        mostrarMsg('err', `⚠ Entrada de mercancía ya registrada en SAP (DocNum ${e.data.sap_doc_num_entrada}). No se puede enviar de nuevo.`);
        qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
        return;
      }
      mostrarMsg('err', e.message);
    },
  });

  const verEtiquetaOV = async (masaId: number, productoId: number) => {
    try {
      const d = await api(`/empaque/${masaId}/etiqueta/${productoId}`);
      setEtiquetaData(d.data);
    } catch (e: any) { mostrarMsg('err', e.message); }
  };

  // ── Render: formulario de masa seleccionada ──
  if (modo === 'masa' && masaSeleccionada) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-5 text-gray-800">Empaque</h1>
        <PanelEmpaqueMasa
          masa={masaSeleccionada}
          tiposMO={tiposMO}
          onVolver={() => { setModo('lista'); setMasaSeleccionada(null); }}
          onCompletado={() => { refetchPendientes(); }}
        />
      </div>
    );
  }

  // ── Render: vista principal (lista + búsqueda OV) ──
  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-5 text-gray-800">Empaque</h1>

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        <button
          onClick={() => setModo('lista')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            modo === 'lista'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Masas listas para empacar
          {masasPendientes.length > 0 && (
            <span className="ml-2 bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5">
              {masasPendientes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setModo('ov')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            modo === 'ov'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Buscar por OV
        </button>
        <button
          onClick={() => setModo('resumen')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            modo === 'resumen'
              ? 'border-purple-600 text-purple-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📦 Resumen por variedad
        </button>
      </div>

      {/* Tab: lista de masas pendientes */}
      {modo === 'lista' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-medium text-gray-700">Fecha de producción:</label>
            <input
              type="date"
              value={fechaLista}
              onChange={e => setFechaLista(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
            />
          </div>
          {loadingPendientes ? (
            <div className="text-center py-10 text-gray-400 text-sm">Cargando masas...</div>
          ) : (
            <PanelPendientes
              masas={masasPendientes}
              onSeleccionar={(masa) => { setMasaSeleccionada(masa); setModo('masa'); }}
            />
          )}
        </div>
      )}

      {/* Tab: resumen por variedad para bodega */}
      {modo === 'resumen' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-medium text-gray-700">Fecha de producción:</label>
            <input
              type="date"
              value={fechaResumen}
              onChange={e => setFechaResumen(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <PanelResumenVariedad fecha={fechaResumen} />
        </div>
      )}

      {/* Tab: búsqueda por OV (flujo original) */}
      {modo === 'ov' && (
        <div>
          {msg && (
            <div className={`mb-4 px-4 py-2 rounded text-sm font-medium ${
              msg.tipo === 'ok'
                ? 'bg-green-100 text-green-800 border border-green-200'
                : 'bg-red-100 text-red-800 border border-red-200'
            }`}>{msg.texto}</div>
          )}

          <Card className="mb-6 p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Número de Orden de Venta SAP
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

          {loadingOV && <p className="text-gray-500 text-sm">Buscando OV {docNumBuscar}...</p>}
          {ovError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
              No se encontró la OV <strong>{docNumBuscar}</strong>. Verifique el número.
            </div>
          )}

          {ov && (
            <div className="space-y-6">
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

              {ov.todas_horneadas && (
                <Card className="p-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Fecha de vencimiento del lote
                  </label>
                  <input
                    type="date"
                    value={fechaVenc}
                    onChange={e => setFechaVenc(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400"
                  />
                </Card>
              )}

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
                            disabled={completarMut.isPending || !!sm.sap_doc_entry_entrada}
                            className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            title={sm.sap_doc_entry_entrada ? `Entrada SAP ya registrada (DocEntry ${sm.sap_doc_entry_entrada})` : undefined}
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
                            const empacadasEdit = parseInt(edit.emp) || 0;
                            const mermaCalculadaOV = (p.unidades_divididas > 0 ? p.unidades_divididas : p.unidades_horneadas) - empacadasEdit;
                            const faltantes = p.unidades_ajustadas - empacadasEdit;
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
                                    <span className={`font-mono font-medium text-sm ${mermaCalculadaOV > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                      {mermaCalculadaOV > 0 ? mermaCalculadaOV : 0}
                                    </span>
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
                                        onClick={() => guardarDetalleOV(p.masa_id, p.id)}
                                        disabled={savingEmpaque === p.id}
                                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        {savingEmpaque === p.id ? '...' : 'Guardar'}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => verEtiquetaOV(p.masa_id, p.id)}
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
                          <td className="p-2 text-right text-xs">
                            ${COP(parseFloat(m.precio_unitario.toString()))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    onClick={() => api('/config/sync-empaque', { method: 'POST' })
                      .then(() => {
                        qc.invalidateQueries({ queryKey: ['empaque-ov', docNumBuscar] });
                        mostrarMsg('ok', 'Precios sincronizados desde SAP');
                      })
                      .catch((e: any) => mostrarMsg('err', e.message))}
                    className="mt-3 text-xs px-3 py-1.5 border border-blue-300 text-blue-600 rounded hover:bg-blue-50"
                  >
                    Sincronizar precios desde SAP
                  </button>
                </Card>
              )}

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
      )}
    </div>
  );
};

export default EmpaqueMasa;
