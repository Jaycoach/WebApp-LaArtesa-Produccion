/**
 * Rutas para configuración del sistema
 */

const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { verifyToken } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');

/**
 * Todas las rutas requieren autenticación
 */
router.use(verifyToken);

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

/**
 * @route   GET /api/config/costo-agua
 * @desc    Obtener costo del agua por litro
 */
router.get('/costo-agua', configController.getCostoAgua);

/**
 * @route   PUT /api/config/costo-agua
 * @desc    Actualizar costo del agua por litro
 */
router.put('/costo-agua', checkRole(['admin']), configController.updateCostoAgua);

module.exports = router;
