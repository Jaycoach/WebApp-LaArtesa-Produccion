import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { authService } from '@/services/authService';
import { AvisoInformativo } from '@/components/common';

/** Por qué se le exige crear una contraseña nueva (viene del login: ALTA | TEMPORAL | VENCIMIENTO). */
const MOTIVOS_CAMBIO: Record<string, { titulo: string; texto: string; subtitulo: string }> = {
  TEMPORAL: {
    titulo: 'Contraseña temporal',
    texto: 'Tu contraseña es temporal: crea una nueva para continuar.',
    subtitulo: 'Elige una contraseña nueva',
  },
  VENCIMIENTO: {
    titulo: 'Contraseña vencida',
    texto: 'Tu contraseña venció (cada 3 meses se debe cambiar): crea una nueva para continuar.',
    subtitulo: 'Elige una contraseña nueva',
  },
  ALTA: {
    titulo: '¡Bienvenido a Orbit!',
    texto: 'Tu cuenta está lista. Crea tu contraseña personal para comenzar a usar el sistema.',
    subtitulo: 'Establece tu contraseña para comenzar',
  },
};

export const SetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const nombre = searchParams.get('nombre') || 'Usuario';
  const motivo = MOTIVOS_CAMBIO[searchParams.get('motivo') || ''] || MOTIVOS_CAMBIO.ALTA;
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setLoading(true);
    try {
      await authService.setInitialPassword(password.trim());
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      const params = new URLSearchParams(window.location.search);
      const usr = params.get('username') || '';
      navigate(`/login?password_set=1&username=${encodeURIComponent(usr)}`);
    } catch (err: any) {
      setError(err.message || 'Error al establecer la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4" style={{ background: '#F5F0E4' }}>
      <div className="max-w-md w-full space-y-6">
        <div className="flex justify-center">
          <img src="/Orbit_LogoVertical.jpeg" alt="Orbit Producción Artesa" className="h-32 w-auto" />
        </div>
        <AvisoInformativo titulo={motivo.titulo}>{motivo.texto}</AvisoInformativo>
        <div className="bg-white rounded-xl shadow p-6 sm:p-8 space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900">Hola, {nombre} 👋</h2>
            <p className="text-sm text-gray-500 mt-1">{motivo.subtitulo}</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value.trim())}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value.trim())}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Repite la contraseña"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60"
            >
              {loading ? 'Guardando...' : 'Establecer contraseña'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetPassword;
