require('express-async-errors');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/connection');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

// Inicializar Express
const app = express();

// Configuración de seguridad
app.use(helmet());
app.use(cors(config.cors));
app.use(compression());

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Request logger
app.use(morgan('dev', { stream: logger.stream }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.env,
    database: db.isConnected() ? 'Connected' : 'Disconnected',
  });
});

// API Routes
app.use('/api', routes);

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: 'API ARTESA - Sistema de Gestión de Producción',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      api: '/api',
    }
  });
});

// Error Handler (debe ser el último middleware)
app.use(errorHandler);

// Inicialización del servidor
const startServer = async () => {
  try {
    // Conectar a la base de datos
    logger.info('🔌 Conectando a la base de datos...');
    await db.connect();
    logger.info('✅ Base de datos conectada');

    // Iniciar servidor
    const PORT = config.server.port;
    app.listen(PORT, () => {
      logger.info('='.repeat(50));
      logger.info(`🚀 Servidor ARTESA iniciado`);
      logger.info(`📍 Entorno: ${config.server.env}`);
      logger.info(`🌐 Puerto: ${PORT}`);
      logger.info(`🕐 Timezone: ${config.server.timezone}`);
      logger.info(`✅ Health: http://localhost:${PORT}/health`);
      logger.info(`✅ API: http://localhost:${PORT}/api`);
      logger.info('='.repeat(50));
    });

    // Manejo de señales de terminación
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM recibido. Cerrando servidor...');
      await db.disconnect();
      process.exit(0);
    });

  } catch (error) {
    logger.error('❌ Error al iniciar el servidor:', error);
    // Si es error de BD, continuar de todos modos en desarrollo
    if (config.server.env === 'development') {
      logger.warn('⚠️  Continuando sin base de datos...');
      const PORT = config.server.port;
      app.listen(PORT, () => {
        logger.info('='.repeat(50));
        logger.info(`🚀 Servidor ARTESA iniciado (SIN BD)`);
        logger.info(`🌐 Puerto: ${PORT}`);
        logger.info(`⚠️  Base de datos no conectada`);
        logger.info('='.repeat(50));
      });
    } else {
      process.exit(1);
    }
  }
};

// Iniciar
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;