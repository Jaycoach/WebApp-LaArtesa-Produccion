import React, { useState } from 'react';
import { Modal, Button, Alert } from '@/components/common';
import { apiService } from '@/services/api';
import { API_CONFIG } from '@/config/api.config';
import { evaluarReglasPassword, passwordCumpleReglas } from '@/utils/reglasPassword';

interface UsuarioObjetivo {
  id: number;
  username: string;
  nombre_completo: string;
}

interface Props {
  usuario: UsuarioObjetivo | null;
  onClose: () => void;
  /** Se llama tras asignar la clave temporal con éxito (la lista se refresca desde el padre). */
  onHecho: () => void;
}

/** Texto legible de un error del backend (400 con lista de campos, 403, red, etc.). */
export function mensajeErrorBackend(e: any): string {
  const detalles = Array.isArray(e?.errors) && e.errors.length > 0
    ? e.errors.map((x: any) => x?.message).filter(Boolean).join(' · ')
    : '';
  return detalles || e?.message || 'No se pudo restablecer la contraseña. Intenta de nuevo.';
}

/**
 * Modal propio de la app para que un ADMIN asigne una clave TEMPORAL a otro usuario.
 * El usuario deberá cambiarla en su primer ingreso y todas sus sesiones se cierran.
 */
export const ModalRestablecerPassword: React.FC<Props> = ({ usuario, onClose, onHecho }) => {
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const reglas = evaluarReglasPassword(clave);
  const coincide = confirmacion.length > 0 && clave === confirmacion;

  const limpiar = () => {
    setClave(''); setConfirmacion(''); setMostrar(false); setError('');
  };

  const cerrar = () => {
    if (enviando) return;
    limpiar();
    onClose();
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario) return;
    setError('');
    if (!passwordCumpleReglas(clave)) {
      setError('La clave temporal no cumple todas las reglas de contraseña.');
      return;
    }
    if (clave !== confirmacion) {
      setError('La confirmación no coincide con la clave temporal.');
      return;
    }
    setEnviando(true);
    try {
      const res = await apiService.post(API_CONFIG.ENDPOINTS.USERS.RESET_PASSWORD(usuario.id), { newPassword: clave });
      if (!res.success) {
        setError(res.message || 'No se pudo restablecer la contraseña.');
        return;
      }
      limpiar();
      onHecho();
    } catch (err: any) {
      setError(mensajeErrorBackend(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen={!!usuario} onClose={cerrar} title="Restablecer contraseña" size="sm">
      {usuario && (
        <form onSubmit={enviar} className="space-y-4" autoComplete="off">
          <p className="text-sm text-gray-600">
            Asigna una clave <strong>temporal</strong> a <strong>{usuario.nombre_completo}</strong> (@{usuario.username}).
            Deberá cambiarla en su primer ingreso y se cerrarán todas sus sesiones.
          </p>

          <div>
            <label htmlFor="clave-temporal" className="block text-sm font-medium text-gray-700 mb-1">Clave temporal</label>
            <div className="flex gap-2">
              <input
                id="clave-temporal"
                type={mostrar ? 'text' : 'password'}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                autoComplete="new-password"
                className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                type="button"
                onClick={() => setMostrar((v) => !v)}
                aria-pressed={mostrar}
                className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {mostrar ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </div>

          <ul className="space-y-1 text-xs" aria-label="Reglas de la contraseña">
            {reglas.map((r) => (
              <li key={r.id} className={r.cumple ? 'text-green-700' : 'text-gray-500'}>
                <span aria-hidden="true">{r.cumple ? '✓' : '○'}</span> {r.texto}
              </li>
            ))}
          </ul>

          <div>
            <label htmlFor="clave-confirmacion" className="block text-sm font-medium text-gray-700 mb-1">Confirmar clave temporal</label>
            <input
              id="clave-confirmacion"
              type={mostrar ? 'text' : 'password'}
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            />
            {confirmacion.length > 0 && (
              <p className={`text-xs mt-1 ${coincide ? 'text-green-700' : 'text-red-600'}`}>
                {coincide ? 'Las claves coinciden' : 'Las claves no coinciden'}
              </p>
            )}
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={cerrar} disabled={enviando}>Cancelar</Button>
            <Button type="submit" variant="primary" isLoading={enviando} disabled={!passwordCumpleReglas(clave) || !coincide}>
              Asignar clave temporal
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default ModalRestablecerPassword;
