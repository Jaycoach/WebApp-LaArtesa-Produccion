/**
 * Utilidades para forzar SIEMPRE la hora de Bogotá (America/Bogota, UTC-5, sin horario de verano)
 * sin importar cómo esté configurado el reloj/timezone del navegador o equipo del usuario.
 */

const BOGOTA_TZ = 'America/Bogota';
const BOGOTA_OFFSET = '-05:00'; // Colombia no tiene horario de verano, el offset es fijo.

/** Formatea una hora (Date, string ISO, o timestamp) en hora de Bogotá, ej. "02:30 p. m." */
export function formatBogotaTime(value: string | number | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: BOGOTA_TZ, ...opts });
}

/** Formatea una fecha en hora de Bogotá, ej. "28/07/2026" */
export function formatBogotaDate(value: string | number | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CO', { timeZone: BOGOTA_TZ, ...opts });
}

/** Formatea fecha + hora de Bogotá juntas, ej. "28/07/2026, 02:30 p. m." */
export function formatBogotaDateTime(value: string | number | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CO', { timeZone: BOGOTA_TZ, ...opts });
}

/**
 * Devuelve la fecha/hora ACTUAL en Bogotá, en formato "YYYY-MM-DDTHH:mm" listo para
 * precargar un <input type="datetime-local">. No depende del timezone del navegador:
 * calcula manualmente la hora de Bogotá a partir del instante UTC real.
 */
export function bogotaNowForDatetimeLocal(): string {
  const now = new Date();
  const bogotaMillis = now.getTime() - 5 * 60 * 60 * 1000; // UTC-5 fijo, sin DST
  const d = new Date(bogotaMillis);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * Convierte el valor "pelado" de un <input type="datetime-local"> (que el usuario ve/edita
 * como hora de Bogotá) en un string ISO con offset explícito -05:00, listo para enviar al
 * backend. Esto evita que Postgres lo interprete mal según el timezone de sesión.
 * Ej: "2026-07-28T11:26" → "2026-07-28T11:26:00-05:00"
 */
export function datetimeLocalToBogotaISO(datetimeLocalValue: string): string | undefined {
  if (!datetimeLocalValue) return undefined;
  const withSeconds = datetimeLocalValue.length === 16 ? `${datetimeLocalValue}:00` : datetimeLocalValue;
  return `${withSeconds}${BOGOTA_OFFSET}`;
}
