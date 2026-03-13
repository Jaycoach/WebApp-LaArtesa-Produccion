const express = require('express');
const router = express.Router();
const c = require('../controllers/reportes.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/costos', c.getReporteCostos);

module.exports = router;
