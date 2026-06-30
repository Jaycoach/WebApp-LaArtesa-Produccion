import React, { useState, useEffect } from 'react';
import { Card } from '@/components/common';
import { useUpdateFactorAbsorcion, useUpdateCorreos, useCorreosEmpaque, useCostoAgua, useUpdateCostoAgua, useCostoAgua2, useUpdateCostoAgua2, useCatalogoTiposMasa, useUpdateTipoMasaFormado } from '@/hooks/useConfig';

const ModalFormado: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { data: tipos, isLoading } = useCatalogoTiposMasa();
  const updateMutation = useUpdateTipoMasaFormado();
  const [saving, setSaving] = useState<number | null>(null);
  const [localValues, setLocalValues] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (tipos) {
      const initial: Record<number, boolean> = {};
      tipos.forEach((t: any) => { initial[t.id] = t.requiere_formado === true; });
      setLocalValues(initial);
    }
  }, [tipos]);

  const handleToggle = async (id: number, value: boolean) => {
    setLocalValues(prev => ({ ...prev, [id]: value }));
    setSaving(id);
    try {
      await updateMutation.mutateAsync({ id, requiere_formado: value });
    } catch {
      setLocalValues(prev => ({ ...prev, [id]: !value }));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Configurar Fase Formado</h2>
            <p className="text-sm text-gray-500 mt-1">
              Define qué tipos de masa requieren formado manual.
              Si está desactivado, la masa avanza de División directo a Fermentación.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Cargando tipos de masa...</div>
          ) : (
            <div className="space-y-2">
              {(tipos || []).map((tipo: any) => (
                <div key={tipo.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{tipo.nombre_masa}</p>
                    <p className="text-xs text-gray-400">{tipo.tipo_masa}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {saving === tipo.id && (
                      <span className="text-xs text-blue-500">Guardando...</span>
                    )}
                    <button
                      onClick={() => handleToggle(tipo.id, !localValues[tipo.id])}
                      disabled={saving === tipo.id}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                        localValues[tipo.id] ? 'bg-blue-600' : 'bg-gray-300'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        localValues[tipo.id] ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                    <span className={`text-xs font-medium w-12 ${localValues[tipo.id] ? 'text-blue-600' : 'text-gray-400'}`}>
                      {localValues[tipo.id] ? 'Sí' : 'No'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-6 border-t bg-gray-50 rounded-b-xl">
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-500">Los cambios se guardan automáticamente.</p>
            <button onClick={onClose} className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ConfiguracionSistema: React.FC = () => {
  const [showModalFormado, setShowModalFormado] = useState(false);
  // State local para formularios
  const [factorAbsorcion, setFactorAbsorcion] = useState<number>(60);
  const [porcentajeMerma, setPorcentajeMerma] = useState<number>(5);
  const [emailsText, setEmailsText] = useState<string>('');
  const [temperaturaMin, setTemperaturaMin] = useState<number>(18);
  const [temperaturaMax, setTemperaturaMax] = useState<number>(28);
  const [humedadMin, setHumedadMin] = useState<number>(60);
  const [humedadMax, setHumedadMax] = useState<number>(80);
  const [costoAgua, setCostoAgua] = useState<number>(0);
  const [costoAgua2, setCostoAgua2] = useState<number>(0);

  // Queries y mutations
  const updateFactorMutation = useUpdateFactorAbsorcion();
  const updateCorreosMutation = useUpdateCorreos();
  const updateCostoAguaMutation = useUpdateCostoAgua();
  const updateCostoAgua2Mutation = useUpdateCostoAgua2();
  const { data: correosData } = useCorreosEmpaque();
  const { data: costoAguaData } = useCostoAgua();
  const { data: costoAgua2Data } = useCostoAgua2();

  // Sincronizar correos desde servidor
  React.useEffect(() => {
    if (correosData?.correos !== undefined) {
      setEmailsText(correosData.correos);
    }
  }, [correosData]);

  // Sincronizar costo agua desde servidor
  React.useEffect(() => {
    if (costoAguaData?.costo !== undefined) {
      setCostoAgua(costoAguaData.costo);
    }
  }, [costoAguaData]);

  useEffect(() => {
    if (costoAgua2Data?.costo !== undefined) {
      setCostoAgua2(costoAgua2Data.costo);
    }
  }, [costoAgua2Data]);

  // Mensajes de feedback
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Limpiar mensajes después de 3 segundos
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  /**
   * Guardar factor de absorción
   */
  const handleSaveFactorAbsorcion = async () => {
    try {
      await updateFactorMutation.mutateAsync(factorAbsorcion);
      setSuccessMessage('Factor de absorción actualizado correctamente');
      setErrorMessage('');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Error al actualizar el factor de absorción');
      setSuccessMessage('');
    }
  };

  /**
   * Guardar porcentaje de merma (actualmente es solo visual, no hay endpoint)
   */
  const handleSavePorcentajeMerma = () => {
    // TODO: Implementar endpoint en backend para guardar merma por defecto
    setSuccessMessage('Nota: El porcentaje de merma actual es fijo (5%) en el sistema');
  };

  /**
   * Guardar correos de notificación
   */
  const handleSaveCorreos = async () => {
    try {
      const emailsArray = emailsText
        .split(',')
        .map(email => email.trim())
        .filter(email => email.length > 0);

      if (emailsArray.length === 0) {
        setErrorMessage('Debe ingresar al menos un correo electrónico');
        return;
      }

      await updateCorreosMutation.mutateAsync(emailsArray);
      setSuccessMessage('Correos de notificación actualizados correctamente');
      setErrorMessage('');
    } catch (error: any) {
      setErrorMessage(error?.message || 'Error al actualizar los correos');
      setSuccessMessage('');
    }
  };

  /**
   * Guardar rangos de temperatura y humedad (actualmente solo visual)
   */
  const handleSaveRangos = () => {
    // TODO: Implementar endpoint en backend para guardar rangos
    setSuccessMessage('Nota: La configuración de rangos no está disponible en el backend aún');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h1 className="text-3xl font-bold text-gray-900">Configuración del Sistema</h1>
          <p className="text-gray-600 mt-1">
            Gestiona los parámetros globales de producción
          </p>
        </div>

        {/* Mensajes de feedback globales */}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              {successMessage}
            </p>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {errorMessage}
            </p>
          </div>
        )}

        {/* Factor de Absorción de Harina */}
        <Card title="Factor de Absorción de Agua">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Relación de agua respecto a la harina en la formulación (%).
              Se utiliza para calcular la cantidad de agua necesaria en el amasado.
            </p>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Factor de absorción (%)
                </label>
                <input
                  type="number"
                  min="40"
                  max="100"
                  step="0.5"
                  value={factorAbsorcion}
                  onChange={(e) => setFactorAbsorcion(parseFloat(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Valor típico: 55-65% (varía según tipo de harina)
                </p>
              </div>
              <button
                onClick={handleSaveFactorAbsorcion}
                disabled={updateFactorMutation.isPending}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed h-fit mt-6"
              >
                {updateFactorMutation.isPending ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </Card>

        {/* Porcentaje de Merma por Defecto */}
        <Card title="Porcentaje de Merma por Defecto">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Porcentaje de merma aplicado automáticamente en la planificación de producción.
              Se suma al peso base para calcular el total con merma.
            </p>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Porcentaje de merma (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.5"
                  value={porcentajeMerma}
                  onChange={(e) => setPorcentajeMerma(parseFloat(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Valor actual en sistema: 5% (fijo). La configuración dinámica está en desarrollo.
                </p>
              </div>
              <button
                onClick={handleSavePorcentajeMerma}
                className="px-6 py-2 bg-gray-400 text-white rounded-lg cursor-not-allowed h-fit mt-6"
                disabled
              >
                En desarrollo
              </button>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-blue-800 text-sm">
                ℹ️ <strong>Información:</strong> El porcentaje de merma se aplica al crear masas desde SAP.
                Ejemplo: 100 kg base + 5% merma = 105 kg con merma.
              </p>
            </div>
          </div>
        </Card>

        {/* Notificaciones por Email */}
        <Card title="Notificaciones por Email">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Correos electrónicos que recibirán notificaciones cuando se complete el pesaje.
              Ingrese los correos separados por comas.
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Correos de empaque y bodega
                </label>
                <textarea
                  rows={3}
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                  placeholder="empaque@artesa.com, bodega@artesa.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Separe los correos con comas (,)
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                {updateCorreosMutation.isSuccess && (
                  <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Correos guardados correctamente
                  </span>
                )}
                {updateCorreosMutation.isError && (
                  <span className="flex items-center gap-1 text-red-600 text-sm font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    Error al guardar
                  </span>
                )}
                <button
                  onClick={handleSaveCorreos}
                  disabled={updateCorreosMutation.isPending}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateCorreosMutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* Insumos Propios */}
        <Card title="Insumos Propios">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Costos de insumos que no se compran directamente en SAP y no tienen validación de inventario.
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Costo del Agua por Litro (COP)
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  El agua (MP0007) no tiene stock en SAP. Su costo se usa para el cálculo de costos de producción.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costoAgua}
                    onChange={(e) => setCostoAgua(parseFloat(e.target.value) || 0)}
                    className="w-48 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                  <span className="text-sm text-gray-600">COP / Litro</span>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={async () => {
                    try {
                      await updateCostoAguaMutation.mutateAsync(costoAgua);
                      setSuccessMessage('Costo del agua actualizado correctamente');
                      setErrorMessage('');
                    } catch (error: any) {
                      setErrorMessage(error?.message || 'Error al actualizar el costo del agua');
                      setSuccessMessage('');
                    }
                  }}
                  disabled={updateCostoAguaMutation.isPending}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateCostoAguaMutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Costo del Agua 2 por Litro (COP)
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  El Agua 2 (MP0008) no tiene stock en SAP. Su costo se usa para el cálculo de costos de producción.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costoAgua2}
                    onChange={(e) => setCostoAgua2(parseFloat(e.target.value) || 0)}
                    className="w-48 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                  <span className="text-sm text-gray-600">COP / Litro</span>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={async () => {
                    try {
                      await updateCostoAgua2Mutation.mutateAsync(costoAgua2);
                      setSuccessMessage('Costo del Agua 2 actualizado correctamente');
                      setErrorMessage('');
                    } catch (error: any) {
                      setErrorMessage(error?.message || 'Error al actualizar el costo del Agua 2');
                      setSuccessMessage('');
                    }
                  }}
                  disabled={updateCostoAgua2Mutation.isPending}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateCostoAgua2Mutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* Rangos de Temperatura y Humedad */}
        <Card title="Rangos de Temperatura y Humedad (Ambiente)">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Rangos aceptables para temperatura y humedad ambiente en el área de producción.
              Se utilizan para alertas y control de calidad.
            </p>
            <div className="grid grid-cols-2 gap-6">
              {/* Temperatura */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Temperatura (°C)</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Mínima</label>
                    <input
                      type="number"
                      min="10"
                      max="35"
                      value={temperaturaMin}
                      onChange={(e) => setTemperaturaMin(parseFloat(e.target.value))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Máxima</label>
                    <input
                      type="number"
                      min="10"
                      max="35"
                      value={temperaturaMax}
                      onChange={(e) => setTemperaturaMax(parseFloat(e.target.value))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Humedad */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Humedad (%)</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Mínima</label>
                    <input
                      type="number"
                      min="30"
                      max="100"
                      value={humedadMin}
                      onChange={(e) => setHumedadMin(parseFloat(e.target.value))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Máxima</label>
                    <input
                      type="number"
                      min="30"
                      max="100"
                      value={humedadMax}
                      onChange={(e) => setHumedadMax(parseFloat(e.target.value))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSaveRangos}
                className="px-6 py-2 bg-gray-400 text-white rounded-lg cursor-not-allowed"
                disabled
              >
                En desarrollo
              </button>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-yellow-800 text-sm">
                ⚠️ <strong>Nota:</strong> La funcionalidad de configuración de rangos de temperatura
                y humedad está en desarrollo y será implementada en una futura actualización.
              </p>
            </div>
          </div>
        </Card>

        {/* Tipos de Masa — Fase Formado */}
        <Card title="Tipos de Masa">
          <div className="space-y-4">
            <p className="text-gray-600 text-sm">
              Configura qué tipos de masa requieren el proceso de formado manual.
              Los tipos sin configurar se tratan como "no requiere formado".
            </p>
            <div className="flex items-center justify-between gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex-1">
                <p className="text-blue-800 text-sm">
                  ℹ️ Si un tipo de masa <strong>no requiere formado</strong>, al completar División
                  el sistema avanza automáticamente a Fermentación.
                </p>
              </div>
              <button
                onClick={() => setShowModalFormado(true)}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
              >
                Configurar Fase Formado
              </button>
            </div>
          </div>
        </Card>

        {showModalFormado && <ModalFormado onClose={() => setShowModalFormado(false)} />}

        {/* Información del sistema */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Información del sistema</h3>
          <div className="space-y-1 text-sm text-gray-600">
            <p>• Los cambios en la configuración se aplican inmediatamente al sistema</p>
            <p>• El factor de absorción se usa en la planificación de masas desde SAP</p>
            <p>• Las notificaciones se envían automáticamente al completar el pesaje</p>
            <p>• La merma actual es fija (5%) pero se está desarrollando configuración dinámica</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfiguracionSistema;
