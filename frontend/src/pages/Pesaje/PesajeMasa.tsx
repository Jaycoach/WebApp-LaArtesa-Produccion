import React from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common';

export const PesajeMasa: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pesaje de Masa</h1>
        <p className="text-gray-600">ID: {masaId}</p>
      </div>

      <Card title="Checklist de Pesaje">
        <p className="text-gray-500">Checklist no disponible</p>
      </Card>

      <Card title="Ingredientes a Pesar">
        <p className="text-gray-500">Sin ingredientes</p>
      </Card>
    </div>
  );
};

export default PesajeMasa;
