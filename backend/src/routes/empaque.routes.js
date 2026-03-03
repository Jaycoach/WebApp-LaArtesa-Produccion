/**
 * Rutas para el proceso de EMPAQUE
 */

const express = require('express');
const router = express.Router();
const empaqueController = require('../controllers/empaque.controller');
const { verifyToken } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verifyToken);

/**
 * @route   GET /api/empaque/:masaId
 * @desc    Obtener información de empaque para una masa
 * @access  Private
 */
router.get('/:masaId', empaqueController.getEmpaqueInfo);

/**
 * @route   POST /api/empaque/:masaId/iniciar
 * @desc    Iniciar proceso de empaque (crea registro y detalles)
 * @access  Private
 */
router.post('/:masaId/iniciar', empaqueController.iniciarEmpaque);

/**
 * @route   PATCH /api/empaque/:masaId/detalle/:productoId
 * @desc    Actualizar unidades empacadas/merma de un producto
 * @access  Private
 */
router.patch('/:masaId/detalle/:productoId', empaqueController.actualizarDetalle);

/**
 * @route   POST /api/empaque/:masaId/completar
 * @desc    Completar empaque y finalizar producción
 * @access  Private
 */
router.post('/:masaId/completar', empaqueController.completarEmpaque);

module.exports = router;
