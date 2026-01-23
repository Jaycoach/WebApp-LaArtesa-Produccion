/**
 * Configuración base de la API
 */

export const API_CONFIG = {
  // Base URL de la API - cambiar según el entorno
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',

  // Timeouts
  TIMEOUT: 30000, // 30 segundos

  // Endpoints principales
  ENDPOINTS: {
    // Autenticación
    AUTH: {
      LOGIN: '/auth/login',
      LOGOUT: '/auth/logout',
      REFRESH: '/auth/refresh',
      ME: '/auth/me',
    },

    // Masas
    MASAS: {
      BASE: '/masas',
      LIST: '/masas', // Lista de masas (puede filtrar por fecha con query params)
      BY_DATE: '/masas/fecha',
      DETAIL: (id: number) => `/masas/${id}`,
      PRODUCTOS: (id: number) => `/masas/${id}/productos`,
      COMPOSICION: (id: number) => `/masas/${id}/composicion`,
      UPDATE_PRODUCTO: (masaId: number, productoId: number) =>
        `/masas/${masaId}/productos/${productoId}`,
    },

    // Checklist
    CHECKLIST: {
      BASE: '/checklist',
      BY_MASA: (masaId: string) => `/checklist/${masaId}`,
      UPDATE: (masaId: string) => `/checklist/${masaId}`,
    },

    // Configuración
    CONFIG: {
      BASE: '/config',
      FACTOR_ABSORCION: '/config/factor-absorcion',
      CORREOS: '/config/correos',
    },

    // Fases de producción
    FASES: {
      BASE: '/fases',
      BY_MASA: (masaId: string) => `/fases/${masaId}`,
      UPDATE_PROGRESO: (masaId: string) => `/fases/${masaId}/progreso`,
      COMPLETAR_FASE: (masaId: string, fase: string) => `/fases/${masaId}/${fase}/completar`,
    },

    // SAP
    SAP: {
      SINCRONIZAR: '/sap/sincronizar',
      ORDENES: '/sap/ordenes',
    },
  },

  // Headers por defecto
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
};

// Tipos de fases
export enum FaseProduccion {
  PESAJE = 'pesaje',
  AMASADO = 'amasado',
  DIVISION = 'division',
  FORMADO = 'formado',
  FERMENTACION = 'fermentacion',
  HORNEADO = 'horneado',
}

// Estados de las masas
export enum EstadoMasa {
  PENDIENTE = 'pendiente',
  EN_PROCESO = 'en_proceso',
  COMPLETADA = 'completada',
  CANCELADA = 'cancelada',
}

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Mensajes de error y éxito
export const MESSAGES = {
  SUCCESS: {
    CREATED: 'Registro creado exitosamente',
    UPDATED: 'Registro actualizado exitosamente',
    DELETED: 'Registro eliminado exitosamente',
    SAVED: 'Cambios guardados correctamente',
  },
  ERROR: {
    NETWORK: 'Error de conexión. Por favor, verifica tu conexión a internet.',
    UNAUTHORIZED: 'Sesión expirada. Por favor, inicia sesión nuevamente.',
    FORBIDDEN: 'No tienes permisos para realizar esta acción.',
    NOT_FOUND: 'El recurso solicitado no fue encontrado.',
    SERVER: 'Error del servidor. Por favor, intenta nuevamente más tarde.',
    UNKNOWN: 'Ocurrió un error inesperado. Por favor, intenta nuevamente.',
    VALIDATION: 'Por favor, verifica los datos ingresados.',
  },
} as const;
