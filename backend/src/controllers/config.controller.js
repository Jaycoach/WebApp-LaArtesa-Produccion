/**
 * Controlador para configuración del sistema
 */

const fasesModel = require('../models/fases.model');
const db = require('../database/connection');
const logger = require('../utils/logger');

/**
 * @desc    Obtener factor de absorción
 * @route   GET /api/config/factor-absorcion
 * @access  Private
 */
const getFactorAbsorcion = async (req, res, next) => {
  try {
    const config = await fasesModel.getFactorAbsorcion();

    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Configuración no encontrada',
      });
    }

    res.json({
      success: true,
      data: {
        factor: parseFloat(config.valor),
        updated_at: config.updated_at,
      },
    });
  } catch (error) {
    logger.error('Error al obtener factor de absorción:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar factor de absorción
 * @route   PUT /api/config/factor-absorcion
 * @access  Private (Admin only)
 */
const updateFactorAbsorcion = async (req, res, next) => {
  try {
    const { factorAbsorcion } = req.body;

    if (!factorAbsorcion || factorAbsorcion <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Factor de absorción inválido',
      });
    }

    const config = await fasesModel.updateFactorAbsorcion(factorAbsorcion, req.user.id);

    res.json({
      success: true,
      data: {
        factor: parseFloat(config.valor),
        updated_at: config.updated_at,
        updated_by: config.updated_by,
      },
      message: 'Factor de absorción actualizado correctamente',
    });
  } catch (error) {
    logger.error('Error al actualizar factor de absorción:', error);
    next(error);
  }
};

/**
 * @desc    Obtener correos de empaque (configuración)
 * @route   GET /api/config/correos
 * @access  Private
 */
const getCorreos = async (req, res, next) => {
  try {
    // TODO: Implementar modelo para obtener correos de configuración
    // Por ahora retornamos un placeholder
    res.json({
      success: true,
      data: {
        correos: ['empaque@artesa.com'],
      },
    });
  } catch (error) {
    logger.error('Error al obtener correos:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar correos de empaque
 * @route   PUT /api/config/correos
 * @access  Private (Admin only)
 */
const updateCorreos = async (req, res, next) => {
  try {
    const { emailNotificaciones } = req.body;

    if (!Array.isArray(emailNotificaciones) || emailNotificaciones.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Debe proporcionar al menos un correo electrónico',
      });
    }

    // TODO: Implementar modelo para actualizar correos en configuración
    // Por ahora retornamos los correos recibidos

    res.json({
      success: true,
      data: {
        correos: emailNotificaciones,
      },
      message: 'Correos actualizados correctamente',
    });
  } catch (error) {
    logger.error('Error al actualizar correos:', error);
    next(error);
  }
};

/**
 * @desc    Obtener costo del agua por litro
 * @route   GET /api/config/costo-agua
 * @access  Private
 */
const getCostoAgua = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT valor, fecha_actualizacion AS updated_at
       FROM configuracion_sistema WHERE clave = 'costo_agua_litro'`
    );
    const costo = result.rows.length > 0 ? parseFloat(result.rows[0].valor) || 0 : 0;
    res.json({ success: true, data: { costo, updated_at: result.rows[0]?.updated_at } });
  } catch (error) {
    logger.error('Error al obtener costo del agua:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar costo del agua por litro
 * @route   PUT /api/config/costo-agua
 * @access  Private (Admin only)
 */
const updateCostoAgua = async (req, res, next) => {
  try {
    const { costo } = req.body;
    if (costo === undefined || costo === null || isNaN(parseFloat(costo)) || parseFloat(costo) < 0) {
      return res.status(400).json({ success: false, message: 'Costo inválido. Debe ser un número >= 0' });
    }
    const result = await db.query(
      `INSERT INTO configuracion_sistema
         (clave, valor, tipo, categoria, descripcion, es_publica, actualizado_por)
       VALUES ('costo_agua_litro', $1, 'NUMBER', 'PRODUCCION',
               'Costo por litro de agua en COP (insumo propio, no se compra directamente)',
               false, $2)
       ON CONFLICT (clave) DO UPDATE SET
         valor           = EXCLUDED.valor,
         actualizado_por = EXCLUDED.actualizado_por,
         fecha_actualizacion = NOW()
       RETURNING valor, fecha_actualizacion AS updated_at`,
      [String(parseFloat(costo)), req.user.id]
    );
    res.json({
      success: true,
      data: { costo: parseFloat(result.rows[0].valor), updated_at: result.rows[0].updated_at },
      message: 'Costo del agua actualizado correctamente',
    });
  } catch (error) {
    logger.error('Error al actualizar costo del agua:', error);
    next(error);
  }
};

module.exports = {
  getFactorAbsorcion,
  updateFactorAbsorcion,
  getCorreos,
  updateCorreos,
  getCostoAgua,
  updateCostoAgua,
};
