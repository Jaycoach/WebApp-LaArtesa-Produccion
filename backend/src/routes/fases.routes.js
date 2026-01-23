/**
 * Rutas para gestión de fases de producción
 */

const express = require('express');
const router = express.Router();
const fasesController = require('../controllers/fases.controller');
const { authenticate } = require('../middleware/auth');

/**
 * Todas las rutas requieren autenticación
 */
router.use(authenticate);

/**
 * @route   GET /api/fases/:masaId
 * @desc    Obtener progreso de fases de una masa
 * @access  Private
 */
router.get('/:masaId', fasesController.getProgresoFases);

/**
 * @route   PUT /api/fases/:masaId/progreso
 * @desc    Actualizar progreso de una fase
 * @access  Private
 */
router.put('/:masaId/progreso', fasesController.updateProgreso);

/**
 * @route   PUT /api/fases/:masaId/:fase/completar
 * @desc    Completar una fase específica
 * @access  Private
 */
router.put('/:masaId/:fase/completar', fasesController.completarFase);

module.exports = router;
