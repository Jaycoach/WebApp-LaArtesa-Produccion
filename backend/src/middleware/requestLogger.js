/**
 * Middleware de Request Logger
 * Logea todas las requests HTTP con detalles de respuesta
 */

const morgan = require('morgan');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Configurar Morgan según el entorno
 */
const morganFormat = config.server.env === 'production'
  ? 'combined'
  : 'dev';

const morganMiddleware = morgan(morganFormat, {
  stream: logger.stream,
  skip: (req) => /^\/(health|metrics|ping)/.test(req.url),
});

/**
 * Middleware personalizado para logging detallado de requests
 * Captura información adicional como usuario, IP, duración, etc.
 */
const detailedRequestLogger = (req, res, next) => {
  const start = Date.now();

  // Capturar cuando la respuesta finaliza
  res.on('finish', () => {
    const duration = Date.now() - start;

    // Construir objeto de datos del log con fallbacks robustos
    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
      userAgent: req.get('user-agent') || 'unknown',
      username: req.user?.username || 'anonymous',
      userId: req.user?.id || null,
    };

    // Determinar el nivel de log según el status code y duración
    if (res.statusCode >= 500) {
      logger.error('HTTP Request - Server Error', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request - Client Error', logData);
    } else if (duration > 1000) {
      logger.warn('HTTP Request - Slow Response', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  });

  next();
};

/**
 * Exportar middlewares
 * En producción: Morgan + Logger detallado
 * En desarrollo: Morgan + Logger detallado + debug adicional
 */
module.exports = [morganMiddleware, detailedRequestLogger];
