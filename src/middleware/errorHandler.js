const logger = require('../utils/logger');
const config = require('../config');

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log del error
  if (err.statusCode >= 500) {
    logger.error('Error del servidor:', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
      user: req.user?.id,
    });
  } else {
    logger.warn('Error del cliente:', {
      error: err.message,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
  }

  // Errores específicos de PostgreSQL
  if (err.code && err.code.startsWith('23')) {
    return handleDatabaseError(err, req, res);
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'fail',
      message: 'Token inválido. Por favor inicie sesión nuevamente.',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'fail',
      message: 'Su sesión ha expirado. Por favor inicie sesión nuevamente.',
    });
  }

  // Validation Errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      status: 'fail',
      message: 'Error de validación',
      errors: err.errors,
    });
  }

  // Respuesta de desarrollo
  if (config.server.env === 'development') {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
    });
  }

  // Respuesta de producción
  // Errores operacionales confiables: enviar mensaje al cliente
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  // Errores de programación u otros errores desconocidos: no filtrar detalles
  logger.error('ERROR NO OPERACIONAL:', err);
  
  return res.status(500).json({
    status: 'error',
    message: 'Ocurrió un error en el servidor',
  });
};

const handleDatabaseError = (err, req, res) => {
  const errors = {
    // Violación de unique constraint
    '23505': {
      status: 409,
      message: 'El registro ya existe',
    },
    // Violación de foreign key
    '23503': {
      status: 400,
      message: 'Referencia inválida a otro registro',
    },
    // Violación de not null
    '23502': {
      status: 400,
      message: 'Campo requerido faltante',
    },
    // Violación de check constraint
    '23514': {
      status: 400,
      message: 'Datos inválidos',
    },
  };

  const error = errors[err.code] || {
    status: 500,
    message: 'Error de base de datos',
  };

  // Extraer detalles adicionales si es posible
  let detail = '';
  if (err.detail) {
    detail = err.detail;
  } else if (err.constraint) {
    detail = `Constraint violada: ${err.constraint}`;
  }

  return res.status(error.status).json({
    status: 'fail',
    message: error.message,
    ...(config.server.env === 'development' && { detail, code: err.code }),
  });
};

module.exports = errorHandler;
module.exports.AppError = AppError;
