/**
 * Middleware de Rate Limiting - Versión Robusta y Compleja
 * 
 * Sistema de limitación de velocidad multi-nivel para:
 * - General: Protección global de API
 * - Autenticación: Prevención de ataques de fuerza bruta
 * - Creación: Limitación de creación de recursos
 * - Actualización: Control de operaciones de modificación
 * - Eliminación: Protección contra eliminación masiva
 * - SAP: Rate limiting para operaciones SAP B1
 * - Lectura: Limitación de consultas pesadas
 * - Admin: Operaciones administrativas
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const config = require('../config');
const logger = require('../utils/logger');

// Cliente Redis (puede ser null si no está configurado)
let redisClient = null;

/**
 * Intenta conectar a Redis para almacenamiento distribuido
 * Si falla, usa almacenamiento en memoria (apropiado para desarrollo)
 */
const initializeRedis = () => {
  try {
    if (process.env.REDIS_ENABLED === 'true') {
      const redis = require('redis');
      redisClient = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        legacyMode: true,
      });
      redisClient.connect().catch(err => {
        logger.warn('No se pudo conectar a Redis, usando almacenamiento en memoria', { error: err.message });
        redisClient = null;
      });
    }
  } catch (err) {
    logger.warn('Redis no disponible, usando almacenamiento en memoria');
  }
};

/**
 * Factory para crear tienda de rate limit
 * Usa Redis si está disponible, de lo contrario memoria
 */
const createStore = (options) => {
  if (redisClient) {
    return new RedisStore({
      client: redisClient,
      prefix: options.prefix || 'rl:',
    });
  }
  return undefined; // Usa MemoryStore por defecto
};

/**
 * Manejador de error estándar para rate limiting
 */
const defaultHandler = (limitType, message) => (req, res) => {
  const retryAfter = req.rateLimit?.resetTime || Math.ceil((req.rateLimit?.retryAfter || 60) / 1000);
  
  logger.logSecurity(`RATE_LIMIT_EXCEEDED_${limitType}`, {
    ip: req.ip,
    path: req.path,
    method: req.method,
    username: req.body?.username || req.user?.username,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString(),
  });
  
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      type: limitType,
      message,
      retryAfter,
      resetTime: new Date(Date.now() + retryAfter * 1000).toISOString(),
    },
  });
};

/**
 * Rate Limiter General - Protección global de API
 * - 100 requests cada 15 minutos
 * - Identificado por IP
 * - Excludes: health checks, swagger docs
 */
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs || 15 * 60 * 1000,
  max: config.rateLimit.max || 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('GENERAL', 'Demasiadas peticiones desde esta IP. Por favor intenta de nuevo más tarde.'),
  skip: (req) => {
    // Excepciones: health check y swagger
    const excludedPaths = ['/health', '/api-docs', '/swagger'];
    return excludedPaths.some(path => req.path.startsWith(path));
  },
  keyGenerator: (req) => {
    // Usar X-Forwarded-For si está disponible (Nginx, proxies)
    return req.headers['x-forwarded-for'] || req.ip;
  },
});

/**
 * Rate Limiter para Autenticación - Prevención de Brute Force
 * - 5 intentos fallidos cada 15 minutos
 * - Más restrictivo que general
 * - Solo cuenta intentos fallidos (skipSuccessfulRequests: true)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  skipSuccessfulRequests: true, // Reset counter en login exitoso
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('AUTH', 'Demasiados intentos de login fallidos. Intenta de nuevo en 15 minutos.'),
  keyGenerator: (req) => {
    // Limitar por username + IP para prevenir ataques distribuidos
    const username = req.body?.username || 'unknown';
    const ip = req.headers['x-forwarded-for'] || req.ip;
    return `${ip}_${username}`;
  },
});

/**
 * Rate Limiter para Creación de Recursos
 * - 15 creaciones por minuto
 * - Previene creación masiva de datos
 */
const createLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('CREATE', 'Demasiadas operaciones de creación. Por favor espera un momento.'),
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip;
  },
});

/**
 * Rate Limiter para Actualización de Recursos
 * - 30 actualizaciones por minuto
 * - Menos restrictivo que creación (es más frecuente)
 */
const updateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('UPDATE', 'Demasiadas operaciones de actualización. Por favor espera.'),
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip;
  },
});

/**
 * Rate Limiter para Eliminación de Recursos
 * - 5 eliminaciones por minuto
 * - Muy restrictivo (operación peligrosa)
 */
const deleteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('DELETE', 'Demasiadas operaciones de eliminación. Por favor espera.'),
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip;
  },
});

/**
 * Rate Limiter para Operaciones SAP B1
 * - 25 requests por minuto
 * - Control para sincronización con sistema ERP
 * - Limita según usuario autenticado si es posible
 */
const sapLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('SAP', 'Demasiadas solicitudes a SAP. Sistema saturado. Intenta más tarde.'),
  keyGenerator: (req) => {
    // Limitar por usuario si está autenticado, si no por IP
    if (req.user?.id) {
      return `sap_user_${req.user.id}`;
    }
    return `sap_ip_${req.headers['x-forwarded-for'] || req.ip}`;
  },
});

/**
 * Rate Limiter para Lecturas/Consultas Complejas
 * - 50 requests por minuto
 * - Previene queries pesadas y exports masivos
 */
const queryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('QUERY', 'Demasiadas consultas. Por favor espera antes de hacer otra solicitud.'),
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip;
  },
});

/**
 * Rate Limiter para Operaciones Administrativas
 * - 20 requests por minuto
 * - Solo para admins
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('ADMIN', 'Demasiadas operaciones administrativas. Intenta de nuevo en un momento.'),
  keyGenerator: (req) => {
    // Limitar por usuario admin
    return `admin_${req.user?.id || (req.headers['x-forwarded-for'] || req.ip)}`;
  },
  skip: (req) => {
    // Solo aplicar a usuarios admin
    return req.user?.rol !== 'admin';
  },
});

/**
 * Rate Limiter Estricto para Operaciones Críticas
 * - 3 requests por minuto
 * - Para operaciones especialmente sensibles
 */
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('STRICT', 'Operación protegida. Has alcanzado el límite. Intenta más tarde.'),
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.ip;
  },
});

/**
 * Rate Limiter para Exportación de Datos
 * - 5 exportaciones por hora
 * - Limita operaciones pesadas de exportación
 */
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: defaultHandler('EXPORT', 'Has alcanzado el límite de exportaciones por hora. Intenta más tarde.'),
  keyGenerator: (req) => {
    return req.user?.id ? `export_user_${req.user.id}` : `export_ip_${req.headers['x-forwarded-for'] || req.ip}`;
  },
});

// Inicializar Redis si está habilitado
if (process.env.NODE_ENV === 'production') {
  initializeRedis();
}

module.exports = {
  // Limitadores principales
  general: generalLimiter,
  auth: authLimiter,
  create: createLimiter,
  update: updateLimiter,
  delete: deleteLimiter,
  
  // Limitadores especializados
  sap: sapLimiter,
  query: queryLimiter,
  admin: adminLimiter,
  strict: strictLimiter,
  export: exportLimiter,
  
  // Útiles
  redisClient,
  initializeRedis,
};
