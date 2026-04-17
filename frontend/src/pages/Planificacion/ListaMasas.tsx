// frontend/src/pages/Planificacion/ListaMasas.tsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMasasByFecha,
  useSincronizarSAP,
  useSincronizarBOM,
  useAprobarMasa,
  useMarcarPendiente,
} from '../../hooks/useMasas';
import { useAuthStore } from '@/store';
import { MasaProduccionResumen } from '../../types/api';

/**
 * Página: Lista de masas de producción del día
 */
export const ListaMasas: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const esSupervisor = user?.rol === 'admin' || user?.rol === 'supervisor';

  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [motivoPendiente, setMotivoPendiente] = useState('');
  const [masaPendienteId, setMasaPendienteId] = useState<number | null>(null);

  const { data: masas, isLoading, error, refetch } = useMasasByFecha(fecha);
  const sincronizarMutation = useSincronizarSAP();
  const sincronizarBOMMutation = useSincronizarBOM();
  const aprobarMutation = useAprobarMasa();
  const pendienteMutation = useMarcarPendiente();

  const handleSincronizar = async () => {
    try {
      await sincronizarMutation.mutateAsync({ fecha });
      refetch();
    } catch (error) {
      console.error('Error sincronizando:', error);
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

  const [aprobarModal, setAprobarModal] = useState<{ masaId: number; fecha: string } | null>(null);

  const handleAprobar = (e: React.MouseEvent, masaId: number) => {
    e.stopPropagation();
    const sugerida = new Date();
    sugerida.setDate(sugerida.getDate() + 4);
    setAprobarModal({ masaId, fecha: sugerida.toISOString().slice(0, 10) });
  };

  const confirmarAprobar = async () => {
    if (!aprobarModal) return;
    try {
      const result = await aprobarMutation.mutateAsync({
        masaId: aprobarModal.masaId,
        fecha_vencimiento_sugerida: aprobarModal.fecha || undefined,
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
                onChange={(e) => setFecha(e.target.value)}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
            {[...masas].sort((a, b) => Number(b.es_repeticion) - Number(a.es_repeticion)).map((masa: MasaProduccionResumen) => (
              <div
                key={masa.id}
                className={`bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer border-l-4 ${
                  masa.es_repeticion
                    ? 'border-red-500'
                    : masa.estado === 'APROBADA'
                    ? 'border-green-500'
                    : masa.estado === 'PENDIENTE'
                    ? 'border-yellow-500'
                    : 'border-transparent'
                }`}
                onClick={() => handleVerDetalle(masa.id)}
              >
                <div className="p-4 md:p-6">
                  {/* Header de la card */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1 min-w-0">
                      {masa.es_repeticion && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold bg-red-600 text-white rounded px-2 py-0.5 mb-1">
                          🔴 REPETICIÓN — PRIORIDAD
                        </span>
                      )}
                      {masa.es_adicional && (
                        <span
                          style={{
                            backgroundColor: '#f97316',
                            color: 'white',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                          }}
                        >
                          ADICIONAL
                        </span>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`text-lg md:text-xl font-bold ${masa.es_repeticion ? 'text-red-600' : 'text-gray-900'}`}>
                          {masa.tipo_masa}
                        </h3>
                      </div>
                      <p className={`text-sm truncate ${masa.es_repeticion ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                        {masa.nombre_masa}
                      </p>
                    </div>
                    <span className={`ml-2 shrink-0 px-3 py-1 rounded-full text-xs font-medium ${getEstadoBadge(masa.estado)}`}>
                      {getEstadoLabel(masa.estado)}
                    </span>
                  </div>

                  {/* Totales */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total base:</span>
                      <span className="font-semibold">
                        {typeof masa.total_kilos_base === 'number' ? masa.total_kilos_base.toFixed(2) : '0.00'} kg
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Con merma ({masa.porcentaje_merma || 0}%):</span>
                      <span className="font-semibold text-blue-600">
                        {typeof masa.total_kilos_con_merma === 'number' ? masa.total_kilos_con_merma.toFixed(2) : '0.00'} kg
                      </span>
                    </div>
                  </div>

                  {/* Estadísticas */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 mb-3">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gray-900">{masa.total_ordenes}</p>
                      <p className="text-xs text-gray-500">Órdenes</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-emerald-700">
                        {Number(masa.total_unidades_programadas) > 0
                          ? Number(masa.total_unidades_programadas).toLocaleString('es-CO')
                          : '—'}
                      </p>
                      <p className="text-xs text-gray-500">Total paquetes</p>
                    </div>
                  </div>
                  {masa.productos_resumen && masa.productos_resumen.length > 0 && (
                    <div className="mb-3 rounded-lg bg-gray-50 border border-gray-100 divide-y divide-gray-100">
                      {masa.productos_resumen.map((p, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5">
                          <span className="text-xs text-gray-700 truncate flex-1 mr-2" title={p.producto_nombre}>
                            {p.producto_nombre}
                          </span>
                          <span className="text-xs font-bold text-emerald-700 shrink-0">
                            {Number(p.cantidad_paquetes) > 0
                              ? Number(p.cantidad_paquetes).toLocaleString('es-CO')
                              : '—'} paq · {Number(p.cantidad_paquetes) > 0
                              ? (Number(p.cantidad_paquetes) * Number(p.unidades_por_paquete || 1)).toLocaleString('es-CO')
                              : '—'} panes
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Botones acción SUPERVISOR/ADMIN */}
                  {esSupervisor && (masa.estado === 'PLANIFICACION' || masa.estado === 'PENDIENTE' || masa.estado === 'APROBADA') && (
                    <div className="flex gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
                      {(masa.estado === 'PLANIFICACION' || masa.estado === 'PENDIENTE') && (
                        <button
                          onClick={(e) => handleAprobar(e, masa.id)}
                          disabled={aprobarMutation.isPending}
                          className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {aprobarMutation.isPending ? '...' : '✓ Aprobar'}
                        </button>
                      )}
                      {(masa.estado === 'PLANIFICACION' || masa.estado === 'APROBADA') && (
                        <button
                          onClick={(e) => handleAbrirPendiente(e, masa.id)}
                          disabled={pendienteMutation.isPending}
                          className="flex-1 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                        >
                          ⏸ Pendiente
                        </button>
                      )}
                    </div>
                  )}

                  {/* Botón de acción */}
                  <button className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors text-sm">
                    Ver detalle →
                  </button>
                </div>
              </div>
            ))}
          </div>
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
    </div>
  );
};

export default ListaMasas;
