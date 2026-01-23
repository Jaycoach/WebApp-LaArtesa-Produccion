// frontend/src/pages/Planificacion/ListaMasas.tsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMasasByFecha, useSincronizarSAP } from '../../hooks/useMasas';
import { MasaProduccionResumen } from '../../types/api';

/**
 * Página: Lista de masas de producción del día
 */
export const ListaMasas: React.FC = () => {
  const navigate = useNavigate();
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().split('T')[0] // Fecha actual YYYY-MM-DD
  );

  // Queries
  const { data: masas, isLoading, error, refetch } = useMasasByFecha(fecha);
  const sincronizarMutation = useSincronizarSAP();

  /**
   * Sincronizar con SAP
   */
  const handleSincronizar = async () => {
    try {
      await sincronizarMutation.mutateAsync();
      refetch();
    } catch (error) {
      console.error('Error sincronizando:', error);
    }
  };

  /**
   * Ver detalle de una masa
   */
  const handleVerDetalle = (masaId: number) => {
    navigate(`/produccion/masas/${masaId}`);
  };

  /**
   * Obtener color según estado de la masa
   */
  const getEstadoColor = (estado: string): string => {
    const colors: Record<string, string> = {
      PLANIFICACION: 'bg-yellow-100 text-yellow-800',
      PESAJE: 'bg-blue-100 text-blue-800',
      AMASADO: 'bg-indigo-100 text-indigo-800',
      DIVISION: 'bg-purple-100 text-purple-800',
      FORMADO: 'bg-pink-100 text-pink-800',
      FERMENTACION: 'bg-orange-100 text-orange-800',
      HORNEADO: 'bg-red-100 text-red-800',
      COMPLETADO: 'bg-green-100 text-green-800',
    };
    return colors[estado] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Masas de Producción
              </h1>
              <p className="text-gray-600 mt-1">
                Gestiona las masas programadas para el día
              </p>
            </div>
            
            <div className="flex gap-4">
              {/* Selector de fecha */}
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              
              {/* Botón sincronizar */}
              <button
                onClick={handleSincronizar}
                disabled={sincronizarMutation.isPending}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {sincronizarMutation.isPending ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
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
          
          {/* Mensaje de éxito de sincronización */}
          {sincronizarMutation.isSuccess && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800">
                ✓ Sincronización completada exitosamente
              </p>
            </div>
          )}
          
          {/* Mensaje de error */}
          {sincronizarMutation.isError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">
                ✗ Error en la sincronización. Intenta nuevamente.
              </p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {masas.map((masa: MasaProduccionResumen) => (
              <div
                key={masa.id}
                className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleVerDetalle(masa.id)}
              >
                <div className="p-6">
                  {/* Header de la card */}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">
                        {masa.tipo_masa}
                      </h3>
                      <p className="text-sm text-gray-500">{masa.nombre_masa}</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${getEstadoColor(
                        masa.estado
                      )}`}
                    >
                      {masa.fase_actual}
                    </span>
                  </div>

                  {/* Totales */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total base:</span>
                      <span className="font-semibold">
                        {masa.total_kilos_base.toFixed(2)} kg
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Con merma ({masa.porcentaje_merma}%):</span>
                      <span className="font-semibold text-blue-600">
                        {masa.total_kilos_con_merma.toFixed(2)} kg
                      </span>
                    </div>
                  </div>

                  {/* Estadísticas */}
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gray-900">
                        {masa.total_ordenes}
                      </p>
                      <p className="text-xs text-gray-500">Órdenes</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gray-900">
                        {masa.total_productos}
                      </p>
                      <p className="text-xs text-gray-500">Productos</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-gray-900">
                        {masa.total_unidades_programadas}
                      </p>
                      <p className="text-xs text-gray-500">Unidades</p>
                    </div>
                  </div>

                  {/* Botón de acción */}
                  <button className="w-full mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors">
                    Ver detalle →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ListaMasas;