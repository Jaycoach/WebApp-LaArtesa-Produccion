/**
 * Rutas para gestión de masas de producción
 */

const express = require('express');
const router = express.Router();
const masasController = require('../controllers/masas.controller');
const { verifyToken } = require('../middleware/auth');

/**
 * Todas las rutas requieren autenticación
 */
router.use(verifyToken);

/**
 * @route   GET /api/masas
 * @desc    Obtener masas por fecha (query param: fecha)
 * @access  Private
 */
router.get('/', masasController.getMasasByFecha);

/**
 * @route   GET /api/masas/:id
 * @desc    Obtener detalle de una masa
 * @access  Private
 */
router.get('/:id', masasController.getMasaById);

/**
 * @route   GET /api/masas/:id/productos
 * @desc    Obtener productos de una masa
 * @access  Private
 */
router.get('/:id/productos', masasController.getProductosByMasa);

/**
 * @route   GET /api/masas/:id/composicion
 * @desc    Obtener composición/ingredientes de una masa
 * @access  Private
 */
router.get('/:id/composicion', masasController.getComposicionByMasa);

/**
 * @route   PATCH /api/masas/:masaId/productos/:productoId
 * @desc    Actualizar unidades programadas de un producto
 * @access  Private
 */
router.patch('/:masaId/productos/:productoId', masasController.updateUnidadesProgramadas);

module.exports = router;
