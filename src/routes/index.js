const express = require('express');
const router = express.Router();

// Ruta de bienvenida de la API
router.get('/', (req, res) => {
  res.json({
    message: 'API ARTESA v1.0.0',
    endpoints: {
      health: '/health',
      api: '/api',
    },
    documentation: '/api-docs',
  });
});

// Placeholder para futuras rutas
// router.use('/auth', require('./auth.routes'));
// router.use('/users', require('./user.routes'));
// router.use('/ordenes', require('./orden.routes'));

module.exports = router;