import React from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common';

export const AmasadoMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Amasado</h1>
        <p className="text-gray-600">ID: {masaId}</p>
      </div>

      <Card title="Control de Amasado">
        <p className="text-gray-500">Funcionalidad en desarrollo - Fase 2</p>
      </Card>
    </div>
  );
};

export default AmasadoMasa;
