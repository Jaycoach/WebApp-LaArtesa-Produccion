/**
 * Controlador para gestión de masas de producción
 */

const db = require('../database/connection');
const fasesModel = require('../models/fases.model');
const sapService = require('../services/sap.service');
const logger = require('../utils/logger');
const { sendAprobacionMasaEmail, sendAprobacionMasaBulkEmail } = require('../services/email.service');
const { devolverStockMasa } = require('./pesaje.controller');

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
      total_kilos_pesado_real:    parseFloat(m.total_kilos_pesado_real)    || 0,
      porcentaje_merma:           parseFloat(m.porcentaje_merma)           || 0,
      factor_absorcion_usado:     parseFloat(m.factor_absorcion_usado)     || 0,
      total_ordenes:              parseInt(m.total_ordenes)                || 0,
      total_productos:            parseInt(m.total_productos)              || 0,
      total_unidades_pedidas:     parseInt(m.total_unidades_pedidas)       || 0,
      total_unidades_programadas: parseInt(m.total_unidades_programadas)   || 0,
      total_panes:                parseInt(m.total_panes)                  || 0,
      productos_resumen:          m.productos_resumen || [],
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
         im.diferencia_gramos,
         im.es_empaque,
         im.uom
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
        `SELECT item_code_comp, item_name_comp, cantidad, warehouse, visual_order, uom, es_empaque
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
            es_empaque: comp.es_empaque || false,
            uom: comp.uom || 'Kg',
            porcentaje_panadero: 0,
            cantidad_kilos: cantidadTotal,
            cantidad_gramos: comp.es_empaque ? cantidadTotal : cantidadTotal * 1000,
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
      .map(ing => ({ ...ing, cantidad_gramos: ing.es_empaque ? ing.cantidad_kilos : ing.cantidad_kilos * 1000 }))
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
    const { delta_paquetes, motivo } = req.body;

    if (delta_paquetes === undefined || delta_paquetes === null || !Number.isInteger(Number(delta_paquetes))) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere delta_paquetes (entero, puede ser 0 para quitar ajuste)',
      });
    }

    const masaResult = await db.query(
      'SELECT id, fase_actual FROM masas_produccion WHERE id = $1',
      [masaId]
    );
    if (masaResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }
    if (masaResult.rows[0].fase_actual !== 'PLANIFICACION') {
      return res.status(400).json({
        success: false,
        message: `Solo se puede ajustar en fase PLANIFICACION (actual: ${masaResult.rows[0].fase_actual})`,
      });
    }

    const productoActual = await db.query(
      'SELECT id, unidades_programadas, unidades_pedidas, unidades_por_paquete FROM productos_por_masa WHERE id = $1 AND masa_id = $2',
      [productoId, masaId]
    );
    if (productoActual.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado en esta masa' });
    }

    const prod = productoActual.rows[0];
    const nuevasUnidades = Math.max(0, Number(prod.unidades_pedidas) + Number(delta_paquetes));

    const producto = await fasesModel.updateUnidadesProgramadas(
      productoId,
      nuevasUnidades,
      req.user.id,
      motivo || null
    );

    if (!producto) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }

    res.json({
      success: true,
      data: producto,
      message: `Ajuste aplicado: ${delta_paquetes > 0 ? '+' : ''}${delta_paquetes} paquetes`,
    });
  } catch (error) {
    logger.error('Error al actualizar unidades programadas:', error);
    next(error);
  }
};

/**
 * Lógica core de aprobación de una masa — reusada por el endpoint individual
 * (aprobarMasa) y por el endpoint masivo (aprobarMasaBulk). No escribe en
 * `res` directamente: retorna el resultado o lanza un Error con .statusCode.
 * opts.enviarCorreoIndividual (default true) controla si dispara el correo
 * de alistamiento de empaque por SÍ SOLA — en bulk se pasa false para que
 * el endpoint bulk mande un único correo resumen al final.
 */
const aprobarMasaCore = async (id, userId, opts = {}) => {
  const { fecha_vencimiento_sugerida, prioridad, hora_entrega, enviarCorreoIndividual = true } = opts;
  const { ejecutarSubdivision } = require('./fases.controller');

  const masa = await db.query(
    `SELECT id, codigo_masa, estado, fase_actual, tipo_masa, fecha_produccion, total_kilos_con_merma
     FROM masas_produccion WHERE id = $1`,
    [id]
  );

  if (masa.rows.length === 0) {
    const err = new Error('Masa no encontrada');
    err.statusCode = 404;
    throw err;
  }

  if (!['PLANIFICACION', 'PENDIENTE'].includes(masa.rows[0].estado)) {
    const err = new Error(`No se puede aprobar una masa en estado ${masa.rows[0].estado}`);
    err.statusCode = 400;
    throw err;
  }

  // Marcar masa como APROBADA
  await db.query(
    `UPDATE masas_produccion
     SET estado = 'APROBADA',
         aprobado_por = $2,
         aprobado_en = NOW(),
         prioridad = COALESCE($3, prioridad),
         hora_entrega = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [id, userId, prioridad ?? null, hora_entrega || null]
  );

  // Fecha de vencimiento sugerida: si el usuario no la especificó manualmente,
  // calcularla desde U_JZ_DiasExp (SAP) = fecha de aprobación + días de vencimiento
  // del producto. Con varios productos por masa, se usa el más conservador (MIN días).
  // Si ningún producto tiene U_JZ_DiasExp configurado, se deja igual que antes (vacío,
  // el usuario la ingresa a mano en Empaque) — fallback preservado.
  let fechaVencimientoFinal = fecha_vencimiento_sugerida || null;
  if (!fechaVencimientoFinal) {
    const diasR = await db.query(
      `SELECT MIN(dias_vencimiento) AS dias_min
       FROM productos_por_masa
       WHERE masa_id = $1 AND dias_vencimiento IS NOT NULL`,
      [id]
    );
    const diasMin = diasR.rows[0]?.dias_min;
    if (diasMin != null) {
      const fechaCalc = new Date();
      fechaCalc.setDate(fechaCalc.getDate() + parseInt(diasMin));
      fechaVencimientoFinal = fechaCalc.toISOString().split('T')[0];
    }
  }
  if (fechaVencimientoFinal) {
    await db.query(
      `UPDATE progreso_fases
       SET datos_fase = COALESCE(datos_fase, '{}'::jsonb) || $2::jsonb
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [id, JSON.stringify({ fecha_vencimiento_sugerida: fechaVencimientoFinal })]
    );
  }

  // Aplicar delta por defecto (+2 paq) a productos que no fueron ajustados manualmente
  // "no ajustado" = unidades_programadas == unidades_pedidas (nunca tocado por el usuario)
  const prodsSinAjuste = await db.query(
    `SELECT id, unidades_programadas, unidades_pedidas, unidades_por_paquete, multiplo_divisor
     FROM productos_por_masa
     WHERE masa_id = $1 AND delta_ajuste IS NULL`,
    [id]
  );
  const DELTA_DEFAULT_PAQ = 2;
  for (const prod of prodsSinAjuste.rows) {
    const divisor        = Math.max(0, Number(prod.multiplo_divisor) || 0);
    const nuevasPaq      = Number(prod.unidades_programadas) + DELTA_DEFAULT_PAQ;
    const nuevasAjustadas = (divisor > 0 && nuevasPaq % divisor !== 0)
      ? (Math.floor(nuevasPaq / divisor) + 1) * divisor
      : nuevasPaq;
    const nuevasExcedente = nuevasAjustadas - nuevasPaq;
    await db.query(
      `UPDATE productos_por_masa
       SET unidades_programadas = $1::integer,
           kilos_programados    = gramaje_unitario * $1::integer / 1000.0,
           cantidad_paquetes    = $1::integer,
           delta_ajuste         = $3::integer,
           unidades_ajustadas   = $4::integer,
           unidades_excedente   = $5::integer,
           updated_at           = NOW()
       WHERE id = $2`,
      [nuevasPaq, prod.id, DELTA_DEFAULT_PAQ, nuevasAjustadas, nuevasExcedente]
    );
  }
  logger.info(`Masa ${id}: delta +${DELTA_DEFAULT_PAQ} paq aplicado a ${prodsSinAjuste.rows.length} productos sin ajuste manual.`);

  const totalPaquetesR = await db.query(
    `SELECT COALESCE(SUM(unidades_programadas), 0) AS total
     FROM productos_por_masa WHERE masa_id = $1`,
    [id]
  );
  const totalPaquetes = totalPaquetesR.rows[0]?.total || 0;

  // --- NOTIFICACIÓN EMPAQUE individual: solo si enviarCorreoIndividual !== false ---
  // Se ejecuta en background (sin await) para no bloquear ni fallar la aprobación
  if (enviarCorreoIndividual) {
    setImmediate(async () => {
      const clienteEmail = await db.getClient();
      try {
        const correosCfg = await clienteEmail.query(
          `SELECT valor FROM configuracion_sistema WHERE clave = 'correos_empaque'`
        );
        const correosStr = correosCfg.rows[0]?.valor || '';
        const destinatarios = correosStr.split(',').map(e => e.trim()).filter(Boolean);
        if (!destinatarios.length) return;

        const empaqueConNombre = await clienteEmail.query(
          `SELECT bc.item_code_comp AS item_code,
                  bc.item_name_comp AS item_name,
                  SUM(bc.cantidad * pm.unidades_programadas) AS cantidad_total,
                  bc.uom
           FROM sap_bom_componentes bc
           JOIN productos_por_masa pm ON pm.sap_item_code = bc.item_code_padre
           WHERE pm.masa_id = $1
             AND bc.es_empaque = true
           GROUP BY bc.item_code_comp, bc.item_name_comp, bc.uom`,
          [id]
        );

        await sendAprobacionMasaEmail({
          to: destinatarios.join(','),
          masa: {
            ...masa.rows[0],
            fecha_produccion: masa.rows[0].fecha_produccion || new Date(),
            total_paquetes: totalPaquetes,
          },
          productosEmpaque: empaqueConNombre.rows,
        });

        logger.info(`Notificación empaque enviada para masa ${id} a: ${destinatarios.join(', ')}`);
      } catch (emailErr) {
        logger.warn(`Notificación empaque masa ${id} falló (no crítico): ${emailErr.message}`);
      } finally {
        clienteEmail.release();
      }
    });
  }
  // --- FIN NOTIFICACIÓN EMPAQUE individual ---

  // Intentar subdivisión (conPesaje=false → sub-masas arrancan en PLANIFICACION)
  const resultadoSubdivision = await ejecutarSubdivision(id, userId, false);

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
        [subMasa.id, userId]
      );
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
      await db.query(
        `UPDATE progreso_fases
         SET estado = 'PENDIENTE', updated_at = NOW()
         WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
        [subMasa.id]
      );
      if (fecha_vencimiento_sugerida) {
        await db.query(
          `UPDATE progreso_fases
           SET datos_fase = COALESCE(datos_fase, '{}'::jsonb) || $2::jsonb
           WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
          [subMasa.id, JSON.stringify({ fecha_vencimiento_sugerida })]
        );
      }
    }

    logger.info(`Masa ${id} subdividida en ${resultadoSubdivision.n_tandas} tandas y aprobadas por usuario ${userId}`);

    return {
      success: true,
      message: `Masa subdividida en ${resultadoSubdivision.n_tandas} tandas. Cada tanda está aprobada y lista para pesaje.`,
      subdivision: resultadoSubdivision,
      masaInfo: masa.rows[0],
      totalPaquetes,
    };
  }

  // Sin subdivisión: flujo normal
  const r1 = await db.query(
    `UPDATE progreso_fases SET estado = 'COMPLETADA'
     WHERE masa_id = $1 AND fase = 'PLANIFICACION'`, [id]
  );
  logger.info(`[APROBACION DEBUG] masa=${id} PLANIFICACION→COMPLETADA rows=${r1.rowCount}`);

  const r2 = await db.query(
    `UPDATE progreso_fases SET estado = 'EN_PROGRESO'
     WHERE masa_id = $1 AND fase = 'PESAJE'`, [id]
  );
  logger.info(`[APROBACION DEBUG] masa=${id} PESAJE→EN_PROGRESO rows=${r2.rowCount}`);

  const r3 = await db.query(
    `UPDATE progreso_fases SET estado = 'PENDIENTE', updated_at = NOW()
     WHERE masa_id = $1 AND fase = 'EMPAQUE'`, [id]
  );
  logger.info(`[APROBACION DEBUG] masa=${id} EMPAQUE→PENDIENTE rows=${r3.rowCount}`);

  if (fecha_vencimiento_sugerida) {
    await db.query(
      `UPDATE progreso_fases
       SET datos_fase = COALESCE(datos_fase, '{}'::jsonb) || $2::jsonb
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [id, JSON.stringify({ fecha_vencimiento_sugerida })]
    );
  }

  logger.info(`Masa ${id} APROBADA por usuario ${userId}`);

  return {
    success: true,
    message: 'Masa aprobada. Pesaje desbloqueado.',
    subdivision: null,
    masaInfo: masa.rows[0],
    totalPaquetes,
  };
};

