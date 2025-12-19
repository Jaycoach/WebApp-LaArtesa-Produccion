/**
 * Middleware de Manejo de Errores
 */

const logger = require('../utils/logger');
const config = require('../config');

/**
 * Clase de error personalizada
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware principal de manejo de errores
 */
const errorHandler = (err, req, res) => {
  const statusCode = err.statusCode || 500;
  const isDevelopment = config.server.env === 'development';

  // Contexto común del error
  const errorContext = {
    message: err.message,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    user: req.user?.id || 'anonymous',
    timestamp: new Date().toISOString(),
  };

  // Log del error con diferenciación por severidad
  if (statusCode >= 500) {
    logger.error('🔴 Error del servidor:', {
      ...errorContext,
      stack: err.stack,
      code: err.code,
    });
  } else {
    logger.warn('🟡 Error del cliente:', {
      ...errorContext,
      statusCode,
    });
  }

  // Errores específicos de PostgreSQL
  if (err.code && err.code.startsWith('23')) {
    // La función handleDatabaseError está definida abajo
    const errorMap = {
      23505: {
        statusCode: 409,
        message: 'El recurso ya existe',
      },
      23503: {
        statusCode: 400,
        message: 'Referencia inválida a otro registro',
      },
      23502: {
        statusCode: 400,
        message: 'Campo requerido faltante',
      },
      23514: {
        statusCode: 400,
        message: 'Datos inválidos',
      },
    };

    const error = errorMap[err.code] || {
      statusCode: 500,
      message: 'Error de base de datos',
    };

    const response = {
      status: 'fail',
      message: error.message,
      ...(isDevelopment && {
        code: err.code,
        detail: err.detail || (err.constraint ? `Constraint violada: ${err.constraint}` : undefined),
      }),
    };

    return res.status(error.statusCode).json(response);
  }

  // Errores de JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'fail',
      message: 'Token inválido. Por favor inicie sesión nuevamente.',
      ...(isDevelopment && { error: err.message }),
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'fail',
      message: 'Su sesión ha expirado. Por favor inicie sesión nuevamente.',
      code: 'TOKEN_EXPIRED',
      ...(isDevelopment && { error: err.message }),
    });
  }

  // Errores de validación
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      status: 'fail',
      message: 'Error de validación',
      errors: err.errors,
    });
  }

  // Errores personalizados con statusCode
  if (err.isOperational) {
    return res.status(statusCode).json({
      status: statusCode < 500 ? 'fail' : 'error',
      message: err.message,
      ...(isDevelopment && { stack: err.stack }),
    });
  }

  // Error genérico de servidor
  logger.error('❌ ERROR NO OPERACIONAL:', {
    ...errorContext,
    stack: err.stack,
  });

  return res.status(500).json({
    status: 'error',
    message: isDevelopment ? err.message : 'Ocurrió un error en el servidor',
    ...(isDevelopment && { stack: err.stack, name: err.name }),
  });
};

/**
 * Middleware para errores 404
 */
const notFound = (req, res, next) => {
  const error = new AppError(
    `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    404,
  );
  return next(error);
};

module.exports = {
  errorHandler,
  notFound,
  AppError,
};
