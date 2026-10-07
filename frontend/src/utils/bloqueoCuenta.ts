import { formatBogotaDate, formatBogotaDateTime, formatBogotaTime } from './timezone';

/**
 * Estado de bloqueo de una cuenta, derivado de usuarios.bloqueado_hasta.
 *
 * La BD guarda `timestamp without time zone` en UTC y la API lo serializa como
 * ISO con "Z"; si alguna vez llegara sin zona se interpreta como UTC (nunca como
 * hora local del navegador). Todo se MUESTRA en hora de Bogotá, igual que el resto
 * de la app (utils/timezone.ts).
 */

function aFecha(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  const conZona = /(Z|[+-]\d{2}:?\d{2})$/.test(valor) ? valor : `${valor}Z`;
  const fecha = new Date(conZona);
  return isNaN(fecha.getTime()) ? null : fecha;
}

/** ¿La cuenta sigue bloqueada en este instante? (bloqueado_hasta en el futuro) */
export function cuentaBloqueada(
  bloqueadoHasta: string | Date | null | undefined,
  ahora: Date = new Date(),
): boolean {
  const fecha = aFecha(bloqueadoHasta);
  return fecha !== null && fecha.getTime() > ahora.getTime();
}

/**
 * Texto corto de la insignia: "Bloqueado hasta 14:35" (hora de Bogotá). Si el
 * bloqueo termina otro día de Bogotá se agrega la fecha: "Bloqueado hasta 14:35 (09/10/2026)".
 * Devuelve null si la cuenta no está bloqueada.
 */
export function textoBloqueo(
  bloqueadoHasta: string | Date | null | undefined,
  ahora: Date = new Date(),
): string | null {
  const fecha = aFecha(bloqueadoHasta);
  if (!fecha || !cuentaBloqueada(fecha, ahora)) return null;
  const hora = formatBogotaTime(fecha, { hour12: false });
  const mismoDia = formatBogotaDate(fecha) === formatBogotaDate(ahora);
  return mismoDia ? `Bloqueado hasta ${hora}` : `Bloqueado hasta ${hora} (${formatBogotaDate(fecha)})`;
}

/** Texto largo (tooltip): fecha y hora completas de Bogotá. */
export function detalleBloqueo(bloqueadoHasta: string | Date | null | undefined): string {
  const fecha = aFecha(bloqueadoHasta);
  return fecha ? `Bloqueada hasta ${formatBogotaDateTime(fecha, { hour12: false })} (hora de Bogotá)` : '';
}
