/**
 * Sesión única por usuario: cuando el backend responde 401 con code SESSION_REPLACED, la sesión
 * de este navegador fue cerrada porque el mismo usuario inició sesión en otro dispositivo o
 * navegador. El interceptor limpia la sesión y recarga /login; como esa recarga borra el estado de
 * React, el aviso se deja en sessionStorage y la pantalla de login lo LEE Y BORRA (se ve una sola vez).
 *
 * Lógica pura (el storage se inyecta) para poder probarla sin navegador.
 */

export const CODIGO_SESION_REEMPLAZADA = 'SESSION_REPLACED';

export const MENSAJE_SESION_REEMPLAZADA =
  'Tu sesión se cerró porque iniciaste sesión en otro dispositivo o navegador';

const CLAVE_AVISO = 'aviso_sesion_reemplazada';

type StorageMinimo = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storagePorDefecto = (): StorageMinimo | undefined => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  } catch {
    return undefined; // acceso bloqueado (modo privado, políticas del navegador)
  }
};

/** ¿El cuerpo de un 401 indica que la sesión fue reemplazada? */
export function esSesionReemplazada(cuerpo: unknown): boolean {
  return !!cuerpo && typeof cuerpo === 'object'
    && (cuerpo as { code?: unknown }).code === CODIGO_SESION_REEMPLAZADA;
}

/** Deja el aviso para la próxima carga de /login. Idempotente: varias peticiones fallando a la vez dejan UN aviso. */
export function marcarAvisoSesionReemplazada(storage: StorageMinimo | undefined = storagePorDefecto()): void {
  try {
    storage?.setItem(CLAVE_AVISO, '1');
  } catch {
    /* sin storage no hay aviso, pero la sesión se cierra igual */
  }
}

/** Devuelve el mensaje UNA sola vez (lo borra al leerlo); '' si no hay aviso pendiente. */
export function consumirAvisoSesionReemplazada(storage: StorageMinimo | undefined = storagePorDefecto()): string {
  try {
    if (storage && storage.getItem(CLAVE_AVISO) === '1') {
      storage.removeItem(CLAVE_AVISO);
      return MENSAJE_SESION_REEMPLAZADA;
    }
  } catch {
    /* ignorar */
  }
  return '';
}
