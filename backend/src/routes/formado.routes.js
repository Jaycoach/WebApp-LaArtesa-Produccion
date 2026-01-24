/**
 * Rutas para el proceso de FORMADO
 */

const express = require('express');
const router = express.Router();
const formadoController = require('../controllers/formado.controller');
const { verifyToken } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

/**
 * @route   GET /api/formado/:masaId
 * @desc    Obtener información de formado para una masa
 * @access  Private
 */
router.get('/:masaId', formadoController.getFormadoInfo);

/**
 * @route   POST /api/formado/:masaId/iniciar
 * @desc    Iniciar proceso de formado
 * @access  Private
 */
router.post('/:masaId/iniciar', formadoController.iniciarFormado);

/**
 * @route   POST /api/formado/:masaId/completar
 * @desc    Completar proceso de formado
 * @access  Private
 */
router.post('/:masaId/completar', formadoController.completarFormado);

module.exports = router;
