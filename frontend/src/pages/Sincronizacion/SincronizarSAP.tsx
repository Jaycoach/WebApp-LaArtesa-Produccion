import React, { useState } from 'react';
import { Card, Button } from '@/components/common';
import { useSincronizarBOM, useSincronizarSAP } from '@/hooks/useMasas';

export const SincronizarSAP: React.FC = () => {
  const [fecha, setFecha] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [forzar, setForzar] = useState<boolean>(false);

  const sincronizarBOMMutation = useSincronizarBOM();
  const sincronizarOVMutation = useSincronizarSAP();

  const handleSyncBOM = async () => {
    try {
      await sincronizarBOMMutation.mutateAsync();
    } catch {
      // error manejado por el estado de la mutation
    }
  };

  const handleSyncOV = async () => {
    try {
      await sincronizarOVMutation.mutateAsync({ fecha, forzar });
    } catch {
      // error manejado por el estado de la mutation
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sincronizar con SAP</h1>
        <p className="text-gray-600">Importar datos desde SAP Business One</p>
      </div>

      {/* Paso 1: BOM */}
      <Card title="Paso 1 — Listas de Materiales (BOM)">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Sincroniza las recetas de cada artículo desde <strong>ProductTrees SAP</strong>.
            Guarda los ingredientes y cantidades en la base de datos local.
            <br />
            <span className="text-amber-700 font-medium">
              Ejecutar antes del primer día de producción y cuando se modifiquen recetas en SAP.
            </span>
          </p>

          <Button
            variant="success"
            isLoading={sincronizarBOMMutation.isPending}
            disabled={sincronizarBOMMutation.isPending || sincronizarOVMutation.isPending}
            onClick={handleSyncBOM}
          >
            {sincronizarBOMMutation.isPending ? 'Sincronizando BOM...' : 'Sincronizar BOM'}
          </Button>

          {sincronizarBOMMutation.isSuccess && sincronizarBOMMutation.data && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-medium">✓ BOM sincronizado correctamente</p>
              <ul className="mt-2 text-sm text-green-700 space-y-1">
                <li>· {sincronizarBOMMutation.data.articulos_procesados} artículos procesados</li>
                <li>· {sincronizarBOMMutation.data.bom_sincronizados} con lista de materiales</li>
                <li>· {sincronizarBOMMutation.data.sin_bom} sin BOM en SAP</li>
              </ul>
              {sincronizarBOMMutation.data.errores && sincronizarBOMMutation.data.errores.length > 0 && (
                <p className="mt-2 text-sm text-amber-700">
                  ⚠ {sincronizarBOMMutation.data.errores.length} artículo(s) con error al procesar
                </p>
              )}
            </div>
          )}

          {sincronizarBOMMutation.isError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error al sincronizar BOM. Verifica la conexión con SAP.</p>
            </div>
          )}
        </div>
      </Card>

      {/* Paso 2: Órdenes de Venta */}
      <Card title="Paso 2 — Órdenes de Venta (diario)">
        <div className="space-y-4">
          <p className="text-gray-600 text-sm">
            Importa las Órdenes de Venta abiertas del día, agrupa por tipo de masa
            y crea las masas en estado <strong>Planificación</strong>.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fecha de producción
            </label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={forzar}
              onChange={(e) => setForzar(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <span>
              Forzar re-sincronización{' '}
              <span className="text-gray-500">(re-crea masas en Planificación, preserva las que están en producción)</span>
            </span>
          </label>

          <Button
            variant="primary"
            isLoading={sincronizarOVMutation.isPending}
            disabled={sincronizarOVMutation.isPending || sincronizarBOMMutation.isPending}
            onClick={handleSyncOV}
          >
            {sincronizarOVMutation.isPending ? 'Sincronizando...' : 'Sincronizar Órdenes de Venta'}
          </Button>

          {sincronizarOVMutation.isSuccess && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800">✓ Órdenes sincronizadas. Ve a Planificación para continuar.</p>
            </div>
          )}

          {sincronizarOVMutation.isError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">✗ Error al sincronizar órdenes. Intenta nuevamente.</p>
            </div>
          )}
        </div>
      </Card>

      {/* Orden de operación */}
      <Card title="Flujo de operación">
        <ol className="space-y-3 text-sm text-gray-700 list-decimal list-inside">
          <li>
            <strong>Sync BOM</strong> (una vez, o cuando cambian recetas en SAP) →
            carga los ingredientes de cada artículo
          </li>
          <li>
            <strong>Sync Órdenes de Venta</strong> (cada día) →
            crea las masas del día en estado Planificación
          </li>
          <li>
            Ir a <strong>Planificación</strong> → abrir cada masa →
            completar fase Planificación → los ingredientes se generan automáticamente desde el BOM
          </li>
          <li>
            Continuar con <strong>Pesaje → Amasado → División → ...</strong>
          </li>
        </ol>
      </Card>
    </div>
  );
};

export default SincronizarSAP;
