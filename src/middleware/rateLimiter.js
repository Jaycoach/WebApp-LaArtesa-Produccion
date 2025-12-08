const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

// Rate limiter global
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    error: 'Too Many Requests',
    message: config.rateLimit.message,
  },
  standardHeaders: config.rateLimit.standardHeaders,
  legacyHeaders: config.rateLimit.legacyHeaders,
  handler: (req, res) => {
    logger.logSecurity('RATE_LIMIT_EXCEEDED', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent'),
    });
    
    res.status(429).json({
      error: 'Too Many Requests',
      message: config.rateLimit.message,
      retryAfter: req.rateLimit.resetTime,
    });
  },
  skip: (req) => {
    // No aplicar rate limit a health check
    return req.path === '/health';
  },
});

// Rate limiter para autenticación (más restrictivo)
const authLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.max,
  skipSuccessfulRequests: config.authRateLimit.skipSuccessfulRequests,
  message: {
    error: 'Too Many Login Attempts',
    message: 'Demasiados intentos de autenticación. Por favor intente más tarde.',
  },
  handler: (req, res) => {
    logger.logSecurity('AUTH_RATE_LIMIT_EXCEEDED', {
      ip: req.ip,
      username: req.body.username,
      path: req.path,
    });
    
    res.status(429).json({
      error: 'Too Many Login Attempts',
      message: 'Demasiados intentos de autenticación. Por favor intente más tarde.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

// Rate limiter para operaciones SAP
const sapLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 requests por minuto
  message: {
    error: 'Too Many SAP Requests',
    message: 'Demasiadas solicitudes a SAP. Por favor espere.',
  },
});

// Rate limiter para creación de recursos
const createLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20, // 20 creaciones por minuto
  message: {
    error: 'Too Many Create Requests',
    message: 'Demasiadas solicitudes de creación. Por favor espere.',
  },
});

module.exports = {
  global: globalLimiter,
  auth: authLimiter,
  sap: sapLimiter,
  create: createLimiter,
};
