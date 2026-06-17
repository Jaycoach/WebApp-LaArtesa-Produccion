import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store';
import { Button, Alert } from '@/components/common';
import { authService } from '@/services/authService';

type Paso = 'login' | 'solicitar-email' | 'email-enviado';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState(searchParams.get('username') || '');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [paso, setPaso] = useState<Paso>('login');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const result = await authService.login({ username, password });
      login(result.user, result.token);
      navigate('/');
    } catch (err: any) {
      if (err.code === 'EMAIL_NOT_VERIFIED' || err.message?.includes('verificar tu correo')) {
        setPaso('solicitar-email');
      } else {
        setError(err.message || 'Credenciales inválidas. Por favor, intenta nuevamente.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSolicitarVerificacion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await authService.requestEmailVerification(username, email);
      setPaso('email-enviado');
    } catch (err: any) {
      setError(err.message || 'Error al enviar el correo de verificación');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Logo */}
        <div>
          <div className="flex justify-center">
            <img src="/Orbit_LogoVertical.jpeg" alt="Orbit Producción Artesa" className="h-32 w-auto" />
          </div>
          <p className="mt-2 text-center text-sm text-gray-600">
            Control de Producción
          </p>
        </div>

        {/* PASO 1: Login normal */}
        {paso === 'login' && (
          <form className="mt-8 space-y-6" onSubmit={handleLogin}>
            {error && <Alert variant="error">{error}</Alert>}
            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="username" className="sr-only">Usuario</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                  placeholder="Usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password" className="sr-only">Contraseña</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                  placeholder="Contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
              Iniciar Sesión
            </Button>
            <div className="text-center">
              <Link to="/forgot-password" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          </form>
        )}

        {/* PASO 2: Captura de email para verificación */}
        {paso === 'solicitar-email' && (
          <div className="mt-8 space-y-6">
            <div className="rounded-md bg-amber-50 border border-amber-200 p-4">
              <div className="flex items-start gap-3">
                <span className="text-amber-500 text-xl mt-0.5">✉️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Verificación de correo requerida</p>
                  <p className="text-sm text-amber-700 mt-1">
                    Para continuar, ingresa tu correo electrónico. Te enviaremos un enlace de activación.
                  </p>
                </div>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSolicitarVerificacion}>
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
                  autoFocus
                />
              </div>
              <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
                Enviar enlace de verificación
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setPaso('login'); setError(''); }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Volver al inicio de sesión
                </button>
              </div>
            </form>
          </div>
        )}

        {/* PASO 3: Confirmación enviado */}
        {paso === 'email-enviado' && (
          <div className="mt-8 space-y-4 text-center">
            <div className="flex justify-center">
              <div className="rounded-full bg-green-100 p-4">
                <svg className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900">¡Revisa tu correo!</h2>
            <Alert variant="success">
              Enviamos un enlace de verificación a <strong>{email}</strong>.
              Haz clic en el enlace para activar tu cuenta.
            </Alert>
            <p className="text-sm text-gray-500">
              El enlace expira en 24 horas. Revisa también tu carpeta de spam.
            </p>
            <div className="text-center pt-2">
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

export default Login;
