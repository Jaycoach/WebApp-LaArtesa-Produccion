import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail, useProductos, useComposicion } from '../../hooks/useMasas';
import { useFases } from '../../hooks/useFases';

export const DetalleMasa: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const masaId = Number(id);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaId);
  const { data: productos, isLoading: loadingProductos } = useProductos(masaId);
  const { data: composicion, isLoading: loadingComposicion } = useComposicion(masaId);
  const { data: fases } = useFases(id!);

  const getFaseColor = (estado: string) => {
    const colors: Record<string, string> = {
      COMPLETADA: 'bg-green-100 text-green-800',
      EN_PROGRESO: 'bg-blue-100 text-blue-800',
      BLOQUEADA: 'bg-gray-100 text-gray-500',
      REQUIERE_ATENCION: 'bg-yellow-100 text-yellow-800',
    };
    return colors[estado] || 'bg-gray-100 text-gray-800';
  };

  const navegar = (fase: string) => {
    const rutas: Record<string, string> = {
      PESAJE: `/pesaje/${masaId}`,
      AMASADO: `/amasado/${masaId}`,
      DIVISION: `/division/${masaId}`,
      FORMADO: `/formado/${masaId}`,
      FERMENTACION: `/fermentacion/${masaId}`,
      HORNEADO: `/horneado/${masaId}`,
    };
    if (rutas[fase]) navigate(rutas[fase]);
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

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{masa.tipo_masa}</h1>
              <p className="text-gray-600 mt-1">{masa.nombre_masa}</p>
              <p className="text-sm text-gray-500 mt-1">Código: {masa.codigo_masa}</p>
            </div>
            <div className="text-right">
              <span className={`px-4 py-2 rounded-full text-sm font-medium ${getFaseColor(masa.estado)}`}>
                {masa.fase_actual}
              </span>
              <p className="text-sm text-gray-500 mt-2">{masa.fecha_produccion}</p>
            </div>
          </div>
        </div>

        {/* Información General */}
        <Card title="Información General">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total Base</p>
              <p className="text-2xl font-bold text-gray-900">
                {typeof masa.total_kilos_base === 'number'
                  ? masa.total_kilos_base.toFixed(2)
                  : Number(masa.total_kilos_base).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Con Merma ({masa.porcentaje_merma || 0}%)</p>
              <p className="text-2xl font-bold text-blue-600">
                {typeof masa.total_kilos_con_merma === 'number'
                  ? masa.total_kilos_con_merma.toFixed(2)
                  : Number(masa.total_kilos_con_merma).toFixed(2)} kg
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
          <Card title="Progreso de Producción">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {fases.map((fase: any) => (
                <button
                  key={fase.fase}
                  onClick={() => navegar(fase.fase)}
                  disabled={fase.estado === 'BLOQUEADA'}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    fase.estado === 'BLOQUEADA'
                      ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
                      : 'border-blue-200 bg-white hover:border-blue-400 hover:shadow-md cursor-pointer'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-900">{fase.fase}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getFaseColor(fase.estado)}`}>
                      {fase.estado}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${fase.porcentaje_completado}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{fase.porcentaje_completado}%</p>
                </button>
              ))}
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Presentación</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gramaje</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Un. Pedidas</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Un. Programadas</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Kilos</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {productos.map((producto: any) => (
                    <tr key={producto.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{producto.producto_nombre}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{producto.presentacion}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-right">{producto.gramaje_unitario}g</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">{producto.unidades_pedidas}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-blue-600 text-right">{producto.unidades_programadas}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right">
                        {typeof producto.kilos_programados === 'number'
                          ? producto.kilos_programados.toFixed(2)
                          : Number(producto.kilos_programados).toFixed(2)} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingrediente</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">% Panadero</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cantidad (kg)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {composicion.map((ing: any) => (
                    <tr key={ing.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {ing.ingrediente_nombre}
                        {ing.es_harina && <span className="ml-2 text-xs text-blue-600">(Harina)</span>}
                        {ing.es_agua && <span className="ml-2 text-xs text-blue-600">(Agua)</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-right">{ing.porcentaje_panadero}%</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                        {typeof ing.cantidad_kilos === 'number'
                          ? ing.cantidad_kilos.toFixed(2)
                          : Number(ing.cantidad_kilos).toFixed(2)} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
