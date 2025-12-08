const morgan = require('morgan');
const logger = require('../utils/logger');
const config = require('../config');

// Configurar formato de Morgan según entorno
const format = config.server.env === 'production' 
  ? 'combined' 
  : 'dev';

// Crear middleware de Morgan
const requestLogger = morgan(format, {
  stream: logger.stream,
  skip: (req) => {
    // Omitir health checks
    return req.url === '/health';
  },
});

// Middleware adicional para capturar detalles de la request
const detailedRequestLogger = (req, res, next) => {
  const start = Date.now();

  // Capturar cuando la respuesta finaliza
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Solo loguear requests lentas en producción (>1000ms)
    if (config.server.env === 'production' && duration < 1000) {
      return;
    }

    const logData = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
    };

    // Log con nivel apropiado
    if (res.statusCode >= 500) {
      logger.error('Server error on request', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Client error on request', logData);
    } else if (duration > 1000) {
      logger.warn('Slow request detected', logData);
    } else {
      logger.debug('Request completed', logData);
    }
  });

  next();
};

module.exports = config.server.env === 'development' 
  ? [requestLogger, detailedRequestLogger]
  : requestLogger;
