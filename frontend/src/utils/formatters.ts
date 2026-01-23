/**
 * Funciones de formateo de datos
 */
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Formatear fecha a formato legible en español
 */
export const formatDate = (date: string | Date, formatStr: string = 'dd/MM/yyyy'): string => {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    return format(dateObj, formatStr, { locale: es });
  } catch (error) {
    console.error('Error formateando fecha:', error);
    return '';
  }
};

/**
 * Formatear fecha y hora
 */
export const formatDateTime = (date: string | Date): string => {
  return formatDate(date, 'dd/MM/yyyy HH:mm');
};

/**
 * Formatear hora
 */
export const formatTime = (date: string | Date): string => {
  return formatDate(date, 'HH:mm');
};

/**
 * Formatear fecha relativa (hace X tiempo)
 */
export const formatRelativeDate = (date: string | Date): string => {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    const now = new Date();
    const diffInMs = now.getTime() - dateObj.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 1) return 'ahora mismo';
    if (diffInMinutes < 60) return `hace ${diffInMinutes} ${diffInMinutes === 1 ? 'minuto' : 'minutos'}`;
    if (diffInHours < 24) return `hace ${diffInHours} ${diffInHours === 1 ? 'hora' : 'horas'}`;
    if (diffInDays < 7) return `hace ${diffInDays} ${diffInDays === 1 ? 'día' : 'días'}`;

    return formatDate(dateObj);
  } catch (error) {
    console.error('Error formateando fecha relativa:', error);
    return '';
  }
};

/**
 * Formatear número con separadores de miles
 */
export const formatNumber = (num: number, decimals: number = 0): string => {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

/**
 * Formatear peso (kg)
 */
export const formatWeight = (kg: number): string => {
  return `${formatNumber(kg, 2)} kg`;
};

/**
 * Formatear porcentaje
 */
export const formatPercentage = (value: number, decimals: number = 1): string => {
  return `${formatNumber(value, decimals)}%`;
};

/**
 * Formatear temperatura
 */
export const formatTemperature = (celsius: number): string => {
  return `${formatNumber(celsius, 1)}°C`;
};

/**
 * Formatear duración en minutos
 */
export const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${mins}min`;
};

/**
 * Formatear estado de masa con color
 */
export const formatEstadoMasa = (estado: string): { text: string; color: string } => {
  const estados: Record<string, { text: string; color: string }> = {
    pendiente: { text: 'Pendiente', color: 'text-yellow-600' },
    en_proceso: { text: 'En Proceso', color: 'text-blue-600' },
    completada: { text: 'Completada', color: 'text-green-600' },
    cancelada: { text: 'Cancelada', color: 'text-red-600' },
  };

  return estados[estado] || { text: estado, color: 'text-gray-600' };
};

/**
 * Formatear turno
 */
export const formatTurno = (turno: string): string => {
  const turnos: Record<string, string> = {
    mañana: 'Mañana',
    tarde: 'Tarde',
    noche: 'Noche',
  };

  return turnos[turno] || turno;
};

/**
 * Capitalizar primera letra
 */
export const capitalize = (str: string): string => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Truncar texto
 */
export const truncate = (str: string, maxLength: number = 50): string => {
  if (!str || str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
};
