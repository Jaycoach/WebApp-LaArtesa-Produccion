/**
 * config.routes.js — ARTESA
 * Rutas de configuración del sistema
 */
const express = require('express');
const router = express.Router();
const c = require('../controllers/config.controller');
const { verifyToken } = require('../middleware/auth');
const { checkRole } = require('../middleware/roleCheck');

router.use(verifyToken);

// Factor absorción
router.get('/factor-absorcion',              c.getFactorAbsorcion);
router.put('/factor-absorcion',  checkRole(['admin']), c.updateFactorAbsorcion);

// Correos
router.get('/correos',                       c.getCorreos);
router.put('/correos',           checkRole(['admin']), c.updateCorreos);

// Costos agua
router.get('/costo-agua',                    c.getCostoAgua);
router.put('/costo-agua',        checkRole(['admin']), c.updateCostoAgua);
router.get('/costo-agua2',                   c.getCostoAgua2);
router.put('/costo-agua2',       checkRole(['admin']), c.updateCostoAgua2);

// Costos indirectos
router.get('/costos-indirectos',             c.getCostosIndirectos);
router.put('/costos-indirectos', checkRole(['admin']), c.updateCostosIndirectos);

// Tipos mano de obra (GET /mano-obra/masa/:masaId ANTES de /mano-obra/:id para evitar colisión)
router.get('/mano-obra/masa/:masaId',        c.getRegistrosMO);
router.post('/mano-obra/masa/:masaId',       c.createRegistroMO);
router.delete('/mano-obra/masa/:masaId/:registroId', checkRole(['admin', 'supervisor']), c.deleteRegistroMO);

router.get('/mano-obra',                     c.getTiposMO);
router.post('/mano-obra',        checkRole(['admin']), c.createTipoMO);
router.put('/mano-obra/:id',     checkRole(['admin']), c.updateTipoMO);
router.delete('/mano-obra/:id',  checkRole(['admin']), c.deleteTipoMO);

// Etiquetas
router.get('/etiquetas',                     c.getEtiquetas);
router.post('/etiquetas',        checkRole(['admin']), c.upsertEtiqueta);

// Catálogo tipos de masa — configuración de unidades y vida útil
router.get('/catalogo-tipos-masa',     c.getCatalogoTiposMasa);
router.put('/catalogo-tipos-masa/:id', checkRole(['admin', 'supervisor']), c.updateCatalogoTiposMasa);

// Sync precios empaque SAP
router.post('/sync-empaque',     checkRole(['admin', 'supervisor']), c.syncPreciosEmpaque);

module.exports = router;
