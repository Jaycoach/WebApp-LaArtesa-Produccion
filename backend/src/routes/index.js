/**
 * Archivo Principal de Rutas
 * Agrupa y exporta todas las rutas de la aplicación
 */

const express = require('express');

const router = express.Router();

// Importar rutas
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');

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

// TODO: Agregar más rutas cuando estén implementadas
// router.use('/ordenes', ordenRoutes);
// router.use('/proceso', procesoRoutes);
// router.use('/calidad', calidadRoutes);
// router.use('/recetas', recetaRoutes);
// router.use('/dashboard', dashboardRoutes);
// router.use('/sap', sapRoutes);

module.exports = router;
