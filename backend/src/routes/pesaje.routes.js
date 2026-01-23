/**
 * Rutas para gestión de pesaje y checklist
 */

const express = require('express');
const router = express.Router();
const pesajeController = require('../controllers/pesaje.controller');
const { verifyToken } = require('../middleware/auth');

/**
 * Todas las rutas requieren autenticación
 */
router.use(verifyToken);

/**
 * @route   GET /api/pesaje/:masaId/checklist
 * @desc    Obtener checklist de pesaje de una masa
 * @access  Private
 */
router.get('/:masaId/checklist', pesajeController.getChecklist);

/**
 * @route   PATCH /api/pesaje/:masaId/ingredientes/:ingredienteId
 * @desc    Actualizar estado de un ingrediente
 * @access  Private
 */
router.patch('/:masaId/ingredientes/:ingredienteId', pesajeController.updateIngrediente);

/**
 * @route   POST /api/pesaje/:masaId/confirmar
 * @desc    Confirmar que el pesaje está completo (VALIDACIÓN DE CHECKLIST)
 * @access  Private
 */
router.post('/:masaId/confirmar', pesajeController.confirmarPesaje);

/**
 * @route   POST /api/pesaje/:masaId/enviar-correo
 * @desc    Enviar correo al área de empaque
 * @access  Private
 */
router.post('/:masaId/enviar-correo', pesajeController.enviarCorreoEmpaque);

module.exports = router;
