/**
 * Controlador para gestión de masas de producción
 */

const fasesModel = require('../models/fases.model');
const logger = require('../utils/logger');

/**
 * @desc    Obtener masas por fecha
 * @route   GET /api/masas?fecha=YYYY-MM-DD
 * @access  Private
 */
const getMasasByFecha = async (req, res, next) => {
  try {
    const { fecha } = req.query;

    if (!fecha) {
      return res.status(400).json({
        success: false,
        message: 'La fecha es requerida',
      });
    }

    const masas = await fasesModel.getMasasByFecha(fecha);

    res.json({
      success: true,
      data: masas,
    });
  } catch (error) {
    logger.error('Error al obtener masas por fecha:', error);
    next(error);
  }
};

/**
 * @desc    Obtener detalle de una masa
 * @route   GET /api/masas/:id
 * @access  Private
 */
const getMasaById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const masa = await fasesModel.getMasaById(id);

    if (!masa) {
      return res.status(404).json({
        success: false,
        message: 'Masa no encontrada',
      });
    }

    res.json({
      success: true,
      data: masa,
    });
  } catch (error) {
    logger.error('Error al obtener masa:', error);
    next(error);
  }
};

/**
 * @desc    Obtener productos de una masa
 * @route   GET /api/masas/:id/productos
 * @access  Private
 */
const getProductosByMasa = async (req, res, next) => {
  try {
    const { id } = req.params;

    const productos = await fasesModel.getProductosByMasa(id);

    res.json({
      success: true,
      data: productos,
    });
  } catch (error) {
    logger.error('Error al obtener productos:', error);
    next(error);
  }
};

/**
 * @desc    Obtener composición/ingredientes de una masa
 * @route   GET /api/masas/:id/composicion
 * @access  Private
 */
const getComposicionByMasa = async (req, res, next) => {
  try {
    const { id } = req.params;

    const ingredientes = await fasesModel.getIngredientesByMasa(id);

    res.json({
      success: true,
      data: ingredientes,
    });
  } catch (error) {
    logger.error('Error al obtener composición:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar unidades programadas de un producto
 * @route   PATCH /api/masas/:masaId/productos/:productoId
 * @access  Private
 */
const updateUnidadesProgramadas = async (req, res, next) => {
  try {
    const { masaId, productoId } = req.params;
    const { unidades_programadas } = req.body;

    if (unidades_programadas === undefined || unidades_programadas < 0) {
      return res.status(400).json({
        success: false,
        message: 'Las unidades programadas son requeridas y deben ser mayores o iguales a 0',
      });
    }

    const producto = await fasesModel.updateUnidadesProgramadas(
      productoId,
      unidades_programadas,
      req.user.id
    );

    if (!producto) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      });
    }

    res.json({
      success: true,
      data: producto,
      message: 'Unidades programadas actualizadas correctamente',
    });
  } catch (error) {
    logger.error('Error al actualizar unidades programadas:', error);
    next(error);
  }
};

module.exports = {
  getMasasByFecha,
  getMasaById,
  getProductosByMasa,
  getComposicionByMasa,
  updateUnidadesProgramadas,
};
