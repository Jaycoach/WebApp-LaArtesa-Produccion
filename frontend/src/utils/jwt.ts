/**
 * Decodificación de JWT en el cliente — SOLO para leer claims (id, rol, iat),
 * nunca para validar autenticidad (eso lo hace el backend). No lanza: ante
 * cualquier token malformado devuelve null, para que el caller nunca actúe
 * sobre un valor ambiguo.
 */
export interface JwtPayload {
  id?: number;
  username?: string;
  email?: string;
  rol?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}
