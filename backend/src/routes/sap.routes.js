/**
 * Rutas para integración con SAP
 */

const express = require('express');
const router = express.Router();
const sapController = require('../controllers/sap.controller');
const { authenticate } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');

/**
 * Todas las rutas requieren autenticación
 */
router.use(authenticate);

/**
 * @route   POST /api/sap/sincronizar
 * @desc    Sincronizar órdenes desde SAP
 * @access  Private (Admin/Supervisor only)
 */
router.post('/sincronizar', checkRole(['admin', 'supervisor']), sapController.sincronizarSAP);

/**
 * @route   GET /api/sap/ordenes
 * @desc    Obtener órdenes de SAP
 * @access  Private
 */
router.get('/ordenes', sapController.getOrdenes);

module.exports = router;
