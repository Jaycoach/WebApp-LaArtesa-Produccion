/**
 * EmpaqueMasa.tsx
 * Módulo de EMPAQUE — ARTESA
 * 2026-03-02
 *
 * Funcionalidades:
 * 1. Registrar fecha de vencimiento (lote ya viene de pesaje)
 * 2. Tabla de productos con OV SAP de origen
 * 3. Ingresar unidades empacadas / merma por producto
 * 4. Generar etiquetas imprimibles con código de barras (simulado)
 * 5. Completar empaque
 */
import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ─────────────────────────────────────────────
const getToken = () => {
  try {
    const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return auth?.state?.token || auth?.state?.accessToken || '';
  } catch { return ''; }
};

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${getToken()}`
});

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────
interface ProductoEmpaque {
  id: number;
  sap_item_code: string;
  producto_nombre: string;
  presentacion: string;
  gramaje_unitario: number;
  unidades_pedidas: number;
  unidades_ajustadas: number;
  unidades_producidas: number;
  unidades_excedente: number;
  sap_doc_entry: number | null;
  sap_doc_num: string | null;
  unidades_por_paquete: number;
  cantidad_paquetes: number;
  // Si ya hay empaque iniciado
  empaque_detalle_id?: number;
  unidades_empacadas?: number;
  unidades_merma?: number;
}

interface EmpaqueData {
  masa: {
    id: number;
    codigo: string;
    tipo: string;
    nombre: string;
    lote_produccion: string;
    fecha_produccion: string;
  };
  productos: ProductoEmpaque[];
  registro_empaque: {
    id: number;
    fecha_vencimiento: string;
    estado: string;
  } | null;
}

// ─────────────────────────────────────────────
// Barcode visual simple (CSS) para impresión
// ─────────────────────────────────────────────
const BarcodeDisplay: React.FC<{ code: string }> = ({ code }) => {
  const bars = code.split('').map((c, i) => {
    const n = parseInt(c) || 0;
    return { width: 1 + (n % 3), isBlack: (n + i) % 3 !== 2 };
  });
  return (
    <div className="flex items-end gap-0" style={{ height: 40 }}>
      <div style={{ width: 1, height: 40, background: '#000' }} />
      <div style={{ width: 1, height: 40, background: '#fff' }} />
      <div style={{ width: 1, height: 40, background: '#000' }} />
      {bars.map((b, i) => (
        <div key={i} style={{ width: b.width, height: b.isBlack ? 36 : 28, background: b.isBlack ? '#000' : '#fff', alignSelf: 'flex-end' }} />
      ))}
      <div style={{ width: 1, height: 40, background: '#000' }} />
      <div style={{ width: 1, height: 40, background: '#fff' }} />
      <div style={{ width: 1, height: 40, background: '#000' }} />
    </div>
  );
};

// ─────────────────────────────────────────────
// Modal de Etiqueta
// ─────────────────────────────────────────────
const ModalEtiqueta: React.FC<{
  producto: ProductoEmpaque;
  lote: string;
  fechaVencimiento: string;
  onClose: () => void;
}> = ({ producto, lote, fechaVencimiento, onClose }) => {
  const etiquetaRef = useRef<HTMLDivElement>(null);

  const formatFecha = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const gramaje = Math.round(producto.gramaje_unitario);
  const itemSuffix = producto.sap_item_code.replace(/\D/g, '').slice(-4).padStart(4, '0');
  const eanBase = `7709898${itemSuffix}${gramaje.toString().padStart(3, '0')}`;
  const ean = eanBase.slice(0, 12);

  const imprimirEtiqueta = () => {
    const contenido = etiquetaRef.current?.innerHTML;
    if (!contenido) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Etiqueta - ${producto.producto_nombre}</title>
          <style>
            body { margin: 0; padding: 10px; font-family: Arial, sans-serif; }
            @media print { body { margin: 0; } @page { size: 60mm 40mm; margin: 2mm; } }
          </style>
        </head>
        <body onload="window.print(); window.close();">${contenido}</body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-auto max-h-screen" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-900">Etiqueta de Producto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Preview etiqueta */}
          <div className="flex justify-center">
            <div ref={etiquetaRef} style={{ width: '250px', border: '2px solid #1a1a1a', borderRadius: '8px', padding: '10px', fontFamily: 'Arial, sans-serif', background: '#fff' }}>
              <div style={{ textAlign: 'center', borderBottom: '1px solid #eee', paddingBottom: '6px', marginBottom: '6px' }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#8B4513', letterSpacing: '2px' }}>LA ARTESA</div>
                <div style={{ fontSize: '8px', color: '#666', letterSpacing: '1px' }}>PANADERÍA ARTESANAL</div>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '4px', lineHeight: '1.2' }}>
                {producto.producto_nombre}
              </div>
              <div style={{ fontSize: '9px', color: '#555', marginBottom: '6px' }}>
                {producto.presentacion} | {producto.gramaje_unitario}g
              </div>
              <div style={{ background: '#f5f0e4', borderRadius: '4px', padding: '4px 6px', marginBottom: '6px' }}>
                <div style={{ fontSize: '8px', color: '#666', marginBottom: '2px' }}>
                  <span style={{ fontWeight: 'bold' }}>LOTE:</span> {lote}
                </div>
                <div style={{ fontSize: '8px', color: '#666' }}>
                  <span style={{ fontWeight: 'bold' }}>VENCE:</span> {formatFecha(fechaVencimiento)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                <BarcodeDisplay code={ean} />
                <div style={{ fontSize: '8px', color: '#333', letterSpacing: '2px' }}>{ean}</div>
              </div>
            </div>
          </div>

          {/* Info del código */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <p><strong>Código EAN (simulado):</strong> {ean}</p>
            <p className="text-xs text-gray-400 mt-1">Nota: El dígito verificador se calcula en producción con librería real.</p>
          </div>

          {/* Acciones */}
          <div className="flex gap-3">
            <button
              onClick={imprimirEtiqueta}
              className="flex-1 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              🖨️ Imprimir Etiqueta
            </button>
            <button onClick={onClose} className="px-6 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Componente Principal
// ─────────────────────────────────────────────
export const EmpaqueMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [etiquetaProducto, setEtiquetaProducto] = useState<ProductoEmpaque | null>(null);

  // Estado local de unidades por producto (key = producto.id)
  const [unidadesMap, setUnidadesMap] = useState<Record<number, { empacadas: string; merma: string }>>({});

  const { data, isLoading, error } = useQuery<EmpaqueData>({
    queryKey: ['empaque', masaId],
    queryFn: async () => {
      const res = await fetch(`/api/empaque/${masaId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || 'Error al cargar empaque');
      return d.data;
    },
    enabled: !!masaId,
  });

  // Inicializar map cuando cargan los datos
  React.useEffect(() => {
    if (!data?.productos) return;
    const inicial: Record<number, { empacadas: string; merma: string }> = {};
    data.productos.forEach(p => {
      inicial[p.id] = {
        empacadas: String(p.unidades_empacadas ?? p.unidades_ajustadas ?? p.unidades_pedidas ?? 0),
        merma: String(p.unidades_merma ?? 0),
      };
    });
    setUnidadesMap(inicial);
    if (data.registro_empaque?.fecha_vencimiento) {
      setFechaVencimiento(data.registro_empaque.fecha_vencimiento.slice(0, 10));
    }
  }, [data]);

  const iniciarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/empaque/${masaId}/iniciar`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ fecha_vencimiento: fechaVencimiento, observaciones })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['empaque', masaId] });
      setErrorMsg('');
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const actualizarDetalleMutation = useMutation({
    mutationFn: async ({ productoId, empacadas, merma }: { productoId: number; empacadas: number; merma: number }) => {
      const res = await fetch(`/api/empaque/${masaId}/detalle/${productoId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ unidades_empacadas: empacadas, unidades_merma: merma })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message);
      return d;
    },
    onError: (e: any) => setErrorMsg(e.message)
  });

  const completarMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/empaque/${masaId}/completar`, {
        method: 'POST',
        headers: authHeaders(),
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

  const guardarDetalle = (productoId: number) => {
    const vals = unidadesMap[productoId];
    if (!vals) return;
    actualizarDetalleMutation.mutate({
      productoId,
      empacadas: parseInt(vals.empacadas) || 0,
      merma: parseInt(vals.merma) || 0,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{(error as any)?.message || 'Error al cargar datos de empaque'}</p>
        </div>
      </div>
    );
  }

  const { masa, productos, registro_empaque } = data;
  const empaqueIniciado = !!registro_empaque;
  const empaqueCompletado = registro_empaque?.estado === 'COMPLETADO';
  const lote = masa.lote_produccion || masa.codigo;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">📦</span>
                <h1 className="text-2xl font-bold text-gray-900">Empaque</h1>
                <span className="px-2 py-1 bg-amber-100 text-amber-700 text-sm rounded-full font-medium">{masa.tipo}</span>
              </div>
              <p className="text-gray-500 text-sm">{masa.codigo} — {masa.nombre}</p>
              <p className="text-gray-400 text-xs mt-0.5">Lote: <strong className="text-gray-600">{lote}</strong></p>
            </div>
            <button onClick={() => navigate(`/planificacion/masas/${masaId}`)} className="text-sm text-gray-500 hover:text-gray-800">
              ← Volver
            </button>
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">⚠️ {errorMsg}</p>
          </div>
        )}

        {/* Empaque completado */}
        {empaqueCompletado && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">✅</span>
              <div>
                <h2 className="text-lg font-semibold text-green-800">Empaque completado</h2>
                <p className="text-green-600 text-sm">Producción finalizada y empacada exitosamente.</p>
              </div>
            </div>
            <button onClick={() => navigate(`/planificacion/masas/${masaId}`)} className="bg-green-700 hover:bg-green-800 text-white font-semibold px-6 py-2 rounded-lg transition-colors">
              Ver detalle de masa →
            </button>
          </div>
        )}

        {/* Formulario inicio de empaque */}
        {!empaqueIniciado && !empaqueCompletado && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Iniciar Empaque</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha de vencimiento <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={e => setFechaVencimiento(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones</label>
              <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
            </div>
            <button
              onClick={() => iniciarMutation.mutate()}
              disabled={iniciarMutation.isPending || !fechaVencimiento}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {iniciarMutation.isPending ? 'Iniciando...' : '📦 Iniciar Empaque'}
            </button>
          </div>
        )}

        {/* Tabla de productos — visible cuando empaque está iniciado */}
        {empaqueIniciado && !empaqueCompletado && (
          <>
            {/* Info del empaque */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></div>
              <div className="text-sm">
                <span className="font-medium text-amber-800">Empaque en progreso</span>
                <span className="text-amber-600 ml-2">
                  Vence: <strong>{new Date(registro_empaque!.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CO')}</strong>
                </span>
              </div>
            </div>

            {/* Tabla de productos */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-800">Productos a empacar</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium">Producto</th>
                      <th className="text-center px-3 py-3 text-gray-500 font-medium">Pedido</th>
                      <th className="text-center px-3 py-3 text-gray-500 font-medium">Ajustado</th>
                      <th className="text-center px-3 py-3 text-gray-500 font-medium">Paquetes</th>
                      <th className="text-center px-3 py-3 text-gray-500 font-medium">Empacadas</th>
                      <th className="text-center px-3 py-3 text-gray-500 font-medium">Merma</th>
                      <th className="text-center px-3 py-3 text-gray-500 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((p) => {
                      const vals = unidadesMap[p.id] || { empacadas: '0', merma: '0' };
                      return (
                        <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800">{p.producto_nombre}</div>
                            <div className="text-xs text-gray-400">
                              {p.sap_item_code} · {p.gramaje_unitario}g
                              {p.sap_doc_num && <span className="ml-1 text-blue-400">OV#{p.sap_doc_num}</span>}
                            </div>
                          </td>
                          <td className="text-center px-3 py-3 text-gray-600">{p.unidades_pedidas}</td>
                          <td className="text-center px-3 py-3 text-gray-800 font-medium">{p.unidades_ajustadas || p.unidades_pedidas}</td>
                          <td className="text-center px-3 py-3 text-gray-600">{p.cantidad_paquetes}</td>
                          <td className="text-center px-3 py-3">
                            <input
                              type="number"
                              min="0"
                              value={vals.empacadas}
                              onChange={e => setUnidadesMap(prev => ({ ...prev, [p.id]: { ...prev[p.id], empacadas: e.target.value } }))}
                              className="w-20 border border-gray-200 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-amber-400"
                            />
                          </td>
                          <td className="text-center px-3 py-3">
                            <input
                              type="number"
                              min="0"
                              value={vals.merma}
                              onChange={e => setUnidadesMap(prev => ({ ...prev, [p.id]: { ...prev[p.id], merma: e.target.value } }))}
                              className="w-20 border border-gray-200 rounded px-2 py-1 text-center focus:outline-none focus:ring-1 focus:ring-amber-400"
                            />
                          </td>
                          <td className="text-center px-3 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => guardarDetalle(p.id)}
                                disabled={actualizarDetalleMutation.isPending}
                                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded transition-colors"
                              >
                                Guardar
                              </button>
                              <button
                                onClick={() => setEtiquetaProducto(p)}
                                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-1 rounded transition-colors"
                              >
                                🏷️ Etiqueta
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panel de completar */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-800">Completar Empaque</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Observaciones finales</label>
                <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)}
                  rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>
              <button
                onClick={() => completarMutation.mutate()}
                disabled={completarMutation.isPending}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {completarMutation.isPending ? 'Completando...' : '✅ Completar Empaque y Finalizar Producción'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modal etiqueta */}
      {etiquetaProducto && (
        <ModalEtiqueta
          producto={etiquetaProducto}
          lote={lote}
          fechaVencimiento={registro_empaque?.fecha_vencimiento || fechaVencimiento}
          onClose={() => setEtiquetaProducto(null)}
        />
      )}
    </div>
  );
};

export default EmpaqueMasa;
