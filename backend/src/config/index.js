require('dotenv').config();

module.exports = {
  // Configuración del servidor
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    timezone: process.env.TZ || 'America/Bogota',
  },

  // Configuración de base de datos
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'artesa_db',
    user: process.env.DB_USER || 'artesa_user',
    password: process.env.DB_PASSWORD || 'artesa_secure_password_2025',
    ssl: process.env.DB_SSL === 'true',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
      idle: parseInt(process.env.DB_POOL_IDLE, 10) || 10000,
    },
  },

  // Configuración de JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-super-secret-refresh-key',
    expiresIn: process.env.JWT_EXPIRE || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
    issuer: 'ARTESA',
    audience: 'artesa-api',
  },

  // Configuración de seguridad
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5,
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION, 10) || 30, // minutos
    passwordMinLength: 8,
    passwordRequireUppercase: true,
    passwordRequireNumber: true,
    passwordRequireSpecial: true,
  },

  // Configuración de CORS
  cors: {
    origin: process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',') 
      : ['http://localhost:3001'],
    credentials: process.env.CORS_CREDENTIALS === 'true',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Number', 'X-Page-Size'],
    maxAge: 86400, // 24 horas
  },

  // Configuración de Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutos
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
    message: 'Demasiadas solicitudes desde esta IP, por favor intente más tarde',
    standardHeaders: true,
    legacyHeaders: false,
  },

  // Configuración específica de autenticación
  authRateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 intentos
    skipSuccessfulRequests: true,
  },

  // Configuración avanzada de Rate Limiting
  rateLimiters: {
    // General - Global API protection
    general: {
      windowMs: parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW, 10) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_GENERAL_MAX, 10) || 100,
    },
    
    // Authentication - Brute force prevention
    auth: {
      windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW, 10) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 5,
    },
    
    // Create - Resource creation protection
    create: {
      windowMs: parseInt(process.env.RATE_LIMIT_CREATE_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_CREATE_MAX, 10) || 15,
    },
    
    // Update - Update operations protection
    update: {
      windowMs: parseInt(process.env.RATE_LIMIT_UPDATE_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_UPDATE_MAX, 10) || 30,
    },
    
    // Delete - Delete operations protection (strictest)
    delete: {
      windowMs: parseInt(process.env.RATE_LIMIT_DELETE_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_DELETE_MAX, 10) || 5,
    },
    
    // SAP - SAP B1 integration operations
    sap: {
      windowMs: parseInt(process.env.RATE_LIMIT_SAP_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_SAP_MAX, 10) || 25,
    },
    
    // Query - Complex queries and data retrieval
    query: {
      windowMs: parseInt(process.env.RATE_LIMIT_QUERY_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_QUERY_MAX, 10) || 50,
    },
    
    // Admin - Administrative operations
    admin: {
      windowMs: parseInt(process.env.RATE_LIMIT_ADMIN_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_ADMIN_MAX, 10) || 20,
    },
    
    // Strict - Sensitive operations (password change, config update)
    strict: {
      windowMs: parseInt(process.env.RATE_LIMIT_STRICT_WINDOW, 10) || 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_STRICT_MAX, 10) || 3,
    },
    
    // Export - Data export operations
    export: {
      windowMs: parseInt(process.env.RATE_LIMIT_EXPORT_WINDOW, 10) || 60 * 60 * 1000, // 1 hour
      max: parseInt(process.env.RATE_LIMIT_EXPORT_MAX, 10) || 5,
    },
  },

  // Configuración de Redis para Rate Limiting distribuido
  redis: {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  },

  // Configuración de Logs (simplificada)
  logs: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json'
  },

  // Configuración SAP B1
  sap: {
    url: process.env.SAP_URL || 'https://sap-server:50000/b1s/v1',
    company: process.env.SAP_COMPANY || 'ARTESA_SAS',
    username: process.env.SAP_USER || 'api_user',
    password: process.env.SAP_PASSWORD || '',
    sessionTimeout: parseInt(process.env.SAP_SESSION_TIMEOUT, 10) || 30, // minutos
    timeout: parseInt(process.env.SAP_TIMEOUT, 10) || 30000, // ms
    retryAttempts: parseInt(process.env.SAP_RETRY_ATTEMPTS, 10) || 3,
    retryDelay: parseInt(process.env.SAP_RETRY_DELAY, 10) || 5000, // ms
  },

  // Configuración de sincronización
  sync: {
    enabled: process.env.SYNC_ENABLED === 'true',
    cronSchedule: process.env.SYNC_CRON_SCHEDULE || '0 20 * * 1-5', // 8PM L-V
    retryAttempts: parseInt(process.env.SYNC_RETRY_ATTEMPTS, 10) || 3,
    retryDelay: parseInt(process.env.SYNC_RETRY_DELAY, 10) || 5000,
  },

  // Configuración de logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: {
      error: process.env.LOG_FILE_ERROR || 'logs/error.log',
      combined: process.env.LOG_FILE_COMBINED || 'logs/combined.log',
      sap: process.env.LOG_FILE_SAP || 'logs/sap-sync.log',
    },
    maxSize: '20m',
    maxFiles: '14d',
    format: process.env.NODE_ENV === 'production' ? 'json' : 'simple',
  },

  // Configuración de Email (opcional)
  email: {
    enabled: process.env.SMTP_ENABLED === 'true',
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || '',
    },
    from: process.env.SMTP_FROM || 'Sistema ARTESA <noreply@artesa.com>',
  },

  // Configuración de Swagger
  swagger: {
    enabled: process.env.NODE_ENV !== 'production',
    title: 'ARTESA API',
    description: 'Sistema de Gestión de Producción - API REST',
    version: '1.0.0',
    contact: {
      name: 'Jonathan Jay Zúñiga Perdomo',
      email: 'jaycoach@hotmail.com',
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://api.artesa.com' 
          : `http://localhost:${process.env.PORT || 3000}`,
        description: process.env.NODE_ENV === 'production' ? 'Servidor de Producción' : 'Servidor de Desarrollo',
      },
    ],
  },

  // Límites de aplicación
  limits: {
    maxFileSize: process.env.MAX_FILE_SIZE || '5mb',
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000,
    maxJsonSize: '10mb',
    maxUrlEncoded: '10mb',
  },

  // Validaciones
  validations: {
    username: {
      minLength: 3,
      maxLength: 50,
      pattern: /^[a-zA-Z0-9_-]+$/,
    },
    email: {
      pattern: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
    },
    password: {
      minLength: 8,
      maxLength: 128,
    },
  },

  // Configuración de producción
  production: {
    trustProxy: true,
    compression: true,
    removeXPoweredBy: true,
  },
};
