import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail, useProductos, useComposicion, MASAS_QUERY_KEYS } from '../../hooks/useMasas';
import { useFases } from '../../hooks/useFases';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fasesService } from '../../services/fasesService';
import { useAuthStore } from '@/store';
import { masasService } from '../../services/masasService';
import { formatBogotaTime } from '../../utils/timezone';
import { ModalCancelarMasa } from '@/components/common/ModalCancelarMasa';
import { BarraNavegacionFases } from '@/components/common/BarraNavegacionFases';

// ── Iconos SVG inline para cada fase ────────────────────────
const FaseIcono: React.FC<{ fase: string; estado: string }> = ({ fase, estado }) => {
  const color = estado === 'COMPLETADA' ? '#16a34a' : estado === 'EN_PROGRESO' ? '#2563eb' : '#9ca3af';
  const iconos: Record<string, JSX.Element> = {
    PLANIFICACION: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
    PESAJE: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M12 2L8 6h8l-4-4z"/><path d="M3 6h18l-2 14H5L3 6z"/>
        <line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/>
      </svg>
    ),
    AMASADO: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M12 22c4.97 0 9-4.03 9-9s-4.03-9-9-9-9 4.03-9 9 4.03 9 9 9z"/>
        <path d="M8 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4"/>
      </svg>
    ),
    DIVISION: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <line x1="3" y1="12" x2="21" y2="12"/>
        <circle cx="12" cy="5" r="1" fill={color}/>
        <circle cx="12" cy="19" r="1" fill={color}/>
      </svg>
    ),
    FORMADO: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
    FERMENTACION: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M8 3v4M16 3v4M8 11v6M16 11v6M3 7h18M3 17h18"/>
      </svg>
    ),
    HORNEADO: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M3 8h18v13H3z"/><path d="M3 8V5a2 2 0 012-2h14a2 2 0 012 2v3"/>
        <path d="M9 12h6M9 16h6"/>
      </svg>
    ),
  };
  return iconos[fase] || <span style={{ color }}>{fase[0]}</span>;
};

