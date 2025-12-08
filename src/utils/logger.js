const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

// Definir niveles de log personalizados
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Definir colores para cada nivel
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Formato para desarrollo (consola)
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Formato para producción (JSON)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Crear directorio de logs si no existe
const fs = require('fs');
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Configuración de transports
const transports = [];

// Console transport (siempre activo en desarrollo)
if (config.server.env !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: devFormat,
    })
  );
}

// File transport para errores
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: 5242880, // 5MB
    maxFiles: 5,
    format: prodFormat,
  })
);

// File transport para todos los logs
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: 5242880, // 5MB
    maxFiles: 5,
    format: prodFormat,
  })
);

// File transport específico para SAP
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, 'sap-sync-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'info',
    maxSize: 5242880, // 5MB
    maxFiles: 5,
    format: prodFormat,
    // Solo loguear eventos de SAP
    filter: (info) => {
      return info.service === 'SAP' || info.component === 'SAP_SYNC';
    },
  })
);

// Crear logger
const logger = winston.createLogger({
  level: config.logs.level,
  levels,
  format: config.server.env === 'production' ? prodFormat : devFormat,
  transports,
  exitOnError: false,
});

// Stream para Morgan (HTTP logging)
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Agregar métodos de utilidad
logger.logAPIRequest = (req, statusCode, responseTime) => {
  logger.http(`${req.method} ${req.originalUrl} ${statusCode} - ${responseTime}ms`, {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    responseTime,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
};

logger.logSAPOperation = (operation, status, data) => {
  logger.info(`SAP Operation: ${operation} - ${status}`, {
    service: 'SAP',
    operation,
    status,
    ...data,
  });
};

logger.logAudit = (action, userId, details) => {
  logger.info(`Audit: ${action}`, {
    type: 'AUDIT',
    action,
    userId,
    timestamp: new Date().toISOString(),
    ...details,
  });
};

logger.logSecurity = (event, details) => {
  logger.warn(`Security Event: ${event}`, {
    type: 'SECURITY',
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
};

// Manejar excepciones no capturadas
if (config.server.env === 'production') {
  logger.exceptions.handle(
    new DailyRotateFile({
      filename: path.join(logDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: 5242880, // 5MB
      maxFiles: 5,
    })
  );

  logger.rejections.handle(
    new DailyRotateFile({
      filename: path.join(logDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

module.exports = logger;
