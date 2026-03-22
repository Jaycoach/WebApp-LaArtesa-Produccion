/**
 * Servidor Principal - Artesa Backend
 * Sistema de Gestión de Producción para Panadería
 */

require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/connection');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const requestLoggers = require('./middleware/requestLogger');
const { general: generalLimiter } = require('./middleware/rateLimiter');
const swaggerConfig = require('./swagger/swaggerConfig');

// Importar rutas
const routes = require('./routes');

/**
 * Middleware: restringe endpoints sensibles a red interna o token de servicio.
 * - Permite acceso desde 127.0.0.1 / ::1 (loopback) y rangos privados AWS (172.x, 10.x)
 * - Permite acceso con header x-internal-token coincidente con INTERNAL_TOKEN en .env
 * - En producción, Swagger y /health nunca deben ser públicos
 */
const internalOnly = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || '';
  const isPrivate = ['127.0.0.1', '::1'].includes(ip)
    || ip.startsWith('172.')
    || ip.startsWith('10.')
    || ip.startsWith('::ffff:127.');
  const hasToken = process.env.INTERNAL_TOKEN
    && req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN;
  if (isPrivate || hasToken) return next();
  return res.status(403).json({ success: false, message: 'Acceso restringido' });
};

// Crear aplicación Express
const app = express();

/**
 * CONFIGURACIÓN SWAGGER
 */
if (config.swagger.enabled) {
  const specs = swaggerJsdoc(swaggerConfig);
  app.use('/api-docs', internalOnly, swaggerUi.serve);
  app.get('/api-docs', internalOnly, swaggerUi.setup(specs, {
    swaggerOptions: {
      docExpansion: 'list',
      filter: true,
      showRequestHeaders: true,
      persistAuthorization: true,
    },
    customSiteTitle: 'ARTESA API Documentation',
  }));

  // Endpoint alternativo para el JSON de OpenAPI
  app.get('/api-docs/swagger.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });

  logger.info(`📚 Swagger UI disponible en http://localhost:${config.server.port}/api-docs`);
}

/**
 * MIDDLEWARE
 */

// Seguridad con Helmet
app.use(helmet());

// Habilitar CORS
app.use(cors(config.cors));

// Parsear JSON y URL-encoded
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Comprimir respuestas
app.use(compression());

// Request logger (array de middlewares)
app.use(requestLoggers);

// Sanitización contra inyección NoSQL ({ "$gt": "" } en body/query/params)
app.use(mongoSanitize());

// Limpieza de inputs contra XSS (strip <script>, atributos on*, html malicioso)
app.use(xss());

// Prevención de HTTP Parameter Pollution (?estado=A&estado=B)
// whitelist: params de ARTESA que legítimamente pueden repetirse en query string
app.use(hpp({
  whitelist: ['fecha', 'estado', 'fase', 'tipo', 'ids'],
}));

// Rate limiting general
app.use('/api/', generalLimiter);

/**
 * @swagger
 * /:
 *   get:
 *     summary: Endpoint raíz de la API
 *     description: Retorna información general sobre la API
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Información de la API
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Artesa Backend API"
 *                 version:
 *                   type: string
 *                   example: "1.0.0"
 *                 description:
 *                   type: string
 *                   example: "Sistema de Gestión de Producción para Panadería"
 *                 documentation:
 *                   type: string
 *                   example: "/api-docs"
 *                 health:
 *                   type: string
 *                   example: "/health"
 *                 endpoints:
 *                   type: object
 */

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check del servidor
 *     description: Verifica el estado del servidor y la base de datos
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Servidor y base de datos funcionando correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "OK"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-01-01T10:30:00.000Z"
 *                 uptime:
 *                   type: number
 *                   example: 3600
 *                 environment:
 *                   type: string
 *                   example: "development"
 *                 database:
 *                   type: string
 *                   example: "Connected"
 *                 memory:
 *                   type: object
 *                   properties:
 *                     used:
 *                       type: string
 *                       example: "125 MB"
 *                     total:
 *                       type: string
 *                       example: "512 MB"
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ERROR"
 *                 message:
 *                   type: string
 *                   example: "Error al conectar con la base de datos"
 */
app.get('/health', internalOnly, async (req, res) => {
  try {
    const dbConnected = await db.checkConnection();

    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.server.env,
      database: dbConnected ? 'Connected' : 'Disconnected',
      memory: {
        used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
        total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: error.message,
    });
  }
});

/**
 * RUTAS PRINCIPALES
 */
app.use('/api', routes);

/**
 * ROOT ENDPOINT
 */
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Artesa Backend API',
    version: '1.0.0',
    description: 'Sistema de Gestión de Producción para Panadeía',
    documentation: '/api-docs',
    health: '/health',
    endpoints: {
      api: '/api',
      auth: '/api/auth',
      users: '/api/users',
    },
  });
});

/**
 * MANEJO DE ERRORES
 */

// 404 Not Found
app.use(notFound);

// Error handler centralizado
app.use(errorHandler);

/**
 * INICIAR SERVIDOR
 */
const PORT = config.server.port;

const startServer = async () => {
  try {
    // Verificar conexión a la base de datos
    const dbConnected = await db.checkConnection();

    if (!dbConnected) {
      logger.error('No se pudo conectar a la base de datos. Abortando inicio del servidor.');
      process.exit(1);
    }

    // Iniciar servidor
    app.listen(PORT, () => {
      logger.info(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║            🍞 ARTESA - Backend API Server                  ║
║                                                            ║
║  Servidor corriendo en: http://localhost:${PORT}           ║
║  Ambiente: ${config.server.env.toUpperCase().padEnd(42)}║
║  Base de datos: PostgreSQL - Conectada                    ║
║                                                            ║
║  Endpoints disponibles:                                    ║
║  - Health Check: http://localhost:${PORT}/health           ║
║  - API Docs: http://localhost:${PORT}/api-docs             ║
║  - API Root: http://localhost:${PORT}/api                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);

      logger.info('Sistema listo para recibir peticiones');
    });
  } catch (error) {
    logger.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

/**
 * MANEJO DE SEÑALES DE TERMINACIÓN
 */
const gracefulShutdown = async (signal) => {
  logger.info(`Señal ${signal} recibida. Cerrando servidor...`);

  try {
    await db.closePool();
    logger.info('Pool de base de datos cerrado');

    process.exit(0);
  } catch (error) {
    logger.error('Error durante el cierre:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * MANEJO DE ERRORES NO CAPTURADOS
 */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Iniciar el servidor
if (require.main === module) {
  startServer();
}

module.exports = app;
