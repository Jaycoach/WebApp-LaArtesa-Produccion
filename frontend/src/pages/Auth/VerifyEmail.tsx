import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Alert } from '@/components/common';
import { authService } from '@/services/authService';

type Estado = 'verificando' | 'ok' | 'error';

export const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [estado, setEstado] = useState<Estado>('verificando');
  const [nombre, setNombre] = useState('');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    if (!token) {
      setEstado('error');
      setMensaje('Enlace inválido o incompleto.');
      return;
    }

    authService.verifyEmail(token)
      .then((data) => {
        setNombre(data.nombre);
        setEstado('ok');
      })
      .catch((err) => {
        setMensaje(err.message || 'El enlace es inválido o ya fue utilizado.');
        setEstado('error');
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <img src="/Logo_Artesa.png" alt="La Artesa" className="h-24 w-auto" />
        </div>

        {estado === 'verificando' && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
            </div>
            <p className="text-gray-600">Verificando tu correo...</p>
          </div>
        )}

        {estado === 'ok' && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-100 p-4">
                <svg className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">¡Correo verificado!</h2>
            <Alert variant="success">
              Hola {nombre}, tu correo fue verificado exitosamente.
              Un administrador activará tu cuenta pronto.
            </Alert>
            <p className="text-sm text-gray-500">
              Recibirás una notificación cuando tu cuenta esté lista.
            </p>
          </div>
        )}

        {estado === 'error' && (
          <div className="space-y-4">
            <Alert variant="error">{mensaje}</Alert>
            <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              ← Volver al inicio de sesión
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
