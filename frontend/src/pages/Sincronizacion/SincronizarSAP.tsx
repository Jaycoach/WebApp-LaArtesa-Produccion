import React from 'react';
import { Card, Button } from '@/components/common';

export const SincronizarSAP: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sincronizar con SAP</h1>
        <p className="text-gray-600">Importar órdenes de producción desde SAP</p>
      </div>

      <Card title="Sincronización de Órdenes">
        <div className="space-y-4">
          <p className="text-gray-600">
            Importa las órdenes de producción desde SAP para el día seleccionado
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fecha
            </label>
            <input
              type="date"
              className="input max-w-xs"
              defaultValue={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div className="flex gap-4">
            <Button variant="primary">
              Sincronizar Órdenes
            </Button>
            <Button variant="outline">
              Ver Historial
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SincronizarSAP;
