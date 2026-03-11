/**
 * Controlador para gestión de masas de producción
 */

const db = require('../database/connection');
const fasesModel = require('../models/fases.model');
const logger = require('../utils/logger');

/**
 * @desc    Obtener masas por fecha
 * @route   GET /api/masas?fecha=YYYY-MM-DD
 * @access  Private
 */
const getMasasByFecha = async (req, res, next) => {
  try {
    const { fecha, fase } = req.query;

    if (!fecha) {
      return res.status(400).json({
        success: false,
        message: 'La fecha es requerida',
      });
    }

    const fasesValidas = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];
    if (fase && !fasesValidas.includes(fase.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Fase inválida. Valores permitidos: ${fasesValidas.join(', ')}`,
      });
    }

    const masas = await fasesModel.getMasasByFecha(fecha, fase || null);
    const masasParseadas = masas.map(m => ({
      ...m,
      total_kilos_base:           parseFloat(m.total_kilos_base)           || 0,
      total_kilos_con_merma:      parseFloat(m.total_kilos_con_merma)      || 0,
      porcentaje_merma:           parseFloat(m.porcentaje_merma)           || 0,
      factor_absorcion_usado:     parseFloat(m.factor_absorcion_usado)     || 0,
      total_ordenes:              parseInt(m.total_ordenes)                || 0,
      total_productos:            parseInt(m.total_productos)              || 0,
      total_unidades_pedidas:     parseInt(m.total_unidades_pedidas)       || 0,
      total_unidades_programadas: parseInt(m.total_unidades_programadas)   || 0,
    }));

    res.json({
      success: true,
      data: masasParseadas,
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

const aprobarMasa = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { ejecutarSubdivision } = require('./fases.controller');

    const masa = await db.query(
      `SELECT id, estado, fase_actual, tipo_masa, total_kilos_con_merma
       FROM masas_produccion WHERE id = $1`,
      [id]
    );

    if (masa.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }

    if (!['PLANIFICACION', 'PENDIENTE'].includes(masa.rows[0].estado)) {
      return res.status(400).json({
        success: false,
        message: `No se puede aprobar una masa en estado ${masa.rows[0].estado}`,
      });
    }

    // Marcar masa como APROBADA
    await db.query(
      `UPDATE masas_produccion
       SET estado = 'APROBADA',
           aprobado_por = $2,
           aprobado_en = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [id, req.user.id]
    );

    // Intentar subdivisión (conPesaje=false → sub-masas arrancan en PLANIFICACION)
    const resultadoSubdivision = await ejecutarSubdivision(id, req.user.id, false);

    if (resultadoSubdivision && resultadoSubdivision.realizada) {
      // Aprobar todas las sub-masas y desbloquear su PESAJE directamente
      for (const subMasa of resultadoSubdivision.sub_masas) {
        await db.query(
          `UPDATE masas_produccion
           SET estado = 'APROBADA',
               aprobado_por = $2,
               aprobado_en = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [subMasa.id, req.user.id]
        );
        // Completar PLANIFICACION (evita que quede EN_PROGRESO junto con PESAJE)
        await db.query(
          `UPDATE progreso_fases
           SET estado = 'COMPLETADA'
           WHERE masa_id = $1 AND fase = 'PLANIFICACION'`,
          [subMasa.id]
        );
        await db.query(
          `UPDATE progreso_fases
           SET estado = 'EN_PROGRESO'
           WHERE masa_id = $1 AND fase = 'PESAJE'`,
          [subMasa.id]
        );
      }

      logger.info(`Masa ${id} subdividida en ${resultadoSubdivision.n_tandas} tandas y aprobadas por usuario ${req.user.id}`);

      return res.json({
        success: true,
        message: `Masa subdividida en ${resultadoSubdivision.n_tandas} tandas. Cada tanda está aprobada y lista para pesaje.`,
        subdivision: resultadoSubdivision,
      });
    }

    // Sin subdivisión: flujo normal
    await db.query(
      `UPDATE progreso_fases
       SET estado = 'EN_PROGRESO'
       WHERE masa_id = $1 AND fase = 'PESAJE'`,
      [id]
    );

    logger.info(`Masa ${id} APROBADA por usuario ${req.user.id}`);

    return res.json({
      success: true,
      message: 'Masa aprobada. Pesaje desbloqueado.',
      subdivision: null,
    });
  } catch (error) {
    logger.error('Error al aprobar masa:', error);
    next(error);
  }
};

const marcarPendiente = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;

    const masa = await db.query(
      `SELECT id, estado FROM masas_produccion WHERE id = $1`,
      [id]
    );

    if (masa.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }

    if (!['PLANIFICACION', 'APROBADA'].includes(masa.rows[0].estado)) {
      return res.status(400).json({
        success: false,
        message: `No se puede marcar pendiente una masa en estado ${masa.rows[0].estado}`,
      });
    }

    await db.query(
      `UPDATE masas_produccion SET estado = 'PENDIENTE', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await db.query(
      `UPDATE progreso_fases
       SET estado = 'BLOQUEADA'
       WHERE masa_id = $1 AND fase = 'PESAJE' AND estado = 'EN_PROGRESO'`,
      [id]
    );

    if (motivo) {
      await db.query(
        `UPDATE progreso_fases
         SET observaciones = $1
         WHERE masa_id = $2 AND fase = 'PLANIFICACION'`,
        [motivo, id]
      );
    }

    logger.info(`Masa ${id} marcada PENDIENTE por usuario ${req.user.id}`);

    return res.json({
      success: true,
      message: 'Masa marcada como pendiente.',
    });
  } catch (error) {
    logger.error('Error al marcar masa pendiente:', error);
    next(error);
  }
};

module.exports = {
  getMasasByFecha,
  getMasaById,
  getProductosByMasa,
  getComposicionByMasa,
  updateUnidadesProgramadas,
  aprobarMasa,
  marcarPendiente,
};
