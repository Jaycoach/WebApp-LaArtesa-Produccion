/**
 * Sesión única por usuario: cuando el backend responde 401 con code SESSION_REPLACED, la sesión de
 * este navegador fue cerrada (otro inicio de sesión, cambio de contraseña o revocación). El interceptor
 * de api.ts limpia la sesión y manda a /login con UN aviso persistente (ver utils/avisoSesion.ts).
 *
 * Aquí solo vive la detección del code; el aviso y su texto por motivo están en avisoSesion.ts.
 */

export const CODIGO_SESION_REEMPLAZADA = 'SESSION_REPLACED';

/** ¿El cuerpo de un 401 indica que la sesión fue reemplazada? */
export function esSesionReemplazada(cuerpo: unknown): boolean {
  return !!cuerpo && typeof cuerpo === 'object'
    && (cuerpo as { code?: unknown }).code === CODIGO_SESION_REEMPLAZADA;
}
