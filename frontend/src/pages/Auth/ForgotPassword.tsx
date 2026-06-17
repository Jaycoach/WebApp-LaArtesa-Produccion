import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Alert } from '@/components/common';
import { authService } from '@/services/authService';

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await authService.forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Error al enviar el correo');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <img src="/Orbit_LogoVertical.jpeg" alt="Orbit Producción Artesa" className="h-32 w-auto" />
          </div>
          <h2 className="mt-4 text-center text-2xl font-bold text-gray-900">
            Recuperar contraseña
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <Alert variant="success">
              Si ese correo está registrado, recibirás un enlace en los próximos minutos.
              Revisa también tu carpeta de spam.
            </Alert>
            <div className="text-center">
              <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                ← Volver al inicio de sesión
              </Link>
            </div>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {error && <Alert variant="error">{error}</Alert>}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="tu@correo.com"
              />
            </div>
            <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
              Enviar enlace de recuperación
            </Button>
            <div className="text-center">
              <Link to="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                ← Volver al inicio de sesión
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
