import React from 'react';
import { useParams } from 'react-router-dom';
import { Card, Button } from '@/components/common';

export const ConfirmarPesaje: React.FC = () => {
  const { masaId } = useParams<{ masaId: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Confirmar Pesaje</h1>
        <p className="text-gray-600">ID: {masaId}</p>
      </div>

      <Card title="Resumen del Pesaje">
        <p className="text-gray-500">Cargando...</p>

        <div className="mt-6 flex gap-4">
          <Button variant="success">
            Confirmar Pesaje
          </Button>
          <Button variant="outline">
            Cancelar
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default ConfirmarPesaje;
