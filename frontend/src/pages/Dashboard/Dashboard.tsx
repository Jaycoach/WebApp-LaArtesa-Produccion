import React from 'react';
import { Card } from '@/components/common';

export const Dashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Vista general del control de producción</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-500">Masas del Día</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">0</p>
          </div>
        </Card>

        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-500">En Proceso</p>
            <p className="text-3xl font-bold text-blue-600 mt-2">0</p>
          </div>
        </Card>

        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-500">Completadas</p>
            <p className="text-3xl font-bold text-green-600 mt-2">0</p>
          </div>
        </Card>

        <Card>
          <div className="text-center">
            <p className="text-sm text-gray-500">Pendientes</p>
            <p className="text-3xl font-bold text-yellow-600 mt-2">0</p>
          </div>
        </Card>
      </div>

      <Card title="Producción Reciente">
        <p className="text-gray-500 text-center py-8">
          No hay datos de producción disponibles
        </p>
      </Card>
    </div>
  );
};

export default Dashboard;
