/**
 * Constantes globales de la aplicación
 */

/**
 * Turnos de trabajo
 */
export const TURNOS = [
  { value: 'mañana', label: 'Mañana' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noche', label: 'Noche' },
] as const;

/**
 * Estados de masa
 */
export const ESTADOS_MASA = [
  { value: 'pendiente', label: 'Pendiente', color: 'yellow' },
  { value: 'en_proceso', label: 'En Proceso', color: 'blue' },
  { value: 'completada', label: 'Completada', color: 'green' },
  { value: 'cancelada', label: 'Cancelada', color: 'red' },
] as const;

/**
 * Fases de producción
 */
export const FASES_PRODUCCION = [
  { value: 'pesaje', label: 'Pesaje', orden: 1 },
  { value: 'amasado', label: 'Amasado', orden: 2 },
  { value: 'division', label: 'División', orden: 3 },
  { value: 'formado', label: 'Formado', orden: 4 },
  { value: 'fermentacion', label: 'Fermentación', orden: 5 },
  { value: 'horneado', label: 'Horneado', orden: 6 },
] as const;

/**
 * Unidades de medida
 */
export const UNIDADES = [
  { value: 'kg', label: 'Kilogramos (kg)' },
  { value: 'g', label: 'Gramos (g)' },
  { value: 'l', label: 'Litros (l)' },
  { value: 'ml', label: 'Mililitros (ml)' },
  { value: 'unidades', label: 'Unidades' },
  { value: 'piezas', label: 'Piezas' },
] as const;

/**
 * Tipos de ingredientes
 */
export const TIPOS_INGREDIENTE = [
  { value: 'harina', label: 'Harina', icon: '🌾' },
  { value: 'agua', label: 'Agua', icon: '💧' },
  { value: 'sal', label: 'Sal', icon: '🧂' },
  { value: 'levadura', label: 'Levadura', icon: '🦠' },
  { value: 'otro', label: 'Otro', icon: '📦' },
] as const;

/**
 * Roles de usuario
 */
export const ROLES_USUARIO = [
  { value: 'admin', label: 'Administrador' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'operador', label: 'Operador' },
] as const;

/**
 * Límites de temperatura ambiente (°C)
 */
export const TEMPERATURA_AMBIENTE = {
  MIN: 15,
  MAX: 35,
  OPTIMA_MIN: 20,
  OPTIMA_MAX: 28,
} as const;

/**
 * Límites de humedad ambiente (%)
 */
export const HUMEDAD_AMBIENTE = {
  MIN: 0,
  MAX: 100,
  OPTIMA_MIN: 60,
  OPTIMA_MAX: 80,
} as const;

/**
 * Factor de absorción
 */
export const FACTOR_ABSORCION = {
  MIN: 0.5,
  MAX: 1.0,
  DEFAULT: 0.65,
} as const;

/**
 * Límites de peso (kg)
 */
export const PESO_LIMITES = {
  MIN: 0.001,
  MAX: 10000,
} as const;

/**
 * Configuración de paginación
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
} as const;

/**
 * Tiempos de actualización (ms)
 */
export const REFRESH_INTERVALS = {
  MASAS: 30000, // 30 segundos
  FASES: 15000, // 15 segundos
  DASHBOARD: 60000, // 1 minuto
} as const;

/**
 * Formatos de fecha
 */
export const DATE_FORMATS = {
  DISPLAY: 'dd/MM/yyyy',
  DISPLAY_TIME: 'dd/MM/yyyy HH:mm',
  API: 'yyyy-MM-dd',
  TIME: 'HH:mm',
} as const;

/**
 * Colores del tema
 */
export const THEME_COLORS = {
  primary: '#ef4444',
  secondary: '#64748b',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
} as const;

/**
 * Mensajes de error comunes
 */
export const ERROR_MESSAGES = {
  NETWORK: 'Error de conexión. Verifica tu conexión a internet.',
  UNAUTHORIZED: 'No tienes permisos para realizar esta acción.',
  NOT_FOUND: 'Recurso no encontrado.',
  SERVER_ERROR: 'Error del servidor. Intenta nuevamente más tarde.',
  VALIDATION: 'Por favor, verifica los datos ingresados.',
  REQUIRED_FIELD: 'Este campo es requerido.',
} as const;

/**
 * Mensajes de éxito comunes
 */
export const SUCCESS_MESSAGES = {
  CREATED: 'Creado exitosamente.',
  UPDATED: 'Actualizado exitosamente.',
  DELETED: 'Eliminado exitosamente.',
  SAVED: 'Guardado exitosamente.',
} as const;

/**
 * Configuración de la aplicación
 */
export const APP_CONFIG = {
  NAME: 'La Artesa - Control de Producción',
  VERSION: '1.0.0',
  AUTHOR: 'MASORG',
  COPYRIGHT: `© ${new Date().getFullYear()} La Artesa`,
} as const;
