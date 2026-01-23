import React from 'react';
import { Card } from '@/components/common';

export const PlanificacionProduccion: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Planificación de Producción</h1>
        <p className="text-gray-600">Organiza y planifica la producción del día</p>
      </div>

      <Card title="Vista de Planificación">
        <p className="text-gray-500 text-center py-8">
          Selecciona una fecha para ver la planificación
        </p>
      </Card>
    </div>
  );
};

export default PlanificacionProduccion;
