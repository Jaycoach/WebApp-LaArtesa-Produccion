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
    const db = require('../database/connection');

    // 1. Buscar ingredientes ya generados (fases posteriores a PLANIFICACION)
    const ingredientesResult = await db.query(
      `SELECT
         im.id,
         im.ingrediente_sap_code,
         im.ingrediente_nombre,
         im.orden_visualizacion,
         im.es_harina,
         im.es_agua,
         im.es_prefermento,
         im.porcentaje_panadero,
         im.cantidad_gramos,
         im.cantidad_kilos,
         im.disponible,
         im.verificado,
         im.pesado,
         im.peso_real,
         im.diferencia_gramos
       FROM ingredientes_masa im
       WHERE im.masa_id = $1
       ORDER BY im.orden_visualizacion`,
      [id]
    );

    if (ingredientesResult.rows.length > 0) {
      return res.json({ success: true, data: ingredientesResult.rows });
    }

    // 2. Fallback: construir composición desde BOM SAP (masa en PLANIFICACION)
    const productosResult = await db.query(
      `SELECT sap_item_code, producto_nombre, unidades_programadas
       FROM productos_por_masa
       WHERE masa_id = $1 AND sap_item_code IS NOT NULL AND sap_item_code <> ''`,
      [id]
    );

    if (productosResult.rows.length === 0) {
      return res.json({ success: true, data: [], mensaje: 'Sin productos SAP asociados. Verifica la sincronización.' });
    }

    // Acumular ingredientes de todos los productos de la masa
    const acumulado = {};
    for (const prod of productosResult.rows) {
      const bomResult = await db.query(
        `SELECT item_code_comp, item_name_comp, cantidad, warehouse, visual_order
         FROM sap_bom_componentes
         WHERE item_code_padre = $1
         ORDER BY visual_order`,
        [prod.sap_item_code]
      );

      for (const comp of bomResult.rows) {
        const cantidadTotal = parseFloat(comp.cantidad) * parseFloat(prod.unidades_programadas);
        if (acumulado[comp.item_code_comp]) {
          acumulado[comp.item_code_comp].cantidad_kilos += cantidadTotal;
        } else {
          const nombreLower = comp.item_name_comp.toLowerCase();
          acumulado[comp.item_code_comp] = {
            id: comp.item_code_comp,
            ingrediente_sap_code: comp.item_code_comp,
            ingrediente_nombre: comp.item_name_comp,
            orden_visualizacion: comp.visual_order || 99,
            es_harina: nombreLower.includes('harina'),
            es_agua: nombreLower.includes('agua'),
            es_prefermento: comp.warehouse === 'PRODPROC',
            porcentaje_panadero: 0,
            cantidad_kilos: cantidadTotal,
            cantidad_gramos: cantidadTotal * 1000,
            disponible: false,
            verificado: false,
            pesado: false,
            peso_real: null,
            diferencia_gramos: null,
            fuente: 'BOM_SAP'
          };
        }
      }
    }

    const composicionBOM = Object.values(acumulado)
      .map(ing => ({ ...ing, cantidad_gramos: ing.cantidad_kilos * 1000 }))
      .sort((a, b) => a.orden_visualizacion - b.orden_visualizacion);

    logger.info(`Masa ${id}: composición desde BOM SAP con ${composicionBOM.length} ingredientes`);
    return res.json({ success: true, data: composicionBOM });

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
