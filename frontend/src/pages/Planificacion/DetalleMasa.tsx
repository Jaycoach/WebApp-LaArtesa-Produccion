import React from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common';

export const DetalleMasa: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Detalle de Masa</h1>
        <p className="text-gray-600">ID: {id}</p>
      </div>

      <Card title="Información General">
        <p className="text-gray-500">Cargando...</p>
      </Card>

      <Card title="Productos">
        <p className="text-gray-500">Sin productos</p>
      </Card>

      <Card title="Composición de Ingredientes">
        <p className="text-gray-500">Sin ingredientes</p>
      </Card>
    </div>
  );
};

export default DetalleMasa;
