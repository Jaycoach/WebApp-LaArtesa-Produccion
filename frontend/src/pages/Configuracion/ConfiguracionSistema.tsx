import React from 'react';
import { Card } from '@/components/common';

export const ConfiguracionSistema: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuración del Sistema</h1>
        <p className="text-gray-600">Gestiona los parámetros globales</p>
      </div>

      <Card title="Factor de Absorción">
        <p className="text-gray-500">No configurado</p>
      </Card>

      <Card title="Rangos de Temperatura y Humedad">
        <p className="text-gray-500">No configurado</p>
      </Card>

      <Card title="Notificaciones por Email">
        <p className="text-gray-500">No configurado</p>
      </Card>

      <Card title="Turnos de Trabajo">
        <p className="text-gray-500">No configurado</p>
      </Card>
    </div>
  );
};

export default ConfiguracionSistema;
