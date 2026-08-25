import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common';
import { useMasaDetail, useComposicion } from '../../hooks/useMasas';
import { useAmasadoras } from '../../hooks/useConfig';
import { useCompletarFase, useFases } from '../../hooks/useFases';
import { ModalMO } from '../../components/common/ModalMO';
import { BarraNavegacionFases } from '../../components/common/BarraNavegacionFases';
import { displayLote } from '../../types/api';

export const AmasadoMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const masaIdNum = Number(masaId);

  const { data: masa, isLoading: loadingMasa } = useMasaDetail(masaIdNum);
  const { data: composicion } = useComposicion(masaIdNum);
  const { data: amasadoras } = useAmasadoras();
  const { data: fasesProgreso } = useFases(masaId!);
  const completarMutation = useCompletarFase();

  // Solo lo que Kevin pidió ver en Amasado: harina y agua ya pesadas en Pesaje.
  const ingredientesRelevantes = ((composicion as any[]) || []).filter(
    (ing: any) => ing.es_harina || ing.es_agua
  );

  const [showMO, setShowMO] = useState(false);
  const [mostrarConfirmarModal, setMostrarConfirmarModal] = useState(false);
  const [formData, setFormData] = useState({
    temperatura_masa_final: '',
    velocidad_1_minutos: '',
    velocidad_2_minutos: '',
    temperatura_agua: '',
    amasadora_id: '1',
    observaciones: '',
  });

  // Rehidratar formData desde progreso_fases.datos_fase — sin esto se pierde
  // al desmontar/remontar el componente (ej. navegar a División y volver),
  // mismo patrón que DivisionMasa.tsx. Compatible con filas históricas donde
  // datos_fase quedó envuelto como {datos: {...}} (bug de doble-anidado ya
  // corregido en el backend, pero los registros viejos conservan esa forma).
  useEffect(() => {
    const faseAmasado = (fasesProgreso as unknown as any[])?.find((f: any) => f.fase === 'AMASADO');
    const guardado = faseAmasado?.datos_fase?.datos ?? faseAmasado?.datos_fase;
    if (guardado && Object.keys(guardado).length > 0) {
      setFormData(prev => ({
        temperatura_masa_final: guardado.temperatura_masa_final != null ? String(guardado.temperatura_masa_final) : prev.temperatura_masa_final,
        velocidad_1_minutos:    guardado.velocidad_1_minutos != null ? String(guardado.velocidad_1_minutos) : prev.velocidad_1_minutos,
        velocidad_2_minutos:    guardado.velocidad_2_minutos != null ? String(guardado.velocidad_2_minutos) : prev.velocidad_2_minutos,
        temperatura_agua:       guardado.temperatura_agua != null ? String(guardado.temperatura_agua) : prev.temperatura_agua,
        amasadora_id:           guardado.amasadora_id != null ? String(guardado.amasadora_id) : prev.amasadora_id,
        observaciones:          guardado.observaciones ?? prev.observaciones,
      }));
    }
  }, [fasesProgreso]);

  const handleCompletarClick = () => {
    if (!formData.temperatura_masa_final || !formData.velocidad_1_minutos || !formData.velocidad_2_minutos) {
      alert('Por favor completa todos los campos requeridos');
      return;
    }
    setMostrarConfirmarModal(true);
  };

  const ejecutarCompletar = async () => {
    setMostrarConfirmarModal(false);
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
        <BarraNavegacionFases
          masaId={masaId!}
          codigoMasa={displayLote(masa)}
          faseAnterior={{ label: 'Pesaje', ruta: `/pesaje/${masaId}` }}
          faseSiguiente={{
            label: 'División',
            ruta: `/division/${masaId}`,
            habilitada: masa.fase_actual !== 'AMASADO',
          }}
        />
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Amasado</h1>
              <p className="text-gray-600 mt-1">{masa.tipo_masa}</p>
              <p className="text-sm text-gray-500 mt-1">ID Masa: {masaId}</p>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
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
              <p className="text-sm text-gray-600">Total Pesado</p>
              <p className="text-2xl font-bold text-gray-900">
                {typeof masa.total_kilos_pesado_real === 'number'
                  ? masa.total_kilos_pesado_real.toFixed(2)
                  : Number(masa.total_kilos_pesado_real).toFixed(2)} kg
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Productos</p>
              <p className="text-2xl font-bold text-gray-900">{masa.total_productos || 0}</p>
            </div>
          </div>
        </Card>

        {/* Ingredientes ya pesados en Pesaje — harina y agua */}
        {ingredientesRelevantes.length > 0 && (
          <Card title="Harina y Agua Pesadas">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ingredientesRelevantes.map((ing: any) => (
                <div key={ing.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{ing.ingrediente_nombre}</p>
                    <p className="text-xs text-gray-400">{ing.es_agua ? 'Agua' : 'Harina'}</p>
                  </div>
                  <p className="text-lg font-bold text-gray-900">
                    {ing.peso_real != null
                      ? `${Number(ing.peso_real).toFixed(0)} g`
                      : `${Number(ing.cantidad_gramos).toFixed(0)} g (teórico)`}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}

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
                {(amasadoras || []).map((a: any) => (
                  <option key={a.id} value={String(a.id)}>{a.nombre}</option>
                ))}
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

        {/* Botones — sticky para que "Completar Amasado" nunca requiera scroll */}
        <div className="sticky bottom-0 z-10 bg-gray-50 border-t border-gray-200 px-4 py-3 -mx-6 flex justify-end items-center">
          <div className="flex gap-3 items-center">
            <button
              onClick={() => setShowMO(true)}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium"
            >
              + Mano de obra
            </button>
            {masa.fase_actual === 'AMASADO' && (
              <button
                onClick={handleCompletarClick}
                disabled={completarMutation.isPending}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-semibold"
              >
                {completarMutation.isPending ? 'Completando...' : 'Completar Amasado'}
              </button>
            )}
          </div>
        </div>
        {showMO && <ModalMO masaId={masaIdNum} fase="AMASADO" onClose={() => setShowMO(false)} />}

        {mostrarConfirmarModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
              <h3 className="font-bold text-lg mb-3 text-gray-800">Confirmar Amasado</h3>
              <p className="text-sm text-gray-600 mb-5">
                ¿Confirmar que el amasado está completo? Esto desbloqueará la siguiente fase.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setMostrarConfirmarModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={ejecutarCompletar}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  Completar Amasado
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AmasadoMasa;
