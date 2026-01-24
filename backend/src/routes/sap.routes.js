/**
 * Rutas para integración con SAP
 */

const express = require('express');
const router = express.Router();
const sapController = require('../controllers/sap.controller');
const { verifyToken } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');

/**
 * Todas las rutas requieren autenticación
 */
router.use(verifyToken);

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

/**
 * @route   GET /api/sap/stock/:masaId
 * @desc    Verificar disponibilidad de stock para una masa
 * @access  Private
 */
router.get('/stock/:masaId', sapController.verificarStock);

/**
 * @route   GET /api/sap/historial
 * @desc    Obtener histórico de sincronizaciones
 * @access  Private
 */
router.get('/historial', sapController.getHistorialSync);

module.exports = router;