const aprobarMasa = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await aprobarMasaCore(id, req.user.id, { ...req.body, enviarCorreoIndividual: true });
    return res.json(result);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    logger.error('Error al aprobar masa:', error);
    next(error);
  }
};

/**
 * Aprobación masiva — reusa aprobarMasaCore por cada id, SIN disparar el
 * correo individual de cada una (enviarCorreoIndividual=false). Al final,
 * si al menos una fue exitosa, dispara UN solo correo resumen a Empaque
 * en vez de N correos (evita spam / uso excesivo de SES en lotes grandes).
 */
const aprobarMasaBulk = async (req, res, next) => {
  try {
    const { ids, fecha_vencimiento_sugerida, prioridad, hora_entrega } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Debe enviar un arreglo "ids" con al menos una masa.' });
    }

    const exitosas = [];
    const fallidas = [];

    for (const id of ids) {
      try {
        const result = await aprobarMasaCore(id, req.user.id, {
          fecha_vencimiento_sugerida,
          prioridad,
          hora_entrega,
          enviarCorreoIndividual: false,
        });
        exitosas.push({ id, masaInfo: result.masaInfo, totalPaquetes: result.totalPaquetes });
      } catch (error) {
        fallidas.push({ id, error: error.message || 'Error desconocido' });
      }
    }

    // Correo resumen único, en background (no bloquea la respuesta)
    if (exitosas.length > 0) {
      setImmediate(async () => {
        const clienteEmail = await db.getClient();
        try {
          const correosCfg = await clienteEmail.query(
            `SELECT valor FROM configuracion_sistema WHERE clave = 'correos_empaque'`
          );
          const correosStr = correosCfg.rows[0]?.valor || '';
          const destinatarios = correosStr.split(',').map(e => e.trim()).filter(Boolean);
          if (!destinatarios.length) return;

          await sendAprobacionMasaBulkEmail({
            to: destinatarios.join(','),
            masas: exitosas.map(e => ({
              codigo_masa: e.masaInfo.codigo_masa,
              tipo_masa: e.masaInfo.tipo_masa,
              total_paquetes: e.totalPaquetes,
            })),
          });

          logger.info(`Notificación empaque BULK enviada (${exitosas.length} masas) a: ${destinatarios.join(', ')}`);
        } catch (emailErr) {
          logger.warn(`Notificación empaque bulk falló (no crítico): ${emailErr.message}`);
        } finally {
          clienteEmail.release();
        }
      });
    }

    logger.info(`Aprobación bulk: ${exitosas.length} exitosas, ${fallidas.length} fallidas, por usuario ${req.user.id}`);

    return res.json({
      success: true,
      aprobadas: exitosas.length,
      fallidas,
    });
  } catch (error) {
    logger.error('Error en aprobación masiva:', error);
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

    // Bloquear reversión si ya hay ingredientes con peso registrado (timestamp_peso indica pesaje físico real)
    const pesosRegistrados = await db.query(
      `SELECT COUNT(*) AS total
       FROM ingredientes_masa
       WHERE masa_id = $1 AND timestamp_peso IS NOT NULL`,
      [id]
    );
    if (parseInt(pesosRegistrados.rows[0].total) > 0) {
      return res.status(409).json({
        success: false,
        message: 'No se puede revertir la masa: ya hay ingredientes pesados. Contacta al supervisor de producción.',
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

const getInfoCancelacionMasa = async (req, res, next) => {
  try {
    const { id } = req.params;
    const info = await fasesModel.getInfoCancelacion(id);
    if (!info.masas.length) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada o ya cancelada' });
    }
    res.json({ success: true, data: info });
  } catch (error) {
    logger.error(`Error obteniendo info de cancelación de masa ${req.params.id}:`, error);
    next(error);
  }
};

const cancelarMasa = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { motivo, confirmar_parcial, lineas_seleccionadas } = req.body;

    if (!motivo || !motivo.trim()) {
      return res.status(400).json({
        success: false,
        message: 'El motivo de cancelación es obligatorio.',
      });
    }

    const info = await fasesModel.getInfoCancelacion(id);
    if (!info.masas.length) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada o ya cancelada' });
    }

    const raiz = info.masas.find(m => String(m.id) === String(id));
    if (!raiz || !['PLANIFICACION', 'APROBADA', 'SUBDIVIDIDA'].includes(raiz.estado)) {
      return res.status(403).json({
        success: false,
        message: `Solo se pueden cancelar masas en estado PLANIFICACION, APROBADA o SUBDIVIDIDA. Estado actual: ${raiz?.estado || 'desconocido'}`,
        estado: raiz?.estado,
      });
    }
    if (raiz.bloqueada) {
      return res.status(403).json({
        success: false,
        message: 'No se puede cancelar: el pesaje ya fue confirmado en SAP para esta masa.',
      });
    }

    const bloqueadas = info.masas.filter(m => m.id !== raiz.id && m.bloqueada);
    const cancelables = info.masas.filter(m => !m.bloqueada);

    if (bloqueadas.length > 0 && !confirmar_parcial) {
      return res.status(409).json({
        success: false,
        message: `${bloqueadas.map(m => m.codigo_masa).join(', ')} ya tiene(n) pesaje confirmado y no podrá(n) ser cancelada(s). ¿Cancelar las demás junto con la masa principal, dejando esta(s) activa(s)?`,
        data: {
          requiere_confirmacion: true,
          bloqueadas: bloqueadas.map(m => ({ id: m.id, codigo_masa: m.codigo_masa })),
          cancelables: cancelables.map(m => ({ id: m.id, codigo_masa: m.codigo_masa })),
        },
      });
    }

    const idsCancelables = new Set(cancelables.map(m => m.id));
    const todasLasLineas = info.lineas.filter(l => idsCancelables.has(l.masa_id));
    const lineasACerrar = Array.isArray(lineas_seleccionadas)
      ? todasLasLineas.filter(l => lineas_seleccionadas.some(
          sel => sel.sap_doc_entry === l.sap_doc_entry && sel.sap_line_num === l.sap_line_num
        ))
      : todasLasLineas;

    const resultadosSap = [];
    for (const linea of lineasACerrar) {
      // ¿Otras masas ACTIVAS (no canceladas, distintas a las que se cancelan
      // ahora) siguen referenciando esta misma línea de OV? — típico de una
      // masa subdividida donde solo se cancela una tanda y las hermanas
      // siguen produciendo con la misma OV.
      const otrasActivasResult = await db.query(
        `SELECT COALESCE(SUM(ov.unidades_pedidas), 0) AS unidades_otras
         FROM productos_por_masa_ov ov
         JOIN masas_produccion m ON m.id = ov.masa_id
         WHERE ov.sap_doc_entry = $1 AND ov.sap_line_num = $2
           AND ov.masa_id != $3
           AND m.estado != 'CANCELADA'`,
        [linea.sap_doc_entry, linea.sap_line_num, linea.masa_id]
      );
      const hayOtrasActivas = parseInt(otrasActivasResult.rows[0].unidades_otras) > 0;
      const cantidadActual = linea.cantidad_abierta_sap ?? linea.unidades_pedidas;
      const nuevaCantidad = cantidadActual - linea.unidades_pedidas;

      let resultado, tipoAccion, cantidadRestante;
      if (hayOtrasActivas && nuevaCantidad > 0) {
        // Quedan tandas hermanas activas usando la línea: solo reducir.
        resultado = await sapService.reducirCantidadLineaOV(linea.sap_doc_entry, linea.sap_line_num, nuevaCantidad);
        tipoAccion = 'REDUCCION';
        cantidadRestante = nuevaCantidad;
      } else {
        // Nadie más la usa, o la resta da 0/negativo: cerrar completa.
        resultado = await sapService.cerrarLineaOV(linea.sap_doc_entry, linea.sap_line_num);
        tipoAccion = 'CIERRE';
        cantidadRestante = 0;
      }

      if (resultado.exitosa) {
        // Sincronizar cantidad_abierta_sap local en TODAS las filas que
        // referencian esta línea (puede haber una fila por cada masa/tanda
        // que la usa), para que el próximo cálculo parta del valor correcto.
        await db.query(
          `UPDATE productos_por_masa_ov
           SET cantidad_abierta_sap = $1
           WHERE sap_doc_entry = $2 AND sap_line_num = $3`,
          [cantidadRestante, linea.sap_doc_entry, linea.sap_line_num]
        );
      }

      resultadosSap.push({ ...linea, ...resultado, tipo_accion: tipoAccion, cantidad_restante_sap: cantidadRestante });
      await db.query(
        `INSERT INTO cancelaciones_ov_sap
           (masa_id, sap_doc_entry, sap_doc_num, sap_line_num, sap_item_code, exitosa, mensaje_error, cancelado_por, tipo_accion, cantidad_reducida, cantidad_restante_sap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [linea.masa_id, linea.sap_doc_entry, linea.sap_doc_num, linea.sap_line_num,
         linea.sap_item_code, resultado.exitosa, resultado.mensaje || null, req.user.id,
         tipoAccion, tipoAccion === 'REDUCCION' ? linea.unidades_pedidas : null, cantidadRestante]
      );
    }
    const fallidas = resultadosSap.filter(r => !r.exitosa);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const m of cancelables) {
        await devolverStockMasa(m.id);
        await client.query(
          `UPDATE masas_produccion
           SET estado = 'CANCELADA', cancelado_por = $1, cancelado_en = NOW(),
               motivo_cancelacion = $2, updated_at = NOW()
           WHERE id = $3`,
          [req.user.id, motivo.trim(), m.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    logger.info(`Masa ${id} y ${cancelables.length - 1} relacionada(s) canceladas por usuario ${req.user.id}. Líneas SAP: ${resultadosSap.length - fallidas.length} ok, ${fallidas.length} fallidas. Motivo: ${motivo.trim()}`);
    res.json({
      success: true,
      message: fallidas.length > 0
        ? `Masa(s) cancelada(s) en Orbit. ${fallidas.length} línea(s) de OV no se pudieron cerrar en SAP por su estado — revisar detalle.`
        : `Masa(s) cancelada(s) correctamente, ${resultadosSap.length} línea(s) de OV cerradas en SAP.`,
      data: {
        masaId: id,
        estado: 'CANCELADA',
        canceladas: cancelables.map(m => m.codigo_masa),
        no_canceladas: bloqueadas.map(m => m.codigo_masa),
        lineas_sap: resultadosSap.map(r => ({
          doc_num: r.sap_doc_num, line_num: r.sap_line_num, item_code: r.sap_item_code,
          exitosa: r.exitosa, mensaje: r.mensaje || null,
          tipo_accion: r.tipo_accion, cantidad_restante_sap: r.cantidad_restante_sap,
        })),
      },
    });
  } catch (error) {
    logger.error(`Error cancelando masa ${req.params.id}:`, error);
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
  aprobarMasaBulk,
  marcarPendiente,
  getInfoCancelacionMasa,
  cancelarMasa,
};
