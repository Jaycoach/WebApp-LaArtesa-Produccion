/**
 * Controlador para gestión de fases de producción
 */

const fasesModel = require('../models/fases.model');
const logger = require('../utils/logger');

/**
 * @desc    Obtener progreso de fases de una masa
 * @route   GET /api/fases/:masaId
 * @access  Private
 */
const getProgresoFases = async (req, res, next) => {
  try {
    const { masaId } = req.params;

    const progreso = await fasesModel.getProgresoFases(masaId);

    res.json({
      success: true,
      data: progreso,
    });
  } catch (error) {
    logger.error('Error al obtener progreso de fases:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar progreso de una fase
 * @route   PUT /api/fases/:masaId/progreso
 * @access  Private
 */
const updateProgreso = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const { fase, accion, datos } = req.body;

    if (!fase || !accion) {
      return res.status(400).json({
        success: false,
        message: 'Fase y acción son requeridas',
      });
    }

    const fasesValidas = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];
    if (!fasesValidas.includes(fase.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Fase inválida',
      });
    }

    const accionesValidas = ['iniciar', 'actualizar', 'completar'];
    if (!accionesValidas.includes(accion.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Acción inválida',
      });
    }

    let estado, porcentaje;

    switch (accion.toLowerCase()) {
      case 'iniciar':
        estado = 'EN_PROGRESO';
        porcentaje = 0;
        break;
      case 'actualizar':
        estado = 'EN_PROGRESO';
        porcentaje = datos?.porcentaje || 50;
        break;
      case 'completar':
        estado = 'COMPLETADA';
        porcentaje = 100;
        break;
    }

    const faseActualizada = await fasesModel.updateEstadoFase(
      masaId,
      fase.toUpperCase(),
      estado,
      porcentaje,
      req.user.id,
      datos
    );

    // Si se completó la fase, desbloquear la siguiente
    if (accion.toLowerCase() === 'completar') {
      await fasesModel.desbloquearSiguienteFase(masaId, fase.toUpperCase());
    }

    res.json({
      success: true,
      data: faseActualizada,
      message: `Fase ${accion} exitosamente`,
    });
  } catch (error) {
    logger.error('Error al actualizar progreso:', error);
    next(error);
  }
};

/**
 * @desc    Completar una fase específica
 * @route   PUT /api/fases/:masaId/:fase/completar
 * @access  Private
 */
const completarFase = async (req, res, next) => {
  try {
    const { masaId, fase } = req.params;
    const datos = req.body;

    const faseActualizada = await fasesModel.updateEstadoFase(
      masaId,
      fase.toUpperCase(),
      'COMPLETADA',
      100,
      req.user.id,
      datos
    );

    // Desbloquear la siguiente fase
    const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, fase.toUpperCase());

    res.json({
      success: true,
      data: faseActualizada,
      siguiente_fase: siguienteFase,
      message: 'Fase completada exitosamente',
    });
  } catch (error) {
    logger.error('Error al completar fase:', error);
    next(error);
  }
};

module.exports = {
  getProgresoFases,
  updateProgreso,
  completarFase,
};
