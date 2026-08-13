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
 * @route   POST /api/fermentacion/:masaId/camara/entrada/:productoId
 * @desc    Registrar entrada a cámara de una línea (producto) de fermentación
 * @access  Private
 */
router.post('/:masaId/camara/entrada/:productoId', fermentacionController.registrarEntradaCamara);

/**
 * @route   POST /api/fermentacion/:masaId/camara/salida/:productoId
 * @desc    Registrar salida de cámara de una línea (producto) de fermentación
 * @access  Private
 */
router.post('/:masaId/camara/salida/:productoId', fermentacionController.registrarSalidaCamara);

/**
 * @route   POST /api/fermentacion/:masaId/completar
 * @desc    Completar fermentación (exige todas las líneas con salida registrada) y desbloquear HORNEADO
 * @access  Private
 */
router.post('/:masaId/completar', fermentacionController.completarFermentacion);

module.exports = router;