export const DetalleMasa: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const masaId = Number(id);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaId);

  // Persistir la fecha de esta masa para que "Volver a la lista" regrese
  // a Planificación mostrando la misma fecha, no la fecha de hoy.
  useEffect(() => {
    if (masa?.fecha_produccion) {
      sessionStorage.setItem('artesa_fecha_produccion', String(masa.fecha_produccion).slice(0, 10));
    }
  }, [masa?.fecha_produccion]);

  const { data: productos, isLoading: loadingProductos } = useProductos(masaId);
  const { data: composicion, isLoading: loadingComposicion } = useComposicion(masaId);
  const { data: fases } = useFases(id!);

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const esSupervisor = user?.rol === 'admin' || user?.rol === 'supervisor';
  const [iniciandoPesaje, setIniciandoPesaje] = useState(false);
  const [mostrarCancelar, setMostrarCancelar] = useState(false);

  // Estado para ajuste de unidades por producto
  const [ajustes, setAjustes] = useState<Record<number, { delta: string; motivo: string; guardando: boolean; error: string | null }>>({});

  const getAjuste = (productoId: number, deltaAjuste?: number | null) => {
    if (ajustes[productoId] !== undefined) return ajustes[productoId];
    // delta_ajuste NULL = nunca tocado → mostrar default +2
    // delta_ajuste = valor guardado por el usuario (puede ser 0)
    const deltaDefault = deltaAjuste !== null && deltaAjuste !== undefined ? String(deltaAjuste) : '2';
    return { delta: deltaDefault, motivo: '', guardando: false, error: null };
  };

  const setAjusteCampo = (productoId: number, campo: 'delta' | 'motivo', valor: string) =>
    setAjustes(prev => ({ ...prev, [productoId]: { ...getAjuste(productoId, undefined), [campo]: valor, error: null } }));

  const handleGuardarAjuste = async (productoId: number, upq: number) => {
    const ajuste = getAjuste(productoId);
    const delta = parseInt(ajuste.delta, 10);
    if (isNaN(delta)) {
      setAjustes(prev => ({ ...prev, [productoId]: { ...getAjuste(productoId), error: 'Ingresa un número entero (puede ser 0 para quitar ajuste)' } }));
      return;
    }
    setAjustes(prev => ({ ...prev, [productoId]: { ...getAjuste(productoId), guardando: true, error: null } }));
    try {
      await masasService.updateUnidadesProgramadas(masaId, productoId, delta, ajuste.motivo || undefined);
      setAjustes(prev => ({ ...prev, [productoId]: { ...prev[productoId], guardando: false, error: null } }));
      queryClient.invalidateQueries({ queryKey: MASAS_QUERY_KEYS.productos(masaId) });
    } catch (e: any) {
      setAjustes(prev => ({ ...prev, [productoId]: { ...getAjuste(productoId), guardando: false, error: e?.message || 'Error al guardar' } }));
    }
  };


  const iniciarPesajeMutation = useMutation({
    mutationFn: () => fasesService.completarFase(id!, 'planificacion'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MASAS_QUERY_KEYS.detail(masaId) });
      queryClient.invalidateQueries({ queryKey: ['fases', id] });
      navigate(`/pesaje/${masaId}`);
    },
    onError: (error: any) => {
      setIniciandoPesaje(false);
      alert(`Error al iniciar pesaje: ${error?.message || 'Error desconocido'}`);
    },
  });

  const handleIniciarPesaje = () => {
    if (masa?.estado !== 'APROBADA') {
      alert('Esta masa debe ser aprobada por un supervisor antes de iniciar el pesaje.');
      return;
    }
    setIniciandoPesaje(true);
    iniciarPesajeMutation.mutate();
  };

  const getFaseColor = (estado: string) => {
    const colors: Record<string, string> = {
      COMPLETADA:         'bg-green-100 text-green-800 border-green-300',
      EN_PROGRESO:        'bg-blue-100 text-blue-800 border-blue-300',
      BLOQUEADA:          'bg-gray-100 text-gray-400 border-gray-200',
      REQUIERE_ATENCION:  'bg-yellow-100 text-yellow-800 border-yellow-300',
    };
    return colors[estado] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getFaseBarColor = (estado: string) => {
    if (estado === 'COMPLETADA')  return 'bg-green-500';
    if (estado === 'EN_PROGRESO') return 'bg-blue-500';
    return 'bg-gray-300';
  };

  const getFaseLabel = (estado: string) => {
    const labels: Record<string, string> = {
      COMPLETADA:        '✓ Completada',
      EN_PROGRESO:       '▶ En progreso',
      BLOQUEADA:         '🔒 Bloqueada',
      REQUIERE_ATENCION: '⚠ Atención',
    };
    return labels[estado] || estado;
  };

  const navegar = (fase: string, estado: string) => {
    if (estado === 'BLOQUEADA') return;
    const rutas: Record<string, string> = {
      PESAJE:       `/pesaje/${masaId}`,
      AMASADO:      `/amasado/${masaId}`,
      DIVISION:     `/division/${masaId}`,
      FORMADO:      `/formado/${masaId}`,
      FERMENTACION: `/fermentacion/${masaId}`,
      HORNEADO:     `/horneado/${masaId}`,
      EMPAQUE:      `/empaque/${masaId}`,
    };
    if (rutas[fase]) navigate(rutas[fase]);
  };

  const calcularProgresoGeneral = () => {
    if (!fases || !Array.isArray(fases) || fases.length === 0) return 0;
    const completadas = fases.filter((f: any) => f.estado === 'COMPLETADA').length;
    return Math.round((completadas / fases.length) * 100);
  };

  if (loadingMasa) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!masa) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">Masa no encontrada</p>
        </div>
      </div>
    );
  }

  const progresoGeneral = calcularProgresoGeneral();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <BarraNavegacionFases
          masaId={masaId}
          codigoMasa={masa.codigo_masa}
          faseSiguiente={masa.fase_actual === 'PLANIFICACION' ? {
            label: 'Pesaje',
            ruta: `/pesaje/${masaId}`,
            habilitada: masa.estado === 'APROBADA',
            loading: iniciandoPesaje,
            onClick: handleIniciarPesaje,
          } : undefined}
        />
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {masa.es_repeticion && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold bg-red-600 text-white rounded px-2 py-0.5">
                    🔴 REPETICIÓN — PRIORIDAD
                  </span>
                )}
                {!masa.es_repeticion && masa.prioridad && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold bg-purple-600 text-white rounded px-2 py-0.5">
                    ⭐ PRIORITARIA
                  </span>
                )}
                {masa.es_adicional && (
                  <span
                    className="text-xs font-bold text-white uppercase tracking-wide rounded px-2 py-0.5"
                    style={{ backgroundColor: '#f97316' }}
                  >
                    ADICIONAL
                  </span>
                )}
              </div>
              <h1 className={`text-3xl font-bold ${masa.es_repeticion ? 'text-red-600' : masa.prioridad ? 'text-purple-600' : 'text-gray-900'}`}>{masa.tipo_masa}</h1>
              <p className="text-gray-600 mt-1">{masa.nombre_masa}</p>
              <p className="text-sm text-gray-500 mt-1">Código: {masa.codigo_masa}</p>
              {masa.lote_produccion && (
                <p className="text-sm font-semibold text-indigo-700 mt-1">
                  Lote: {masa.lote_produccion}
                </p>
              )}
            </div>
            <div className="text-right">
              <span className={`px-4 py-2 rounded-full text-sm font-medium border ${getFaseColor(masa.estado)}`}>
                {masa.fase_actual}
              </span>
              <p className="text-sm text-gray-500 mt-2">{masa.fecha_produccion}</p>
              {esSupervisor && (['PLANIFICACION', 'PENDIENTE', 'SUBDIVIDIDA'].includes(masa.estado) || (masa.estado === 'APROBADA' && !masa.sap_doc_entry_pesaje)) && (
                <button
                  onClick={() => setMostrarCancelar(true)}
                  className="mt-3 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium ml-auto block"
                >
                  ✕ Cancelar Masa
                </button>
              )}
            </div>
          </div>
        </div>

        <ModalCancelarMasa
          masaId={Number(masaId)}
          isOpen={mostrarCancelar}
          onClose={() => setMostrarCancelar(false)}
          onCancelada={() => navigate('/planificacion')}
        />

        {/* Información General */}
        <Card title="Información General">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total Base</p>
              <p className="text-2xl font-bold text-gray-900">
                {Number(masa.total_kilos_base).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">{masa.total_kilos_pesado_real > 0 ? 'Total Pesado' : `Con Merma (${masa.porcentaje_merma || 0}%)`}</p>
              <p className="text-2xl font-bold text-blue-600">
                {(Number(masa.total_kilos_pesado_real) > 0 ? Number(masa.total_kilos_pesado_real) : Number(masa.total_kilos_con_merma)).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Órdenes</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_ordenes || 0}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Productos</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_productos || 0}</p>
            </div>
          </div>
        </Card>

        {/* Progreso de Fases */}
        {fases && Array.isArray(fases) && (
          <Card title={`Progreso de Producción — ${progresoGeneral}% completado`}>

            {/* Barra general de progreso */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Inicio</span>
                <span>{progresoGeneral}%</span>
                <span>Completado</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progresoGeneral}%` }}
                />
              </div>
            </div>

            {/* Tarjetas de fases */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(fases as any[]).map((fase: any, idx: number) => {
                const esClickeable = fase.estado !== 'BLOQUEADA' && fase.fase !== 'PLANIFICACION';
                return (
                  <div
                    key={fase.fase}
                    onClick={() => navegar(fase.fase, fase.estado)}
                    className={`
                      relative p-4 rounded-xl border-2 transition-all
                      ${fase.estado === 'COMPLETADA'
                        ? 'border-green-300 bg-green-50'
                        : fase.estado === 'EN_PROGRESO'
                        ? 'border-blue-300 bg-blue-50 shadow-md'
                        : 'border-gray-200 bg-gray-50 opacity-60'}
                      ${esClickeable ? 'cursor-pointer hover:shadow-lg hover:scale-105' : 'cursor-default'}
                    `}
                  >
                    {/* Número de fase */}
                    <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-600">{idx + 1}</span>
                    </div>

                    {/* Icono */}
                    <div className="flex justify-center mb-2 mt-1">
                      <FaseIcono fase={fase.fase} estado={fase.estado} />
                    </div>

                    {/* Nombre */}
                    <h3 className={`text-center text-xs font-bold mb-2 ${
                      fase.estado === 'COMPLETADA' ? 'text-green-800'
                      : fase.estado === 'EN_PROGRESO' ? 'text-blue-800'
                      : 'text-gray-400'
                    }`}>
                      {fase.fase}
                    </h3>

                    {/* Barra de progreso individual */}
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                      <div
                        className={`h-1.5 rounded-full transition-all ${getFaseBarColor(fase.estado)}`}
                        style={{ width: `${fase.porcentaje_completado || 0}%` }}
                      />
                    </div>

                    {/* Estado + porcentaje */}
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${getFaseColor(fase.estado)}`}>
                        {getFaseLabel(fase.estado)}
                      </span>
                      <span className={`text-xs font-bold ${
                        fase.estado === 'COMPLETADA' ? 'text-green-700'
                        : fase.estado === 'EN_PROGRESO' ? 'text-blue-700'
                        : 'text-gray-400'
                      }`}>
                        {fase.porcentaje_completado || 0}%
                      </span>
                    </div>

                    {/* Fecha completado */}
                    {fase.fecha_completado && (
                      <p className="text-xs text-gray-400 mt-1 text-center truncate">
                        {formatBogotaTime(fase.fecha_completado)}
                      </p>
                    )}

                    {/* Indicador de fase activa */}
                    {fase.estado === 'EN_PROGRESO' && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Productos */}
        <Card title="Productos">
          {loadingProductos ? (
            <p className="text-gray-500">Cargando productos...</p>
          ) : productos && productos.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Código</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">OV</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gramaje</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paq. Pedidos</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paq. a Producir</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Panes</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Kilos</th>
                    {esSupervisor && masa?.fase_actual === 'PLANIFICACION' && !masa?.es_subdivision && (
                      <th className="px-4 py-3 text-center text-xs font-medium text-indigo-600 uppercase">Ajuste (+/− paq.)</th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {(productos as any[]).map((producto: any) => {
                    const upq = Math.max(1, Number(producto.unidades_por_paquete) || 1);
                    const paqPedidos = Number(producto.unidades_pedidas);
                    const paqAProducir = Number(producto.unidades_programadas);
                    const panes = paqAProducir * upq;
                    const ajuste = getAjuste(producto.id, producto.delta_ajuste ?? null);
                    const deltaNum = parseInt(ajuste.delta, 10);
                    const usuarioCambio = ajustes[producto.id] !== undefined;
                    const panesPreview = usuarioCambio && !isNaN(deltaNum)
                      ? (paqAProducir + deltaNum) * upq
                      : null;

                    return (
                      <tr key={producto.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-xs text-gray-400 font-mono">{producto.sap_item_code}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{producto.producto_nombre}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(producto.ordenes_venta || []).length > 0 ? (
                              (producto.ordenes_venta as any[]).map((ov: any) => (
                                <span
                                  key={`${ov.sap_doc_entry}-${ov.sap_line_num}`}
                                  className="text-xs font-mono bg-gray-100 text-gray-700 rounded px-1.5 py-0.5"
                                  title={`Línea ${ov.sap_line_num} · ${ov.unidades_pedidas} paq. pedidos`}
                                >
                                  #{ov.sap_doc_num}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">{producto.gramaje_unitario}g</td>

                        {/* Paq. Pedidos — fijo, de SAP */}
                        <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                          {paqPedidos.toLocaleString('es-CO')}
                        </td>

                        {/* Paq. a Producir — preview en tiempo real mientras el usuario escribe */}
                        <td className="px-4 py-3 text-right">
                          {panesPreview !== null ? (
                            <>
                              <span className="line-through text-gray-400 text-sm mr-1">
                                {paqAProducir.toLocaleString('es-CO')}
                              </span>
                              <span className={`text-sm font-bold ${(paqAProducir + deltaNum) >= paqPedidos ? 'text-indigo-700' : 'text-red-600'}`}>
                                {(paqAProducir + deltaNum).toLocaleString('es-CO')}
                              </span>
                            </>
                          ) : (
                            <span className={`text-sm font-bold ${paqAProducir > paqPedidos ? 'text-indigo-700' : 'text-gray-900'}`}>
                              {paqAProducir.toLocaleString('es-CO')}
                              {paqAProducir > paqPedidos && (
                                <span className="ml-1 text-xs text-indigo-500">(+{paqAProducir - paqPedidos})</span>
                              )}
                            </span>
                          )}
                        </td>

                        {/* Panes totales — preview en tiempo real */}
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-emerald-700">
                            {panesPreview !== null
                              ? <><span className="line-through text-gray-400 mr-1">{panes.toLocaleString('es-CO')}</span><span className={panesPreview >= paqPedidos * upq ? 'text-indigo-600' : 'text-red-500'}>{panesPreview.toLocaleString('es-CO')}</span></>
                              : panes.toLocaleString('es-CO')
                            }
                          </span>
                        </td>

                        {/* Kilos */}
                        <td className="px-4 py-3 text-sm text-gray-900 text-right">
                          {Number(producto.kilos_programados).toFixed(2)} kg
                        </td>

                        {/* Columna de ajuste — solo supervisor en PLANIFICACION y no sub-masa */}
                        {esSupervisor && masa?.fase_actual === 'PLANIFICACION' && !masa?.es_subdivision && (
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1 min-w-[200px]">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  placeholder="+2 / −1"
                                  value={ajuste.delta}
                                  onChange={e => setAjusteCampo(producto.id, 'delta', e.target.value)}
                                  className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-indigo-400 text-center"
                                  title="Ajuste en paquetes. Si no modificas, se aplicarán +2 paq al aprobar."
                                />
                                <span className="text-xs text-gray-400">paq</span>
                                <button
                                  onClick={() => handleGuardarAjuste(producto.id, upq)}
                                  disabled={ajuste.guardando || !ajuste.delta}
                                  className="px-2 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                >
                                  {ajuste.guardando ? '…' : 'Guardar'}
                                </button>
                              </div>
                              <input
                                type="text"
                                placeholder="Motivo (opcional)"
                                value={ajuste.motivo}
                                onChange={e => setAjusteCampo(producto.id, 'motivo', e.target.value)}
                                className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:border-indigo-300 text-gray-600"
                              />
                              {ajuste.error && (
                                <span className="text-xs text-red-500">{ajuste.error}</span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="mt-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                <span className="text-sm font-medium text-emerald-800">🍞 Total panes a producir:</span>
                <span className="text-xl font-bold text-emerald-700">
                  {(productos as any[]).reduce((sum: number, p: any) => {
                    const upq = Math.max(1, Number(p.unidades_por_paquete) || 1);
                    const paqProgramados = Number(p.unidades_programadas) || 0;
                    return sum + paqProgramados * upq;
                  }, 0).toLocaleString('es-CO')} panes
                </span>
              </div>
              {(productos as any[]).some((p: any) => parseInt(p.unidades_excedente || 0) > 0) && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-xs text-orange-800">
                    <strong>⚠ Ajuste por múltiplo divisor:</strong> Algunos productos tienen unidades ajustadas al siguiente
                    múltiplo de su divisor. Las unidades extra producidas se registrarán como excedente de producción.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">No hay productos</p>
          )}
        </Card>

        {/* Composición de Ingredientes */}
        <Card title="Composición de Ingredientes">
          {loadingComposicion ? (
            <p className="text-gray-500">Cargando ingredientes...</p>
          ) : composicion && composicion.length > 0 ? (
            <div className="space-y-4">
              {/* ── Materias Primas ── */}
              <div className="overflow-x-auto">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1 px-1">Materias Primas</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingrediente</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">% Panadero</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {(composicion as any[]).filter((ing: any) => !ing.es_empaque).map((ing: any) => (
                      <tr key={ing.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {ing.ingrediente_nombre}
                          {ing.es_harina && <span className="ml-2 text-xs text-blue-600">(Harina)</span>}
                          {ing.es_agua && <span className="ml-2 text-xs text-blue-600">(Agua)</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">{ing.porcentaje_panadero}%</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                          {Number(ing.cantidad_kilos).toFixed(2)} kg
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* ── Materiales de Empaque ── */}
              {(composicion as any[]).some((ing: any) => ing.es_empaque) && (
                <div className="overflow-x-auto">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1 px-1">Materiales de Empaque</p>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-amber-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Material</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(composicion as any[]).filter((ing: any) => ing.es_empaque).map((ing: any) => (
                        <tr key={ing.id} className="hover:bg-amber-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{ing.ingrediente_nombre}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-amber-700 text-right">
                            {Number(ing.cantidad_kilos).toFixed(0)} {ing.uom || 'Und'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">No hay ingredientes</p>
          )}
        </Card>

        {/* Botón volver */}
        <div className="flex justify-start">
          <button
            onClick={() => navigate('/planificacion')}
            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors"
          >
            ← Volver a lista
          </button>
        </div>

      </div>
    </div>
  );
};

export default DetalleMasa;
