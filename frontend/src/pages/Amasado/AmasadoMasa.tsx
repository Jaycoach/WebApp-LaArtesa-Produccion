import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail } from '../../hooks/useMasas';
import { useCompletarFase } from '../../hooks/useFases';

export const AmasadoMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const masaIdNum = Number(masaId);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaIdNum);
  const completarMutation = useCompletarFase();

  const [formData, setFormData] = useState({
    temperatura_masa_final: '',
    velocidad_1_minutos: '',
    velocidad_2_minutos: '',
    temperatura_agua: '',
    amasadora_id: '1',
    observaciones: '',
  });

  const handleCompletar = async () => {
    if (!formData.temperatura_masa_final || !formData.velocidad_1_minutos || !formData.velocidad_2_minutos) {
      alert('Por favor completa todos los campos requeridos');
      return;
    }

    if (confirm('¿Confirmar que el amasado está completo?')) {
      await completarMutation.mutateAsync({
        masaId: masaId!,
        fase: 'amasado',
        data: {
          datos: {
            temperatura_masa_final: Number(formData.temperatura_masa_final),
            velocidad_1_minutos: Number(formData.velocidad_1_minutos),
            velocidad_2_minutos: Number(formData.velocidad_2_minutos),
            temperatura_agua: Number(formData.temperatura_agua),
            amasadora_id: Number(formData.amasadora_id),
            observaciones: formData.observaciones,
          },
        },
      });
      navigate(`/planificacion/masas/${masaId}`);
    }
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
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Amasado</h1>
              <p className="text-gray-600 mt-1">{masa.tipo_masa}</p>
              <p className="text-sm text-gray-500 mt-1">ID Masa: {masaId}</p>
            </div>
            <div className="text-right">
              <span className="px-4 py-2 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800">
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
              <p className="text-2xl font-bold text-gray-900">{masa.total_kilos_con_merma.toFixed(2)} kg</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Productos</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_productos}</p>
            </div>
          </div>
        </Card>

        {/* Formulario de Control de Amasado */}
        <Card title="Control de Amasado">
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Temperatura Masa Final (°C) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.temperatura_masa_final}
                  onChange={(e) => setFormData({ ...formData, temperatura_masa_final: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="26.0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Temperatura Agua (°C)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.temperatura_agua}
                  onChange={(e) => setFormData({ ...formData, temperatura_agua: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="18.0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Velocidad 1 (minutos) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formData.velocidad_1_minutos}
                  onChange={(e) => setFormData({ ...formData, velocidad_1_minutos: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="8"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Velocidad 2 (minutos) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={formData.velocidad_2_minutos}
                  onChange={(e) => setFormData({ ...formData, velocidad_2_minutos: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="12"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amasadora
              </label>
              <select
                value={formData.amasadora_id}
                onChange={(e) => setFormData({ ...formData, amasadora_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="1">Amasadora 1</option>
                <option value="2">Amasadora 2</option>
                <option value="3">Amasadora 3</option>
              </select>
            </div>

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

        {/* Información de ayuda */}
        <Card title="Guía de Proceso">
          <div className="space-y-3 text-sm text-gray-700">
            <p>1. Verificar que todos los ingredientes estén en la amasadora</p>
            <p>2. Iniciar amasado en velocidad 1 según tiempo especificado</p>
            <p>3. Cambiar a velocidad 2 para desarrollo del gluten</p>
            <p>4. Medir temperatura final de la masa</p>
            <p>5. Verificar punto óptimo de la masa (elasticidad y suavidad)</p>
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
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-semibold"
          >
            {completarMutation.isPending ? 'Completando...' : 'Completar Amasado'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AmasadoMasa;
