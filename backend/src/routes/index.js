/**
 * Archivo Principal de Rutas
 * Agrupa y exporta todas las rutas de la aplicación
 */

const express = require('express');

const router = express.Router();

// Importar rutas
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const masasRoutes = require('./masas.routes');
const fasesRoutes = require('./fases.routes');
const pesajeRoutes = require('./pesaje.routes');
const configRoutes = require('./config.routes');
const sapRoutes = require('./sap.routes');

/**
 * @route   GET /api
 * @desc    Endpoint raíz de la API
 * @access  Public
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API Artesa - Sistema de Gestión de Producción',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      masas: '/api/masas',
      fases: '/api/fases',
      pesaje: '/api/pesaje',
      config: '/api/config',
      sap: '/api/sap',
      health: '/health',
      docs: '/api-docs',
    },
  });
});

/**
 * Montar rutas
 */
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/masas', masasRoutes);
router.use('/fases', fasesRoutes);
router.use('/pesaje', pesajeRoutes);
router.use('/config', configRoutes);
router.use('/sap', sapRoutes);

module.exports = router;
