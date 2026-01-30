import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '@/components/common';
import { useChecklist, useUpdateIngrediente, useConfirmarPesaje } from '../../hooks/useChecklist';

export const PesajeMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();
  const navigate = useNavigate();
  const masaIdNum = Number(masaId);

  const { data: checklist, isLoading } = useChecklist(masaIdNum);
  const updateMutation = useUpdateIngrediente();
  const confirmarMutation = useConfirmarPesaje();

  const [editando, setEditando] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    peso_real: '',
    lote: '',
    fecha_vencimiento: '',
  });

  const handleMarcar = async (ingredienteId: number, field: 'disponible' | 'verificado' | 'pesado', value: boolean) => {
    await updateMutation.mutateAsync({
      masaId: masaIdNum,
      ingredienteId,
      data: { [field]: value },
    });
  };

  const handleEditar = (ingrediente: any) => {
    setEditando(ingrediente.id);
    setFormData({
      peso_real: ingrediente.peso_real || '',
      lote: ingrediente.lote || '',
      fecha_vencimiento: ingrediente.fecha_vencimiento || '',
    });
  };

  const handleGuardar = async (ingredienteId: number) => {
    await updateMutation.mutateAsync({
      masaId: masaIdNum,
      ingredienteId,
      data: {
        pesado: true,
        peso_real: Number(formData.peso_real),
        lote: formData.lote,
        fecha_vencimiento: formData.fecha_vencimiento,
      },
    });
    setEditando(null);
  };

  const handleConfirmar = async () => {
    if (confirm('¿Confirmar pesaje completo? Esto desbloqueará la siguiente fase.')) {
      await confirmarMutation.mutateAsync(masaIdNum);
      navigate(`/planificacion/masas/${masaId}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!checklist) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">Checklist no disponible</p>
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
              <h1 className="text-3xl font-bold text-gray-900">Pesaje de Masa</h1>
              <p className="text-gray-600 mt-1">{checklist.tipo_masa}</p>
              <p className="text-sm text-gray-500 mt-1">ID Masa: {masaId}</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">Progreso</div>
              <div className="text-3xl font-bold text-blue-600">{checklist.progreso}%</div>
              <div className="w-48 bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${checklist.progreso}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Indicadores */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className={`p-4 rounded-lg ${checklist.todosDisponibles ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                {checklist.todosDisponibles ? (
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium text-gray-900">Disponibles</span>
              </div>
            </div>
            <div className={`p-4 rounded-lg ${checklist.todosVerificados ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                {checklist.todosVerificados ? (
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium text-gray-900">Verificados</span>
              </div>
            </div>
            <div className={`p-4 rounded-lg ${checklist.todosPesados ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                {checklist.todosPesados ? (
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-medium text-gray-900">Pesados</span>
              </div>
            </div>
          </div>
        </div>

        {/* Lista de Ingredientes */}
        <Card title="Checklist de Ingredientes">
          <div className="space-y-4">
            {checklist.ingredientes.map((ing: any) => (
              <div key={ing.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{ing.ingrediente_nombre}</h3>
                    <p className="text-sm text-gray-600">
                      {typeof ing.cantidad_kilos === 'number'
                        ? ing.cantidad_kilos.toFixed(2)
                        : Number(ing.cantidad_kilos).toFixed(2)} kg ({ing.cantidad_gramos}g) - {ing.porcentaje_panadero}% panadero
                    </p>
                  </div>

                  {/* Checkboxes */}
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ing.disponible}
                        onChange={(e) => handleMarcar(ing.id, 'disponible', e.target.checked)}
                        className="w-5 h-5"
                      />
                      <span className="text-sm">Disponible</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ing.verificado}
                        onChange={(e) => handleMarcar(ing.id, 'verificado', e.target.checked)}
                        disabled={!ing.disponible}
                        className="w-5 h-5 disabled:opacity-50"
                      />
                      <span className="text-sm">Verificado</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ing.pesado}
                        onChange={() => {}} // Read-only checkbox (pesado se marca mediante el formulario)
                        disabled={!ing.verificado}
                        className="w-5 h-5 disabled:opacity-50"
                      />
                      <span className="text-sm">Pesado</span>
                    </label>
                  </div>
                </div>

                {/* Formulario de pesaje */}
                {ing.verificado && !ing.pesado && editando === ing.id && (
                  <div className="mt-4 grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Peso Real (g)</label>
                      <input
                        type="number"
                        value={formData.peso_real}
                        onChange={(e) => setFormData({ ...formData, peso_real: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lote</label>
                      <input
                        type="text"
                        value={formData.lote}
                        onChange={(e) => setFormData({ ...formData, lote: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vencimiento</label>
                      <input
                        type="date"
                        value={formData.fecha_vencimiento}
                        onChange={(e) => setFormData({ ...formData, fecha_vencimiento: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="col-span-3 flex gap-2">
                      <button
                        onClick={() => handleGuardar(ing.id)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditando(null)}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {ing.verificado && !ing.pesado && editando !== ing.id && (
                  <button
                    onClick={() => handleEditar(ing)}
                    className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Registrar Pesaje
                  </button>
                )}

                {/* Datos de pesaje completado */}
                {ing.pesado && (
                  <div className="mt-4 grid grid-cols-3 gap-4 text-sm p-4 bg-green-50 rounded">
                    <div>
                      <span className="text-gray-600">Peso Real:</span>
                      <span className="font-semibold ml-2">{ing.peso_real}g</span>
                      {ing.diferencia_gramos !== 0 && (
                        <span className={`ml-2 ${ing.diferencia_gramos > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ({ing.diferencia_gramos > 0 ? '+' : ''}{ing.diferencia_gramos}g)
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-600">Lote:</span>
                      <span className="font-semibold ml-2">{ing.lote}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Vence:</span>
                      <span className="font-semibold ml-2">{ing.fecha_vencimiento}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Botones de acción */}
        <div className="flex justify-between">
          <button
            onClick={() => navigate(`/planificacion/masas/${masaId}`)}
            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            ← Volver
          </button>

          {checklist.todosPesados && (
            <button
              onClick={handleConfirmar}
              disabled={confirmarMutation.isPending}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold"
            >
              {confirmarMutation.isPending ? 'Confirmando...' : 'Confirmar Pesaje Completo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PesajeMasa;
