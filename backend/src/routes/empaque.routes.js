/**
 * empaque.routes.js — ARTESA
 */
const express = require('express');
const router = express.Router();
const c = require('../controllers/empaque.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

// Vista consolidada por OV (ANTES de /:masaId para evitar colisión)
router.get('/ov/:docNum',                    c.getEmpaqueByOV);

// Por masa (compatibilidad)
router.get('/:masaId',                       c.getEmpaqueInfo);
router.post('/:masaId/iniciar',              c.iniciarEmpaque);
router.patch('/:masaId/detalle/:productoId', c.actualizarDetalle);
router.post('/:masaId/completar',            c.completarEmpaque);
router.get('/:masaId/etiqueta/:productoId',  c.getEtiqueta);

module.exports = router;
