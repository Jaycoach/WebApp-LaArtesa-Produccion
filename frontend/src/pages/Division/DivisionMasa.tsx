import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail, useProductos } from '../../hooks/useMasas';
import { useCompletarFase } from '../../hooks/useFases';

export const DivisionMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const masaIdNum = Number(masaId);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaIdNum);
  const { data: productos, isLoading: loadingProductos } = useProductos(masaIdNum);
  const completarMutation = useCompletarFase();

  const [formData, setFormData] = useState({
    maquina_corte_id: '1', // 1: Conic, 2: Divisora Manual
    temperatura_entrada: '',
    requiere_reposo: false,
    hora_inicio_reposo: '',
    hora_fin_reposo: '',
    observaciones: '',
  });

  const [cantidadesDivididas, setCantidadesDivididas] = useState<Record<number, number>>({});

  const handleCantidadChange = (productoId: number, cantidad: string) => {
    setCantidadesDivididas({
      ...cantidadesDivididas,
      [productoId]: Number(cantidad) || 0,
    });
  };

  const calcularTiempoReposo = () => {
    if (!formData.hora_inicio_reposo || !formData.hora_fin_reposo) return 0;
    const inicio = new Date(formData.hora_inicio_reposo).getTime();
    const fin = new Date(formData.hora_fin_reposo).getTime();
    const minutos = Math.round((fin - inicio) / 1000 / 60);
    return minutos > 0 ? minutos : 0;
  };

  const handleCompletar = async () => {
    // Validaciones
    if (!formData.temperatura_entrada) {
      alert('Por favor ingresa la temperatura de entrada');
      return;
    }

    if (formData.requiere_reposo && (!formData.hora_inicio_reposo || !formData.hora_fin_reposo)) {
      alert('Por favor registra las horas de inicio y fin del reposo');
      return;
    }

    // Validar que se hayan ingresado cantidades para todos los productos
    if (!productos || productos.length === 0) {
      alert('No hay productos para dividir');
      return;
    }

    const productosSinCantidad = productos.filter(
      (p: any) => !cantidadesDivididas[p.id] || cantidadesDivididas[p.id] <= 0
    );

    if (productosSinCantidad.length > 0) {
      alert('Por favor ingresa las cantidades divididas para todos los productos');
      return;
    }

    if (confirm('¿Confirmar que la división está completa?')) {
      const tiempoReposo = calcularTiempoReposo();

      await completarMutation.mutateAsync({
        masaId: masaId!,
        fase: 'division',
        data: {
          datos: {
            maquina_corte_id: Number(formData.maquina_corte_id),
            temperatura_entrada: Number(formData.temperatura_entrada),
            requiere_reposo: formData.requiere_reposo,
            hora_inicio_reposo: formData.requiere_reposo ? formData.hora_inicio_reposo : null,
            hora_fin_reposo: formData.requiere_reposo ? formData.hora_fin_reposo : null,
            tiempo_reposo_minutos: formData.requiere_reposo ? tiempoReposo : 0,
            cantidades_divididas: cantidadesDivididas,
            observaciones: formData.observaciones,
          },
        },
      });
      navigate(`/planificacion/masas/${masaId}`);
    }
  };

  if (loadingMasa || loadingProductos) {
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
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">División de Masa</h1>
              <p className="text-gray-600 mt-1">{masa.tipo_masa}</p>
              <p className="text-sm text-gray-500 mt-1">ID Masa: {masaId}</p>
            </div>
            <div className="text-right">
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                {masa.fase_actual}
              </span>
            </div>
          </div>
        </div>

        {/* Información de la Masa */}
        <Card title="Información de la Masa">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total con Merma</p>
              <p className="text-2xl font-bold text-gray-900">
                {typeof masa.total_kilos_con_merma === 'number'
                  ? masa.total_kilos_con_merma.toFixed(2)
                  : Number(masa.total_kilos_con_merma).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Productos</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_productos || 0}</p>
            </div>
          </div>
        </Card>

        {/* Formulario de Control de División */}
        <Card title="Control de División">
          <div className="space-y-6">
            {/* Máquina de corte y temperatura */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Máquina de Corte <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.maquina_corte_id}
                  onChange={(e) => setFormData({ ...formData, maquina_corte_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="1">Conic (Automática, 100 kg)</option>
                  <option value="2">Divisora Manual (50 kg)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Temperatura de Entrada (°C) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.temperatura_entrada}
                  onChange={(e) => setFormData({ ...formData, temperatura_entrada: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="25.0"
                />
              </div>
            </div>

            {/* Reposo pre-división */}
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="checkbox"
                  id="requiere_reposo"
                  checked={formData.requiere_reposo}
                  onChange={(e) => setFormData({ ...formData, requiere_reposo: e.target.checked })}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="requiere_reposo" className="text-sm font-medium text-gray-700">
                  Esta masa requiere reposo pre-división
                </label>
              </div>

              {formData.requiere_reposo && (
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hora Inicio Reposo <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.hora_inicio_reposo}
                      onChange={(e) => setFormData({ ...formData, hora_inicio_reposo: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hora Fin Reposo <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.hora_fin_reposo}
                      onChange={(e) => setFormData({ ...formData, hora_fin_reposo: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {formData.hora_inicio_reposo && formData.hora_fin_reposo && (
                    <div className="col-span-2">
                      <p className="text-sm text-gray-700">
                        Tiempo de reposo: <span className="font-semibold text-blue-600">{calcularTiempoReposo()} minutos</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Observaciones */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Observaciones
              </label>
              <textarea
                value={formData.observaciones}
                onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Observaciones opcionales..."
              />
            </div>
          </div>
        </Card>

        {/* Cantidades divididas por producto */}
        <Card title="Cantidades Divididas por Producto">
          <div className="space-y-4">
            {productos && productos.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Producto</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Presentación</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Un. Programadas</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Un. Divididas <span className="text-red-500">*</span></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {productos.map((producto: any) => (
                      <tr key={producto.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{producto.producto_nombre}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{producto.presentacion}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right">{producto.unidades_programadas}</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <input
                            type="number"
                            min="0"
                            value={cantidadesDivididas[producto.id] || ''}
                            onChange={(e) => handleCantidadChange(producto.id, e.target.value)}
                            className="w-32 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
                            placeholder="0"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-500">No hay productos para dividir</p>
            )}

            {productos && productos.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Nota:</strong> Ingresa la cantidad real de unidades divididas para cada producto.
                  Estas cantidades pueden diferir ligeramente de las programadas debido a mermas o ajustes en el proceso.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Información de ayuda */}
        <Card title="Guía de Proceso">
          <div className="space-y-3 text-sm text-gray-700">
            <p>1. Verificar que la masa haya completado el amasado correctamente</p>
            <p>2. Si requiere reposo, dejar reposar la masa el tiempo indicado (generalmente 10-20 minutos)</p>
            <p>3. Seleccionar la máquina de corte adecuada (Conic para grandes volúmenes)</p>
            <p>4. Medir y registrar la temperatura de entrada de la masa</p>
            <p>5. Dividir la masa en las porciones según el gramaje de cada producto</p>
            <p>6. Registrar las cantidades reales divididas para cada producto</p>
            <p>7. Verificar que las piezas tengan un peso uniforme</p>
          </div>
        </Card>

        {/* Botones */}
        <div className="flex justify-between">
          <button
            onClick={() => navigate(`/planificacion/masas/${masaId}`)}
            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            ← Volver
          </button>

          <button
            onClick={handleCompletar}
            disabled={completarMutation.isPending}
            className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 font-semibold"
          >
            {completarMutation.isPending ? 'Completando...' : 'Completar División'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DivisionMasa;
