/**
 * Aviso de SESIÓN CERRADA que se muestra sobre el formulario de /login.
 *
 * Es un mecanismo distinto e independiente del aviso de "nueva versión" (hooks/useVersionCheck +
 * banner de App.tsx): aquel no usa ningún storage y recarga con window.location.reload(); este vive en
 * sessionStorage bajo su propia clave, solo lo lee/escribe este módulo y NUNCA lo borra una recarga.
 *
 * Ciclo de vida: lo deja el cierre de sesión (interceptor de api.ts o guarda de otra pestaña), la pantalla
 * de login lo LEE sin borrarlo y solo se elimina cuando el usuario pulsa «Entendido» o inicia sesión con
 * éxito. Así sobrevive a cualquier recarga (incluida la que provoca el aviso de nueva versión).
 *
 * Lógica pura (el storage se inyecta) para poder probarla sin navegador.
 */

export type MotivoAviso = 'OTRO_INICIO' | 'CAMBIO_PASSWORD' | 'SESION_CERRADA' | 'OTRA_PESTANA';

export interface AvisoSesion {
  motivo: MotivoAviso;
  /** Usuario cuya sesión se cerró (se muestra en negrita); se omite si no se conoce. */
  username?: string;
}

/** Fragmento de texto del aviso; `negrita` marca el nombre de usuario. */
export interface FragmentoAviso {
  texto: string;
  negrita?: boolean;
}

export interface ContenidoAviso {
  titulo: string;
  fragmentos: FragmentoAviso[];
}

/** Clave propia: distinta de cualquier clave del aviso de versión (que no usa storage). */
export const CLAVE_AVISO_SESION = 'aviso_sesion_cerrada';

const MOTIVOS: readonly MotivoAviso[] = ['OTRO_INICIO', 'CAMBIO_PASSWORD', 'SESION_CERRADA', 'OTRA_PESTANA'];
const MAX_USERNAME = 100;

type StorageMinimo = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storagePorDefecto = (): StorageMinimo | undefined => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  } catch {
    return undefined; // acceso bloqueado (modo privado, políticas del navegador)
  }
};

const esMotivo = (valor: unknown): valor is MotivoAviso =>
  typeof valor === 'string' && (MOTIVOS as readonly string[]).includes(valor);

/** Normaliza el motivo que manda el backend; cualquier valor desconocido o ausente es SESION_CERRADA. */
export function motivoDesdeRespuesta(cuerpo: unknown): MotivoAviso {
  const motivo = cuerpo && typeof cuerpo === 'object' ? (cuerpo as { motivo?: unknown }).motivo : undefined;
  return esMotivo(motivo) && motivo !== 'OTRA_PESTANA' ? motivo : 'SESION_CERRADA';
}

/**
 * Deja el aviso para /login. Idempotente: varias peticiones fallando a la vez dejan UN aviso (el mismo
 * contenido). Un aviso nuevo reemplaza al anterior.
 */
export function guardarAvisoSesion(aviso: AvisoSesion, storage: StorageMinimo | undefined = storagePorDefecto()): void {
  try {
    const username = typeof aviso.username === 'string' ? aviso.username.trim().slice(0, MAX_USERNAME) : '';
    const valor: AvisoSesion = username ? { motivo: aviso.motivo, username } : { motivo: aviso.motivo };
    storage?.setItem(CLAVE_AVISO_SESION, JSON.stringify(valor));
  } catch {
    /* sin storage no hay aviso, pero la sesión se cierra igual */
  }
}

/** Lee el aviso SIN borrarlo. null si no hay uno válido. */
export function leerAvisoSesion(storage: StorageMinimo | undefined = storagePorDefecto()): AvisoSesion | null {
  try {
    const crudo = storage?.getItem(CLAVE_AVISO_SESION);
    if (!crudo) return null;
    const dato = JSON.parse(crudo) as { motivo?: unknown; username?: unknown };
    if (!dato || !esMotivo(dato.motivo)) return null;
    const username = typeof dato.username === 'string' ? dato.username.trim().slice(0, MAX_USERNAME) : '';
    return username ? { motivo: dato.motivo, username } : { motivo: dato.motivo };
  } catch {
    return null;
  }
}

/** Borra el aviso (botón «Entendido» o inicio de sesión exitoso). */
export function descartarAvisoSesion(storage: StorageMinimo | undefined = storagePorDefecto()): void {
  try {
    storage?.removeItem(CLAVE_AVISO_SESION);
  } catch {
    /* ignorar */
  }
}

/** Título y texto del aviso según el motivo. El usuario va en negrita cuando se conoce. */
export function contenidoAviso(aviso: AvisoSesion): ContenidoAviso {
  const usuario = aviso.username;
  switch (aviso.motivo) {
    case 'OTRO_INICIO':
      return {
        titulo: 'Tu sesión se cerró',
        fragmentos: [
          ...(usuario
            ? [{ texto: 'Alguien inició sesión con el usuario «' }, { texto: usuario, negrita: true }, { texto: '» en otro equipo o navegador.' }]
            : [{ texto: 'Alguien inició sesión con tu usuario en otro equipo o navegador.' }]),
          { texto: ' Por seguridad, cada usuario solo puede estar abierto en un lugar a la vez. Si no fuiste tú, avísale a tu supervisor.' },
        ],
      };
    case 'CAMBIO_PASSWORD':
      return {
        titulo: 'Tu sesión se cerró',
        fragmentos: [
          ...(usuario
            ? [{ texto: 'La contraseña del usuario «' }, { texto: usuario, negrita: true }, { texto: '» fue cambiada.' }]
            : [{ texto: 'La contraseña de tu usuario fue cambiada.' }]),
          { texto: ' Ingresa con la contraseña nueva; si no la conoces, pídela al administrador.' },
        ],
      };
    case 'OTRA_PESTANA':
      return {
        titulo: 'Tu sesión se cerró',
        fragmentos: [{ texto: 'Se inició sesión con otro usuario en este navegador. Vuelve a iniciar sesión.' }],
      };
    case 'SESION_CERRADA':
    default:
      return {
        titulo: 'Vuelve a iniciar sesión',
        fragmentos: [{ texto: 'Por seguridad, tu sesión se cerró. Ingresa de nuevo con tu usuario y contraseña.' }],
      };
  }
}
