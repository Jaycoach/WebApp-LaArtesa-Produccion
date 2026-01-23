/**
 * Controlador para configuración del sistema
 */

const fasesModel = require('../models/fases.model');
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

module.exports = {
  getFactorAbsorcion,
  updateFactorAbsorcion,
  getCorreos,
  updateCorreos,
};
