/**
 * Rutas para configuración del sistema
 */

const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticate } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');

/**
 * Todas las rutas requieren autenticación
 */
router.use(authenticate);

/**
 * @route   GET /api/config/factor-absorcion
 * @desc    Obtener factor de absorción
 * @access  Private
 */
router.get('/factor-absorcion', configController.getFactorAbsorcion);

/**
 * @route   PUT /api/config/factor-absorcion
 * @desc    Actualizar factor de absorción
 * @access  Private (Admin only)
 */
router.put('/factor-absorcion', checkRole(['admin']), configController.updateFactorAbsorcion);

/**
 * @route   GET /api/config/correos
 * @desc    Obtener correos de empaque
 * @access  Private
 */
router.get('/correos', configController.getCorreos);

/**
 * @route   PUT /api/config/correos
 * @desc    Actualizar correos de empaque
 * @access  Private (Admin only)
 */
router.put('/correos', checkRole(['admin']), configController.updateCorreos);

module.exports = router;
