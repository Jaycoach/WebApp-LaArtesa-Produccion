/**
 * Rutas para el proceso de FERMENTACIÓN
 */

const express = require('express');
const router = express.Router();
const fermentacionController = require('../controllers/fermentacion.controller');
const { verifyToken } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

/**
 * @route   GET /api/fermentacion/:masaId
 * @desc    Obtener información de fermentación para una masa
 * @access  Private
 */
router.get('/:masaId', fermentacionController.getFermentacionInfo);

/**
 * @route   POST /api/fermentacion/:masaId/camara/entrada
 * @desc    Registrar entrada a cámara de fermentación
 * @access  Private
 */
router.post('/:masaId/camara/entrada', fermentacionController.registrarEntradaCamara);

/**
 * @route   POST /api/fermentacion/:masaId/camara/salida
 * @desc    Registrar salida de cámara de fermentación
 * @access  Private
 */
router.post('/:masaId/camara/salida', fermentacionController.registrarSalidaCamara);

/**
 * @route   POST /api/fermentacion/:masaId/frio/entrada
 * @desc    Registrar entrada a cámara de frío
 * @access  Private
 */
router.post('/:masaId/frio/entrada', fermentacionController.registrarEntradaFrio);

/**
 * @route   POST /api/fermentacion/:masaId/frio/salida
 * @desc    Registrar salida de cámara de frío
 * @access  Private
 */
router.post('/:masaId/frio/salida', fermentacionController.registrarSalidaFrio);

module.exports = router;
