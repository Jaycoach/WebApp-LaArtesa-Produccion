// frontend/src/pages/Planificacion/ListaMasas.tsx

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMasasByFecha,
  useSincronizarSAP,
  useSincronizarBOM,
  useAprobarMasa,
  useAprobarMasaBulk,
  useMarcarPendiente,
} from '../../hooks/useMasas';
import { useAuthStore } from '@/store';
import { MasaProduccionResumen } from '../../types/api';
import { ModalCancelarMasa } from '@/components/common/ModalCancelarMasa';

/**
 * Página: Lista de masas de producción del día
 */
export const ListaMasas: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const esSupervisor = user?.rol === 'admin' || user?.rol === 'supervisor';

  const [fecha, setFecha] = useState<string>(
    sessionStorage.getItem('artesa_fecha_produccion') || new Date().toISOString().split('T')[0]
  );
  const [motivoPendiente, setMotivoPendiente] = useState('');
  const [masaPendienteId, setMasaPendienteId] = useState<number | null>(null);
  const [masaCancelarId, setMasaCancelarId] = useState<number | null>(null);

  const { data: masas, isLoading, error, refetch } = useMasasByFecha(fecha);
  const [busqueda, setBusqueda] = useState('');
  const masasFiltradas = (masas || []).filter((m: MasaProduccionResumen) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return (
      m.tipo_masa?.toLowerCase().includes(q) ||
      m.nombre_masa?.toLowerCase().includes(q) ||
      m.codigo_masa?.toLowerCase().includes(q)
    );
  });
  const sincronizarMutation = useSincronizarSAP();
  const sincronizarBOMMutation = useSincronizarBOM();
  const sincronizandoRef = useRef(false);
  const aprobarMutation = useAprobarMasa();
  const aprobarBulkMutation = useAprobarMasaBulk();
  const pendienteMutation = useMarcarPendiente();
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<number>>(new Set());
  const [bulkModal, setBulkModal] = useState<{ fecha: string; prioridad: boolean; hora_entrega: string } | null>(null);
  const [bulkResultado, setBulkResultado] = useState<{ aprobadas: number; fallidas: { id: number; error: string }[] } | null>(null);

  const handleSincronizar = async () => {
    if (sincronizandoRef.current || sincronizarMutation.isPending) return;
    sincronizandoRef.current = true;
    try {
      await sincronizarMutation.mutateAsync({ fecha });
      refetch();
    } catch (error) {
      console.error('Error sincronizando:', error);
    } finally {
      sincronizandoRef.current = false;
    }
  };

  const handleSincronizarBOM = async () => {
    try {
      await sincronizarBOMMutation.mutateAsync();
    } catch (error) {
      console.error('Error sincronizando BOM:', error);
    }
  };

  const handleVerDetalle = (masaId: number) => {
    navigate(`/planificacion/masas/${masaId}`);
  };

  const [aprobarModal, setAprobarModal] = useState<{ masaId: number; fecha: string; prioridad: boolean; hora_entrega: string } | null>(null);

  const handleAprobar = (e: React.MouseEvent, masaId: number) => {
    e.stopPropagation();
    const sugerida = new Date();
    sugerida.setDate(sugerida.getDate() + 4);
    setAprobarModal({ masaId, fecha: sugerida.toISOString().slice(0, 10), prioridad: false, hora_entrega: '' });
  };

  const confirmarAprobar = async () => {
    if (!aprobarModal) return;
    try {
      const result = await aprobarMutation.mutateAsync({
        masaId: aprobarModal.masaId,
        fecha_vencimiento_sugerida: aprobarModal.fecha || undefined,
        prioridad: aprobarModal.prioridad || undefined,
        hora_entrega: aprobarModal.hora_entrega || undefined,
      });
      setAprobarModal(null);
      if (result?.subdivision?.realizada) {
        const n = result.subdivision.n_tandas;
        alert(`✅ Masa subdividida en ${n} tandas. Cada tanda está aprobada y lista para pesaje.`);
      }
    } catch (error) {
      console.error('Error aprobando masa:', error);
      setAprobarModal(null);
    }
  };

  const handleAbrirPendiente = (e: React.MouseEvent, masaId: number) => {
    e.stopPropagation();
    setMasaPendienteId(masaId);
    setMotivoPendiente('');
  };

  const handleAbrirCancelar = (e: React.MouseEvent, masaId: number) => {
    e.stopPropagation();
    setMasaCancelarId(masaId);
  };

  const handleConfirmarPendiente = async () => {
    if (!masaPendienteId) return;
    try {
      await pendienteMutation.mutateAsync({ masaId: masaPendienteId, motivo: motivoPendiente });
      setMasaPendienteId(null);
    } catch (error: any) {
      const msg = error?.message || 'Error desconocido al marcar como pendiente';
      alert(`⚠️ No se pudo marcar como pendiente:\n\n${msg}`);
    }
  };

  // ── Selección múltiple / aprobación masiva (una sola llamada al backend) ──
  // Nota: "aprobables" opera sobre masasFiltradas — si el usuario buscó "arabe",
  // "seleccionar todas" solo selecciona las visibles, no las 40 del día completo.
  const aprobables = masasFiltradas.filter((m: MasaProduccionResumen) =>
    ['PLANIFICACION', 'PENDIENTE'].includes(m.estado)
  );

  const toggleSeleccion = (id: number) => {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSeleccionarTodas = () => {
    setSeleccionadas(prev =>
      prev.size === aprobables.length && aprobables.length > 0
        ? new Set()
        : new Set(aprobables.map((m: MasaProduccionResumen) => m.id))
    );
  };

  const toggleExpandir = (id: number) => {
    setExpandidas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const todasExpandidas = masasFiltradas.length > 0 && masasFiltradas.every((m: MasaProduccionResumen) => expandidas.has(m.id));
  const toggleExpandirTodo = () => {
    setExpandidas(todasExpandidas ? new Set() : new Set(masasFiltradas.map((m: MasaProduccionResumen) => m.id)));
  };

  const abrirModalBulk = () => {
    const sugerida = new Date();
    sugerida.setDate(sugerida.getDate() + 4);
    setBulkModal({ fecha: sugerida.toISOString().slice(0, 10), prioridad: false, hora_entrega: '' });
  };

  const confirmarAprobarBulk = async () => {
    if (!bulkModal) return;
    try {
      const result = await aprobarBulkMutation.mutateAsync({
        ids: Array.from(seleccionadas),
        fecha_vencimiento_sugerida: bulkModal.fecha || undefined,
        prioridad: bulkModal.prioridad || undefined,
        hora_entrega: bulkModal.hora_entrega || undefined,
      });
      setBulkModal(null);
      setSeleccionadas(new Set());
      setBulkResultado(result);
      refetch();
    } catch (error: any) {
      setBulkModal(null);
      alert(`⚠️ Error en aprobación masiva:\n\n${error?.message || 'Error desconocido'}`);
    }
  };

  // Estados que no son fases de progreso — se muestran tal cual, el resto usa fase_actual
  const ESTADOS_NO_FASE = ['PENDIENTE', 'SUBDIVIDIDA', 'CANCELADA'];

  const getEstadoBadge = (estado: string) => {
    const badges: Record<string, string> = {
      PLANIFICACION: 'bg-gray-100 text-gray-700',
      APROBADA:      'bg-green-100 text-green-800',
      SUBDIVIDIDA:   'bg-purple-100 text-purple-700',
      PENDIENTE:     'bg-yellow-100 text-yellow-800',
      PESAJE:        'bg-blue-100 text-blue-800',
      AMASADO:       'bg-indigo-100 text-indigo-800',
      DIVISION:      'bg-purple-100 text-purple-800',
      FORMADO:       'bg-pink-100 text-pink-800',
      FERMENTACION:  'bg-orange-100 text-orange-800',
      HORNEADO:      'bg-red-100 text-red-800',
      EMPAQUE:       'bg-yellow-100 text-yellow-800',
      COMPLETADA:    'bg-green-100 text-green-800',
      COMPLETADO:    'bg-green-100 text-green-800',
    };
    return badges[estado] || 'bg-gray-100 text-gray-800';
  };

  const getEstadoLabel = (estado: string) => {
    const labels: Record<string, string> = {
      PLANIFICACION: 'Planificación',
      APROBADA:      'Aprobada',
      SUBDIVIDIDA:   'Subdividida',
      PENDIENTE:     'Pendiente',
      PESAJE:        'Pesaje',
      AMASADO:       'Amasado',
      DIVISION:      'División',
      FORMADO:       'Formado',
      FERMENTACION:  'Fermentación',
      HORNEADO:      'Horneado',
      EMPAQUE:       'Empaque',
      COMPLETADA:    'Completada',
      COMPLETADO:    'Completado',
    };
    return labels[estado] || estado;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-3 md:p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-4 md:p-6 mb-4 md:mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Masas de Producción</h1>
              <p className="text-gray-600 mt-1 text-sm md:text-base">Gestiona las masas programadas para el día</p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="date"
                value={fecha}
                onChange={(e) => { sessionStorage.setItem('artesa_fecha_produccion', e.target.value); setFecha(e.target.value); }}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm w-full sm:w-auto"
              />

              {/* Botón sincronizar BOM */}
              <button
                onClick={handleSincronizarBOM}
                disabled={sincronizarBOMMutation.isPending || sincronizarMutation.isPending}
                title="Sincronizar listas de materiales (BOM) desde SAP. Ejecutar antes de completar Planificación."
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 text-sm flex-1 sm:flex-none justify-center"
              >
                {sincronizarBOMMutation.isPending ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Sync BOM...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Sync BOM
                  </>
                )}
              </button>

              {/* Botón sincronizar OV */}
              <button
                onClick={handleSincronizar}
                disabled={sincronizarMutation.isPending || sincronizarBOMMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 flex-1 sm:flex-none justify-center text-sm"
              >
                {sincronizarMutation.isPending ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sincronizar SAP
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Mensajes de sincronización OV */}
          {sincronizarMutation.isSuccess && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800">✓ Sincronización completada exitosamente</p>
            </div>
          )}
          {sincronizarMutation.isError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error en la sincronización. Intenta nuevamente.</p>
            </div>
          )}

          {/* Mensajes de sincronización BOM */}
          {sincronizarBOMMutation.isSuccess && sincronizarBOMMutation.data && (
            <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-emerald-800 font-medium">✓ BOM sincronizado</p>
              <p className="text-emerald-700 text-sm mt-1">
                {sincronizarBOMMutation.data.bom_sincronizados} artículos con receta
                · {sincronizarBOMMutation.data.sin_bom} sin BOM
                · {sincronizarBOMMutation.data.articulos_procesados} total procesados
              </p>
              {sincronizarBOMMutation.data.errores && sincronizarBOMMutation.data.errores.length > 0 && (
                <p className="text-amber-700 text-sm mt-1">
                  ⚠ {sincronizarBOMMutation.data.errores.length} artículo(s) con error
                </p>
              )}
            </div>
          )}
          {sincronizarBOMMutation.isError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error al sincronizar BOM. Intenta nuevamente.</p>
            </div>
          )}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-800">Error al cargar masas: {error.message}</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && (!masas || masas.length === 0) && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              No hay masas para esta fecha
            </h3>
            <p className="mt-2 text-gray-500">
              Sincroniza con SAP para cargar las órdenes de producción
            </p>
            <button
              onClick={handleSincronizar}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Sincronizar ahora
            </button>
          </div>
        )}

        {/* Lista de masas */}
        {!isLoading && masas && masas.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-3 px-1 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="🔍 Buscar masa (tipo, nombre, código)..."
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {busqueda && (
                  <button
                    onClick={() => setBusqueda('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    title="Limpiar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>
              {esSupervisor && aprobables.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={seleccionadas.size === aprobables.length && aprobables.length > 0}
                      onChange={toggleSeleccionarTodas}
                      className="w-4 h-4 accent-green-600"
                    />
                    Seleccionar todas las aprobables ({aprobables.length})
                  </label>
                  <span className="text-gray-300">·</span>
                </>
              )}
              <button
                onClick={toggleExpandirTodo}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                {todasExpandidas ? '▾ Comprimir todo' : '▸ Expandir todo'}
              </button>
            </div>
            {busqueda && masasFiltradas.length === 0 && (
              <div className="text-sm text-gray-400 px-1 mb-3">Sin resultados para "{busqueda}"</div>
            )}
          <div className="bg-white rounded-lg shadow-sm divide-y divide-gray-100 overflow-hidden">
            {[...masasFiltradas].sort((a, b) => {
              // Repeticion primero (tratamiento especial, siempre arriba),
              // luego prioritaria, luego alfabetico por tipo_masa.
              const repDiff = Number(b.es_repeticion) - Number(a.es_repeticion);
              if (repDiff !== 0) return repDiff;
              const prioDiff = Number(b.prioridad) - Number(a.prioridad);
              if (prioDiff !== 0) return prioDiff;
              return (a.tipo_masa || '').localeCompare(b.tipo_masa || '', 'es');
            }).map((masa: MasaProduccionResumen) => {
              const expandida = expandidas.has(masa.id);
              const totalMostrado = masa.division_completada_total && Number(masa.total_panes_cortados) > 0
                ? `${Number(masa.total_panes_cortados).toLocaleString('es-CO')} panes`
                : (Number(masa.total_unidades_programadas) > 0
                    ? `${Number(masa.total_unidades_programadas).toLocaleString('es-CO')} paq`
                    : '—');
              const kgMostrado = (Number(masa.total_kilos_pesado_real) > 0 ? Number(masa.total_kilos_pesado_real) : Number(masa.total_kilos_con_merma)).toFixed(2);
              return (
                <div key={masa.id} className={seleccionadas.has(masa.id) ? 'bg-green-50' : ''}>
                  <div
                    className={`flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-l-4 ${
                      masa.es_repeticion
                        ? 'border-red-500'
                        : masa.estado === 'APROBADA'
                        ? 'border-green-500'
                        : masa.estado === 'PENDIENTE'
                        ? 'border-yellow-500'
                        : 'border-transparent'
                    }`}
                    onClick={() => toggleExpandir(masa.id)}
                  >
                    {esSupervisor && ['PLANIFICACION', 'PENDIENTE'].includes(masa.estado) ? (
                      <input
                        type="checkbox"
                        checked={seleccionadas.has(masa.id)}
                        onChange={() => toggleSeleccion(masa.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 accent-green-600 shrink-0"
                      />
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="text-gray-400 text-xs w-3 shrink-0">{expandida ? '▾' : '▸'}</span>

                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      {masa.es_repeticion && (
                        <span className="text-xs font-bold bg-red-600 text-white rounded px-1.5 py-0.5 shrink-0">🔴 PRIORIDAD</span>
                      )}
                      {!masa.es_repeticion && masa.prioridad && (
                        <span className="text-xs font-bold bg-purple-600 text-white rounded px-1.5 py-0.5 shrink-0">⭐ PRIORITARIA</span>
                      )}
                      {masa.es_adicional && (
                        <span className="text-xs font-bold bg-orange-500 text-white rounded px-1.5 py-0.5 shrink-0 uppercase">ADICIONAL</span>
                      )}
                      <span className={`font-semibold text-sm truncate ${masa.es_repeticion ? 'text-red-600' : masa.prioridad ? 'text-purple-600' : 'text-gray-900'}`}>
                        {masa.tipo_masa}
                      </span>
                      <span className="text-xs text-gray-400 truncate hidden sm:inline">{masa.nombre_masa}</span>
                    </div>

                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${getEstadoBadge(ESTADOS_NO_FASE.includes(masa.estado) ? masa.estado : (masa.fase_actual || masa.estado))}`}>
                      {getEstadoLabel(ESTADOS_NO_FASE.includes(masa.estado) ? masa.estado : (masa.fase_actual || masa.estado))}
                    </span>
                    <span className="shrink-0 text-sm text-gray-600 w-20 text-right hidden md:inline">{kgMostrado} kg</span>
                    <span className="shrink-0 text-sm text-gray-600 w-16 text-right hidden lg:inline">{masa.total_ordenes} OV</span>
                    <span className="shrink-0 text-sm font-semibold text-emerald-700 w-24 text-right hidden lg:inline">{totalMostrado}</span>

                    {esSupervisor && ['PLANIFICACION', 'PENDIENTE', 'APROBADA', 'SUBDIVIDIDA'].includes(masa.estado) && (
                      <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {(masa.estado === 'PLANIFICACION' || masa.estado === 'PENDIENTE') && (
                          <button
                            onClick={(e) => handleAprobar(e, masa.id)}
                            disabled={aprobarMutation.isPending}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded disabled:opacity-50"
                            title="Aprobar"
                          >
                            ✓
                          </button>
                        )}
                        {(masa.estado === 'PLANIFICACION' || masa.estado === 'APROBADA') && (
                          <button
                            onClick={(e) => handleAbrirPendiente(e, masa.id)}
                            className="px-2 py-1 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-medium rounded"
                            title="Marcar pendiente"
                          >
                            ⏸
                          </button>
                        )}
                        {(['PLANIFICACION', 'PENDIENTE', 'SUBDIVIDIDA'].includes(masa.estado) || (masa.estado === 'APROBADA' && !masa.sap_doc_entry_pesaje)) && (
                          <button
                            onClick={(e) => handleAbrirCancelar(e, masa.id)}
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded"
                            title="Cancelar"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleVerDetalle(masa.id); }}
                      className="shrink-0 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded"
                    >
                      Detalle →
                    </button>
                  </div>

                  {expandida && (
                    <div className="px-4 md:px-6 pb-3 bg-gray-50/60">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 pt-2 pb-2 md:hidden">
                        <span>{kgMostrado} kg</span>
                        <span>{masa.total_ordenes} OV</span>
                        <span className="font-semibold text-emerald-700">{totalMostrado}</span>
                      </div>
                      {masa.numeros_ov && masa.numeros_ov.length > 0 && (
                        <p className="text-xs text-gray-400 mb-2">OV: {masa.numeros_ov.join(', ')}</p>
                      )}
                      {masa.productos_resumen && masa.productos_resumen.length > 0 ? (
                        <div className="rounded-lg bg-white border border-gray-100 divide-y divide-gray-100">
                          {masa.productos_resumen.map((p, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5">
                              <span className="text-xs text-gray-700 truncate flex-1 mr-2" title={p.producto_nombre}>
                                {p.producto_nombre}
                              </span>
                              <span className="text-xs font-bold text-emerald-700 shrink-0">
                                {p.division_completada && Number(p.unidades_producidas) > 0
                                  ? `${Math.round(Number(p.unidades_producidas) / Number(p.unidades_por_paquete || 1)).toLocaleString('es-CO')} paq · ${Number(p.unidades_producidas).toLocaleString('es-CO')} panes (cortado)`
                                  : (Number(p.cantidad_paquetes) > 0
                                      ? `${Number(p.cantidad_paquetes).toLocaleString('es-CO')} paq · ${(Number(p.cantidad_paquetes) * Number(p.unidades_por_paquete || 1)).toLocaleString('es-CO')} panes`
                                      : '—')}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Sin productos</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* Modal motivo pendiente */}
      {masaPendienteId !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Marcar como Pendiente</h3>
            <p className="text-sm text-gray-600 mb-4">
              La masa quedará bloqueada. Opcionalmente indica el motivo.
            </p>
            <textarea
              value={motivoPendiente}
              onChange={(e) => setMotivoPendiente(e.target.value)}
              placeholder="Motivo (opcional)..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 text-sm resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setMasaPendienteId(null)}
                className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarPendiente}
                disabled={pendienteMutation.isPending}
                className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {pendienteMutation.isPending ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal cancelación de masa (motivo + selección de líneas OV a cerrar en SAP) */}
      <ModalCancelarMasa
        masaId={masaCancelarId ?? 0}
        isOpen={masaCancelarId !== null}
        onClose={() => setMasaCancelarId(null)}
        onCancelada={() => { setMasaCancelarId(null); refetch(); }}
      />
      {/* Modal confirmación de aprobación con fecha de vencimiento */}
      {aprobarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-1">Aprobar masa</h3>
            <p className="text-sm text-gray-500 mb-4">
              Opcionalmente, indica la fecha de vencimiento sugerida para el empaque.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha de vencimiento sugerida
              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="date"
              value={aprobarModal.fecha}
              onChange={e => setAprobarModal(prev => prev ? { ...prev, fecha: e.target.value } : null)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-green-400"
            />
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={aprobarModal.prioridad}
                onChange={e => setAprobarModal(prev => prev ? { ...prev, prioridad: e.target.checked } : null)}
                className="w-4 h-4 accent-red-600"
              />
              Marcar como prioritaria / repetición
            </label>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hora de entrega
              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="time"
              value={aprobarModal.hora_entrega}
              onChange={e => setAprobarModal(prev => prev ? { ...prev, hora_entrega: e.target.value } : null)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-green-400"
            />
            <div className="flex gap-2">
              <button
                onClick={confirmarAprobar}
                disabled={aprobarMutation.isPending}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {aprobarMutation.isPending ? 'Aprobando...' : '✓ Confirmar aprobación'}
              </button>
              <button
                onClick={() => setAprobarModal(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra sticky de aprobación masiva */}
      {seleccionadas.size > 0 && !bulkModal && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">
              {seleccionadas.size} masa{seleccionadas.size !== 1 ? 's' : ''} seleccionada{seleccionadas.size !== 1 ? 's' : ''}
            </span>
            <button
              onClick={toggleExpandirTodo}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {todasExpandidas ? '▾ Comprimir todo' : '▸ Expandir todo'}
            </button>
            <button
              onClick={() => setSeleccionadas(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Deseleccionar
            </button>
          </div>
          <button
            onClick={abrirModalBulk}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold"
          >
            ✓ Aprobar todo ({seleccionadas.size})
          </button>
        </div>
      )}

      {/* Modal aprobación masiva */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-1">Aprobar {seleccionadas.size} masas</h3>
            <p className="text-sm text-gray-500 mb-4">
              Estos valores se aplicarán a todas las masas seleccionadas. Se enviará un solo correo resumen a Empaque.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha de vencimiento sugerida
              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="date"
              value={bulkModal.fecha}
              onChange={e => setBulkModal(prev => prev ? { ...prev, fecha: e.target.value } : null)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-green-400"
            />
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <input
                type="checkbox"
                checked={bulkModal.prioridad}
                onChange={e => setBulkModal(prev => prev ? { ...prev, prioridad: e.target.checked } : null)}
                className="w-4 h-4 accent-red-600"
              />
              Marcar como prioritarias / repetición
            </label>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hora de entrega
              <span className="text-gray-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="time"
              value={bulkModal.hora_entrega}
              onChange={e => setBulkModal(prev => prev ? { ...prev, hora_entrega: e.target.value } : null)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-green-400"
            />
            <div className="flex gap-2">
              <button
                onClick={confirmarAprobarBulk}
                disabled={aprobarBulkMutation.isPending}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {aprobarBulkMutation.isPending ? 'Aprobando...' : '✓ Confirmar aprobación masiva'}
              </button>
              <button
                onClick={() => setBulkModal(null)}
                disabled={aprobarBulkMutation.isPending}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado de aprobación masiva */}
      {bulkResultado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">
              {bulkResultado.fallidas.length === 0 ? '✅ Listo' : '⚠️ Completado con errores'}
            </h3>
            <p className="text-sm text-gray-600 mb-2">{bulkResultado.aprobadas} masa(s) aprobada(s) correctamente.</p>
            {bulkResultado.fallidas.length > 0 && (
              <div className="mb-3 max-h-40 overflow-y-auto">
                {bulkResultado.fallidas.map(f => (
                  <p key={f.id} className="text-xs text-red-600">Masa #{f.id}: {f.error}</p>
                ))}
              </div>
            )}
            <button
              onClick={() => setBulkResultado(null)}
              className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-sm font-medium"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListaMasas;
