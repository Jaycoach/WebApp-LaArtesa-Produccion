import { decodeJwtPayload } from './jwt';

export interface SessionReplacedCheckInput {
  /** Clave de localStorage que cambió (de un StorageEvent) */
  key: string | null;
  /** Valor anterior de esa clave (de un StorageEvent) */
  oldValue: string | null;
  /** Valor nuevo de esa clave (de un StorageEvent) */
  newValue: string | null;
  /** ¿Esta pestaña tenía una sesión propia activa? */
  isAuthenticated: boolean;
  /** id del usuario autenticado en ESTA pestaña (fuente de verdad si no se puede decodificar el token viejo) */
  currentUserId: string | number | null | undefined;
}

/**
 * Lógica PURA (sin DOM, sin store) de la regla:
 * "¿este cambio de auth_token en localStorage, visto desde otra pestaña,
 * significa que un usuario distinto reemplazó la sesión de esta pestaña?"
 *
 * true  -> sí, tratar como sesión reemplazada (forzar logout + redirect)
 * false -> no hacer nada (ej. token de otra clave, logout en otra pestaña,
 *          esta pestaña no tenía sesión, o es un refresh del mismo usuario)
 */
export function debeTratarseComoSesionReemplazada(input: SessionReplacedCheckInput): boolean {
  const { key, oldValue, newValue, isAuthenticated, currentUserId } = input;

  if (key !== 'auth_token') return false;
  if (!newValue) return false; // logout en otra pestaña — fuera de alcance de este fix
  if (!isAuthenticated || currentUserId === null || currentUserId === undefined) return false;

  const nuevoPayload = decodeJwtPayload(newValue);
  if (!nuevoPayload || nuevoPayload.id === undefined) return false; // token no decodificable: no actuar a ciegas

  const viejoPayload = oldValue ? decodeJwtPayload(oldValue) : null;
  const mismoUsuario = viejoPayload
    ? String(viejoPayload.id) === String(nuevoPayload.id)
    : String(nuevoPayload.id) === String(currentUserId);

  return !mismoUsuario;
}
