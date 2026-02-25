/**
 * Controlador para gestión de fases de producción
 */

const fasesModel = require('../models/fases.model');
const logger = require('../utils/logger');
const db = require('../database/connection');

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
 *
 * Cuando fase = PLANIFICACION, consolida el BOM de todos los productos
 * de la masa y puebla ingredientes_masa antes de desbloquear PESAJE.
 */
const completarFase = async (req, res, next) => {
  try {
    const { masaId, fase } = req.params;
    const datos = req.body;

    // Hoisted so it's accessible in res.json() below
    let acumulado = {};

    // ── Caso especial: PLANIFICACION → consolidar BOM ──────────────
    if (fase.toUpperCase() === 'PLANIFICACION') {

      // 1. Obtener productos de la masa con su sap_item_code
      const productosResult = await db.query(
        `SELECT sap_item_code, producto_nombre, unidades_programadas
         FROM productos_por_masa
         WHERE masa_id = $1 AND sap_item_code IS NOT NULL AND sap_item_code <> ''`,
        [masaId]
      );

      if (productosResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'La masa no tiene productos con ItemCode SAP. Verifique la sincronización de OV.',
        });
      }

      // 2. Para cada producto, buscar su BOM en sap_bom_componentes
      //    y acumular: cantidad_total = SUM(cantidad_bom × unidades_programadas)
      for (const prod of productosResult.rows) {
        const bomResult = await db.query(
          `SELECT item_code_comp, item_name_comp, cantidad, warehouse, issue_method, visual_order
           FROM sap_bom_componentes
           WHERE item_code_padre = $1
           ORDER BY visual_order`,
          [prod.sap_item_code]
        );

        if (bomResult.rows.length === 0) {
          logger.warn(`Sin BOM local para ${prod.sap_item_code} (${prod.producto_nombre}). ¿Se ejecutó sincronizar-bom?`);
          continue;
        }

        for (const comp of bomResult.rows) {
          const cantidadTotal = parseFloat(comp.cantidad) * parseFloat(prod.unidades_programadas);

          if (acumulado[comp.item_code_comp]) {
            acumulado[comp.item_code_comp].cantidad += cantidadTotal;
          } else {
            acumulado[comp.item_code_comp] = {
              nombre:      comp.item_name_comp,
              cantidad:    cantidadTotal,
              warehouse:   comp.warehouse,
              issueMethod: comp.issue_method,
              visualOrder: comp.visual_order,
            };
          }
        }
      }

      // 3. Si se encontró BOM, limpiar e insertar ingredientes consolidados
      const componentesConsolidados = Object.entries(acumulado);

      if (componentesConsolidados.length > 0) {
        // 4. Limpiar ingredientes anteriores (por si se re-planifica)
        await db.query(`DELETE FROM ingredientes_masa WHERE masa_id = $1`, [masaId]);

        // 5. Insertar ingredientes consolidados
        for (const [itemCode, comp] of componentesConsolidados) {
          const nombreLower = comp.nombre.toLowerCase();
          const esHarina     = nombreLower.includes('harina');
          const esAgua       = nombreLower.includes('agua');
          const esPrefermento = comp.warehouse === 'PRODPROC';

          const cantidadKilos  = comp.cantidad;
          const cantidadGramos = cantidadKilos * 1000;

          await db.query(
            `INSERT INTO ingredientes_masa
               (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
                es_harina, es_agua, es_prefermento,
                porcentaje_panadero, cantidad_gramos, cantidad_kilos,
                disponible, verificado, pesado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, false, false, false)`,
            [
              masaId,
              itemCode,
              comp.nombre,
              comp.visualOrder,
              esHarina,
              esAgua,
              esPrefermento,
              cantidadGramos,
              cantidadKilos,
            ]
          );
        }

        logger.info(`Masa ${masaId}: ${componentesConsolidados.length} ingredientes consolidados desde BOM`);
      } else {
        logger.warn(`Masa ${masaId}: No se encontró BOM local para ningún producto. Ejecute sincronizar-bom primero.`);
      }
    }
    // ── Fin caso especial ──────────────────────────────────────────

    // Completar la fase y desbloquear la siguiente (lógica estándar)
    const faseActualizada = await fasesModel.updateEstadoFase(
      masaId,
      fase.toUpperCase(),
      'COMPLETADA',
      100,
      req.user.id,
      datos
    );

    const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, fase.toUpperCase());

    res.json({
      success: true,
      data: faseActualizada,
      siguiente_fase: siguienteFase,
      message: 'Fase completada exitosamente',
      ingredientes_generados: fase.toUpperCase() === 'PLANIFICACION'
        ? Object.keys(acumulado).length
        : undefined,
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
