import React, { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/common';
import { authService } from '@/services/authService';

type Estado = 'verificando' | 'ok' | 'error';

export const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [estado, setEstado] = useState<Estado>('verificando');
  const [nombre, setNombre] = useState('');
  const [mensaje, setMensaje] = useState('');

  const navigate = useNavigate();

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
        if (data.debe_cambiar_password) {
          // Redirigir a set-password pasando el token de verificación como referencia
          setTimeout(() => {
            navigate(`/set-password?verified=1&nombre=${encodeURIComponent(data.nombre)}&username=${encodeURIComponent(data.username || '')}`);
          }, 1500);
        }
      })
      .catch((err) => {
        const msg = err.message && err.message !== 'Error del servidor. Por favor, intenta nuevamente más tarde.'
          ? err.message
          : 'El enlace ya fue utilizado o expiró. Si tu cuenta ya está activa, intenta iniciar sesión directamente.';
        setMensaje(msg);
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
              Hola {nombre}, tu correo fue verificado exitosamente. ¡Ya puedes iniciar sesión!
            </Alert>
            <div className="text-center pt-2">
              <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                ← Ir al inicio de sesión
              </Link>
            </div>
          </div>
        )}

        {estado === 'error' && (
          <div className="space-y-4">
            <Alert variant="error">{mensaje}</Alert>
            <div className="text-center">
              <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                ← Volver al inicio de sesión
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
