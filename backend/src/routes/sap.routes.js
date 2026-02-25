/**
 * Rutas para integración con SAP
 */

const express = require('express');
const router = express.Router();
const sapController = require('../controllers/sap.controller');
const { verifyToken } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');

// Destructuring explícito para mayor claridad
const {
  sincronizarSAP,
  sincronizarDemo,
  sincronizarDesdeOV,
  getOrdenes,
  getOrdenesVenta,
  verificarStock,
  getHistorialSync,
  testConexionSAP,
} = sapController;

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
 * @route   POST /api/sap/sincronizar-demo
 * @desc    Sincronizar en modo DEMO (sin conexión SAP real)
 * @access  Private (Admin/Supervisor only)
 */
router.post('/sincronizar-demo', checkRole(['admin', 'supervisor']), sapController.sincronizarDemo);

/**
 * @route   POST /api/sap/sincronizar-ov
 * @desc    Sincronizar desde Órdenes de Venta SAP (agrupa por U_JZ_Tipos_Masa)
 * @access  Private (Admin/Supervisor only)
 */
router.post('/sincronizar-ov', checkRole(['admin', 'supervisor']), sapController.sincronizarDesdeOV);

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

/**
 * @route   GET /api/sap/ordenes-ov
 * @desc    Preview de OV SAP del día sin sincronizar (solo lectura)
 * @access  Private
 */
router.get('/ordenes-ov', getOrdenesVenta);

/**
 * @route   GET /api/sap/test
 * @desc    Test de conexión con SAP Service Layer
 * @access  Private (Admin/Supervisor only)
 */
router.get('/test', checkRole(['admin', 'supervisor']), testConexionSAP);

module.exports = router;
