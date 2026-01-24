/**
 * Rutas para el proceso de HORNEADO
 */

const express = require('express');
const router = express.Router();
const horneadoController = require('../controllers/horneado.controller');
const { verifyToken } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

/**
 * @route   GET /api/horneado/hornos
 * @desc    Obtener catálogo de hornos disponibles
 * @access  Private
 */
router.get('/hornos', horneadoController.getHornos);

/**
 * @route   GET /api/horneado/programas
 * @desc    Obtener programas de horneado
 * @query   ?tipo_masa=GOLD (opcional)
 * @access  Private
 */
router.get('/programas', horneadoController.getProgramas);

/**
 * @route   GET /api/horneado/:masaId
 * @desc    Obtener información de horneado para una masa
 * @access  Private
 */
router.get('/:masaId', horneadoController.getHorneadoInfo);

/**
 * @route   POST /api/horneado/:masaId/iniciar
 * @desc    Iniciar horneado
 * @access  Private
 */
router.post('/:masaId/iniciar', horneadoController.iniciarHorneado);

/**
 * @route   PATCH /api/horneado/:masaId/temperaturas
 * @desc    Actualizar temperaturas durante horneado
 * @access  Private
 */
router.patch('/:masaId/temperaturas', horneadoController.actualizarTemperaturas);

/**
 * @route   PATCH /api/horneado/:masaId/damper
 * @desc    Actualizar damper durante horneado
 * @access  Private
 */
router.patch('/:masaId/damper', horneadoController.actualizarDamper);

/**
 * @route   POST /api/horneado/:masaId/completar
 * @desc    Completar horneado
 * @access  Private
 */
router.post('/:masaId/completar', horneadoController.completarHorneado);

module.exports = router;
