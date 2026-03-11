/**
 * Controlador para gestión de pesaje y checklist
 *
 * CAMBIOS v4 (2026-02-27):
 *  - confirmarPesaje ahora detecta si la masa supera el límite de amasadora.
 *  - Si supera: ejecuta la subdivisión CON los pesos reales ya registrados.
 *    Las sub-masas nacen con PESAJE=COMPLETADO y AMASADO=EN_PROGRESO.
 *    El usuario no tiene que volver a pesar.
 *  - Si no supera: flujo estándar, desbloquea AMASADO.
 */

const fasesModel = require('../models/fases.model');
const db        = require('../database/connection');
const logger     = require('../utils/logger');
const sapService    = require('../services/sap.service');
const { ejecutarSubdivision } = require('./fases.controller');

/**
 * @desc    Obtener checklist de pesaje de una masa
 * @route   GET /api/pesaje/:masaId/checklist
 * @access  Private
 */
const getChecklist = async (req, res, next) => {
  try {
    const { masaId } = req.params;

    const masa = await fasesModel.getMasaById(masaId);
    if (!masa) {
      return res.status(404).json({
        success: false,
        message: 'Masa no encontrada',
      });
    }

    // Validar que la masa esté APROBADA
    if (masa.estado === 'PLANIFICACION' || masa.estado === 'PENDIENTE') {
      return res.status(403).json({
        success: false,
        message: `La masa debe ser aprobada por un supervisor antes de iniciar el pesaje. Estado actual: ${masa.estado}`,
        estado: masa.estado,
      });
    }

    const ingredientes  = await fasesModel.getIngredientesByMasa(masaId);

    // Enriquecer ingredientes con stock e inventario desde sap_inventario_mp
    const itemCodes = ingredientes
      .filter(i => i.ingrediente_sap_code)
      .map(i => i.ingrediente_sap_code);

    let inventarioMap = {};
    let lotesMap = {};
    if (itemCodes.length > 0) {
      const invResult = await db.query(
        `SELECT item_code, stock_almp, committed_almp, costo_promedio, ultimo_sync
         FROM sap_inventario_mp
         WHERE item_code = ANY($1)`,
        [itemCodes]
      );
      for (const row of invResult.rows) {
        inventarioMap[row.item_code] = row;
      }

      const lotesResult = await db.query(
        `SELECT item_code, batch, status, admission_date, expiration_date, cantidad_disponible
         FROM sap_lotes_mp
         WHERE item_code = ANY($1)
         ORDER BY item_code, admission_date ASC NULLS LAST`,
        [itemCodes]
      );
      for (const lote of lotesResult.rows) {
        if (!lotesMap[lote.item_code]) lotesMap[lote.item_code] = [];
        lotesMap[lote.item_code].push(lote);
      }
    }

    // Leer ingredientes excluidos de validación de stock (ej: MP0007 = agua)
    const configExcluidos = await db.query(
      `SELECT valor FROM configuracion_sistema WHERE clave = 'ingredientes_excluir_stock_validacion'`
    );
    const excluidos = configExcluidos.rows.length > 0
      ? configExcluidos.rows[0].valor.split(',').map(c => c.trim()).filter(Boolean)
      : [];

    // Leer costos de insumos propios desde configuración
    const configCostosInsumos = await db.query(
      `SELECT clave, valor FROM configuracion_sistema
       WHERE clave IN ('costo_agua_litro', 'costo_agua2_litro')`
    );
    const costosInsumos = {};
    for (const row of configCostosInsumos.rows) {
      costosInsumos[row.clave] = parseFloat(row.valor) || 0;
    }
    const costoAgua = costosInsumos['costo_agua_litro'] || 0;
    const costoAgua2 = costosInsumos['costo_agua2_litro'] || 0;

    // Adjuntar datos de stock a cada ingrediente
    const ingredientesConStock = ingredientes.map(ing => {
      const esExcluido = excluidos.includes(ing.ingrediente_sap_code);
      const inv = inventarioMap[ing.ingrediente_sap_code] || null;
      const stockDisponible = inv ? parseFloat(inv.stock_almp) - parseFloat(inv.committed_almp) : null;
      const cantidadRequerida = parseFloat(ing.cantidad_kilos) || 0;
      // Excluidos nunca bloquean por stock
      const sinStock = esExcluido ? false : (inv !== null && stockDisponible < cantidadRequerida);
      // Costo: excluidos usan configuración, resto usan SAP
      const costoUnitario = esExcluido
        ? (ing.ingrediente_sap_code === 'MP0008' ? costoAgua2 : costoAgua)
        : (inv ? parseFloat(inv.costo_promedio) : null);
      // Lotes ordenados por admission_date ASC → el primero es el sugerido
      const lotes = lotesMap[ing.ingrediente_sap_code] || [];
      return {
        ...ing,
        stock_almp:          inv ? parseFloat(inv.stock_almp) : null,
        committed_almp:      inv ? parseFloat(inv.committed_almp) : null,
        stock_disponible:    esExcluido ? null : stockDisponible,
        costo_unitario_sap:  costoUnitario,
        inventario_sync:     inv ? inv.ultimo_sync : null,
        sin_stock:           sinStock,
        excluido_stock:      esExcluido,
        lote_sugerido:       lotes.length > 0 ? lotes[0].batch : null,
        lotes,
      };
    });

    const progresoFases = await fasesModel.getProgresoFases(masaId);
    const fasePesaje    = progresoFases.find(f => f.fase === 'PESAJE');

    const total          = ingredientes.length;
    const disponibles    = ingredientes.filter(i => i.disponible).length;
    const verificados    = ingredientes.filter(i => i.verificado).length;
    const pesados        = ingredientes.filter(i => i.pesado).length;

    const todosDisponibles = disponibles === total;
    const todosVerificados = verificados === total;
    const todosPesados     = pesados === total;
    const completado       = todosDisponibles && todosVerificados && todosPesados;

    const progreso = total > 0
      ? Math.round(((disponibles + verificados + pesados) / (total * 3)) * 100)
      : 0;

    // Consultar productos con excedente por ajuste de divisor
    const productosAjusteResult = await db.query(
      `SELECT
         sap_item_code,
         producto_nombre,
         unidades_pedidas,
         unidades_programadas,
         unidades_ajustadas,
         unidades_excedente,
         multiplo_divisor
       FROM productos_por_masa
       WHERE masa_id = $1
         AND multiplo_divisor > 0
         AND unidades_excedente > 0
       ORDER BY producto_nombre`,
      [masaId]
    );

    const productosConAjuste = productosAjusteResult.rows;
    const hayAjustesDiv      = productosConAjuste.length > 0;

    const checklist = {
      masa_id:              masa.id,
      tipo_masa:            masa.tipo_masa,
      es_repeticion:        masa.es_repeticion ?? false,
      fecha_inicio:         fasePesaje?.fecha_inicio,
      usuario_responsable:  fasePesaje?.usuario_responsable,
      ingredientes:         ingredientesConStock,
      todosDisponibles,
      todosVerificados,
      todosPesados,
      completado,
      progreso,
      productos_con_ajuste: productosConAjuste,
      hay_ajustes_divisor:  hayAjustesDiv,
      sin_stock_count:           ingredientesConStock.filter(i => i.sin_stock).length,
      ingredientes_sin_stock:    ingredientesConStock.filter(i => i.sin_stock).map(i => i.ingrediente_nombre),
    };

    res.json({ success: true, data: checklist });
  } catch (error) {
    logger.error('Error al obtener checklist:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar estado de un ingrediente
 * @route   PATCH /api/pesaje/:masaId/ingredientes/:ingredienteId
 * @access  Private
 */
const updateIngrediente = async (req, res, next) => {
  try {
    const { masaId, ingredienteId } = req.params;
    const {
      disponible,
      verificado,
      pesado,
      peso_real,
      lote,
      fecha_vencimiento,
      observaciones,
    } = req.body;

    const data = {
      disponible,
      verificado,
      pesado,
      peso_real,
      lote,
      fecha_vencimiento: fecha_vencimiento && fecha_vencimiento.trim() !== '' ? fecha_vencimiento : null,
      observaciones,
      usuarioId: req.user.id,
    };

    const ingrediente = await fasesModel.updateIngredienteChecklist(ingredienteId, data);

    if (!ingrediente) {
      return res.status(404).json({
        success: false,
        message: 'Ingrediente no encontrado',
      });
    }

    res.json({
      success: true,
      data: ingrediente,
      message: 'Ingrediente actualizado correctamente',
    });
  } catch (error) {
    logger.error('Error al actualizar ingrediente:', error);
    next(error);
  }
};

/**
 * Envía salida de inventario a SAP (GoodsIssues) por los ingredientes pesados.
 * No bloquea el flujo de producción — errores son capturados y logueados.
 */
const enviarGoodsIssuePesaje = async (masaId, usuarioId) => {
  const inicio = Date.now();
  let requestPayload = null;
  try {
    // Leer ingredientes pesados (no empaque) con su lote registrado
    const result = await db.query(
      `SELECT im.ingrediente_sap_code, im.ingrediente_nombre,
              im.peso_real, im.lote,
              inv.manage_batch_numbers
       FROM ingredientes_masa im
       LEFT JOIN sap_inventario_mp inv ON inv.item_code = im.ingrediente_sap_code
       WHERE im.masa_id = $1
         AND im.es_empaque = false
         AND im.pesado = true
         AND im.peso_real > 0`,
      [masaId]
    );

    if (result.rows.length === 0) {
      logger.warn(`GoodsIssue masa ${masaId}: sin ingredientes pesados, omitiendo.`);
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    const documentLines = result.rows.map(ing => {
      const line = {
        ItemCode:      ing.ingrediente_sap_code,
        Quantity:      parseFloat(ing.peso_real) / 1000, // gramos → kg
        WarehouseCode: 'ALMP',
      };
      // Solo agregar BatchNumbers si el ítem maneja lotes Y tiene lote registrado
      if (ing.manage_batch_numbers && ing.lote) {
        line.BatchNumbers = [{
          BatchNumber: ing.lote,
          Quantity:    parseFloat(ing.peso_real) / 1000,
        }];
      }
      return line;
    });

    requestPayload = {
      DocDate:       today,
      Comments:      `Consumo pesaje masa ${masaId}`,
      DocumentLines: documentLines,
    };

    await sapService.ensureSession();
    const response = await sapService.client.post('/GoodsIssues', requestPayload);

    const tiempoRespuesta = Date.now() - inicio;
    await db.query(
      `INSERT INTO sap_sync_log
         (tipo_operacion, estado, sap_docentry, sap_docnum,
          request_payload, response_payload, tiempo_respuesta, usuario_id)
       VALUES ('GOODS_ISSUE_PESAJE', 'SUCCESS', $1, $2, $3, $4, $5, $6)`,
      [
        response.data?.DocEntry || null,
        response.data?.DocNum   ? String(response.data.DocNum) : null,
        JSON.stringify(requestPayload),
        JSON.stringify({ DocEntry: response.data?.DocEntry, DocNum: response.data?.DocNum, masa_id: masaId }),
        tiempoRespuesta,
        usuarioId,
      ]
    );

    logger.info(`GoodsIssue enviado para masa ${masaId}: DocEntry ${response.data?.DocEntry}`);
  } catch (err) {
    const tiempoRespuesta = Date.now() - inicio;
    const sapMsg = err?.response?.data?.error?.message?.value || err.message;
    logger.error(`Error enviando GoodsIssue para masa ${masaId}: ${sapMsg}`);
    try {
      await db.query(
        `INSERT INTO sap_sync_log
           (tipo_operacion, estado, request_payload,
            error_message, tiempo_respuesta, usuario_id)
         VALUES ('GOODS_ISSUE_PESAJE', 'ERROR', $1, $2, $3, $4)`,
        [
          JSON.stringify(requestPayload),
          sapMsg,
          tiempoRespuesta,
          usuarioId,
        ]
      );
    } catch (logErr) {
      logger.error(`Error logueando fallo GoodsIssue masa ${masaId}:`, logErr.message);
    }
  }
};

/**
 * @desc    Confirmar que el pesaje está completo
 * @route   POST /api/pesaje/:masaId/confirmar
 * @access  Private
 *
 * Si la masa supera el límite de capacidad de amasadora, se crean sub-masas
 * que ya heredan el pesaje completo (pesos reales divididos proporcionalmente).
 * Las sub-masas quedan en AMASADO directamente.
 */
const confirmarPesaje = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    logger.info(`Confirmando pesaje para masa ${masaId}`);

    // Validar que la masa esté APROBADA
    const masaCheck = await db.query(
      `SELECT estado FROM masas_produccion WHERE id = $1`, [masaId]
    );
    if (!masaCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }
    if (masaCheck.rows[0].estado !== 'APROBADA') {
      return res.status(403).json({
        success: false,
        message: `La masa debe estar en estado APROBADA para confirmar el pesaje. Estado actual: ${masaCheck.rows[0].estado}`,
        estado: masaCheck.rows[0].estado,
      });
    }

    // Validar stock suficiente para todos los ingredientes
    const ingResult = await db.query(
      `SELECT im.ingrediente_sap_code, im.ingrediente_nombre, im.cantidad_kilos,
              inv.stock_almp, inv.committed_almp, inv.costo_promedio
       FROM ingredientes_masa im
       LEFT JOIN sap_inventario_mp inv ON inv.item_code = im.ingrediente_sap_code
       WHERE im.masa_id = $1 AND im.es_empaque = false`,
      [masaId]
    );

    // Leer excluidos de validación de stock
    const configExcluidosConf = await db.query(
      `SELECT valor FROM configuracion_sistema WHERE clave = 'ingredientes_excluir_stock_validacion'`
    );
    const excluidosConf = configExcluidosConf.rows.length > 0
      ? configExcluidosConf.rows[0].valor.split(',').map(c => c.trim()).filter(Boolean)
      : [];

    const sinStock = ingResult.rows.filter(ing => {
      if (excluidosConf.includes(ing.ingrediente_sap_code)) return false; // excluidos: nunca bloquear
      if (!ing.stock_almp && ing.stock_almp !== 0) return false; // sin datos SAP: no bloquear
      const disponible = parseFloat(ing.stock_almp) - parseFloat(ing.committed_almp || 0);
      return disponible < parseFloat(ing.cantidad_kilos);
    });

    if (sinStock.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'No se puede confirmar el pesaje: hay ingredientes sin stock suficiente en SAP.',
        data: {
          ingredientes_sin_stock: sinStock.map(i => ({
            nombre: i.ingrediente_nombre,
            requerido_kg: parseFloat(i.cantidad_kilos),
            disponible_kg: Math.max(0, parseFloat(i.stock_almp) - parseFloat(i.committed_almp || 0)),
          })),
        },
      });
    }

    // Validar que ingredientes con lotes SAP tengan lote registrado y válido
    const loteValidResult = await db.query(
      `SELECT im.ingrediente_sap_code, im.ingrediente_nombre, im.lote,
              inv.manage_batch_numbers
       FROM ingredientes_masa im
       LEFT JOIN sap_inventario_mp inv ON inv.item_code = im.ingrediente_sap_code
       WHERE im.masa_id = $1
         AND im.es_empaque = false
         AND im.pesado = true`,
      [masaId]
    );

    const sinLoteRequerido = [];
    const loteInvalidoSAP  = [];

    for (const ing of loteValidResult.rows) {
      if (!ing.manage_batch_numbers) continue; // ítem sin manejo de lotes: saltar

      if (!ing.lote || ing.lote.trim() === '') {
        sinLoteRequerido.push(ing.ingrediente_nombre);
        continue;
      }

      // Verificar que el lote exista en sap_lotes_mp
      const loteExiste = await db.query(
        `SELECT 1 FROM sap_lotes_mp WHERE item_code = $1 AND batch = $2 LIMIT 1`,
        [ing.ingrediente_sap_code, ing.lote.trim()]
      );
      if (loteExiste.rowCount === 0) {
        loteInvalidoSAP.push({ nombre: ing.ingrediente_nombre, lote: ing.lote });
      }
    }

    if (sinLoteRequerido.length > 0 || loteInvalidoSAP.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'No se puede confirmar el pesaje: hay ingredientes con lote inválido o faltante.',
        data: {
          sin_lote:      sinLoteRequerido,
          lote_invalido: loteInvalidoSAP.map(i => `${i.nombre} (lote: ${i.lote})`),
          instruccion:   'Sincronice el inventario MP desde SAP para actualizar los lotes disponibles.',
        },
      });
    }

    // Verificar que todos los ingredientes estén pesados
    const resultado = await fasesModel.checkTodosPesados(masaId);
    logger.info(`Verificación pesaje masa ${masaId}: ${JSON.stringify(resultado)}`);

    if (!resultado.completo) {
      logger.warn(`Pesaje incompleto para masa ${masaId}. Faltantes: ${resultado.faltantes.join(', ')}`);
      return res.status(400).json({
        success: false,
        message: 'No se puede confirmar el pesaje. Hay ingredientes pendientes.',
        data: {
          total:        resultado.total,
          completados:  resultado.completados,
          faltantes:    resultado.faltantes,
        },
      });
    }

    // Completar fase PESAJE de la masa actual
    await fasesModel.updateEstadoFase(
      masaId, 'PESAJE', 'COMPLETADA', 100, req.user.id,
      { confirmado_en: new Date() }
    );
    logger.info(`Fase PESAJE completada para masa ${masaId}`);

    // ── Asignar lote_produccion si aún no tiene ────────────────
    try {
      const masaLoteResult = await db.query(
        `SELECT mp.id, mp.tipo_masa, mp.fecha_produccion,
                mp.lote_produccion, mp.subdivision_letra,
                ctm.codigo_lote
         FROM masas_produccion mp
         LEFT JOIN catalogo_tipos_masa ctm ON mp.tipo_masa = ctm.tipo_masa
         WHERE mp.id = $1
         LIMIT 1`,
        [masaId]
      );

      if (masaLoteResult.rows.length > 0) {
        const m = masaLoteResult.rows[0];

        // Solo asignar si aún no tiene lote
        if (!m.lote_produccion) {
          const codigoBase = m.codigo_lote || m.tipo_masa.substring(0, 4).toUpperCase();
          const fecha      = new Date(m.fecha_produccion);
          const dd   = String(fecha.getUTCDate()).padStart(2, '0');
          const mm   = String(fecha.getUTCMonth() + 1).padStart(2, '0');
          const yy   = String(fecha.getUTCFullYear()).slice(-2);
          const sufijo     = m.subdivision_letra ? `-${m.subdivision_letra}` : '';
          const lote       = `${codigoBase}${dd}${mm}${yy}${sufijo}`;

          await db.query(
            `UPDATE masas_produccion SET lote_produccion = $1 WHERE id = $2`,
            [lote, masaId]
          );
          logger.info(`Lote asignado a masa ${masaId}: ${lote}`);
        }
      }
    } catch (loteErr) {
      // No interrumpir el flujo si falla la asignación de lote
      logger.error(`Error asignando lote a masa ${masaId}:`, loteErr);
    }
    // ── Fin asignación lote ────────────────────────────────────

    // ── NUEVO v4: Intentar subdivisión con pesaje heredado ─────────
    let subdivision = null;
    try {
      subdivision = await ejecutarSubdivision(masaId, req.user.id, true /* conPesaje */);
    } catch (subErr) {
      // Si falla la subdivisión, NO cortamos el flujo: el pesaje ya se confirmó.
      // Logueamos el error para investigación.
      logger.error(`Error durante subdivisión de masa ${masaId}:`, subErr);
    }

    if (subdivision) {
      // La masa fue subdividida. Las sub-masas ya tienen PESAJE completado.
      logger.info(`Masa ${masaId} subdividida en ${subdivision.n_tandas} tandas después del pesaje.`);

      // Enviar salida de inventario SAP (no bloquea)
      enviarGoodsIssuePesaje(masaId, req.user.id).catch(() => {});

      return res.json({
        success: true,
        message: `Pesaje confirmado. La masa supera el límite de ${subdivision.limite_kg} kg y fue dividida en ${subdivision.n_tandas} tandas. Cada tanda ya tiene el pesaje registrado.`,
        data: {
          fase_completada:    'PESAJE',
          fase_desbloqueada:  'AMASADO',
          subdivision,
        },
      });
    }

    // ── Flujo estándar sin subdivisión ─────────────────────────────
    const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'PESAJE');
    logger.info(`Fase desbloqueada después de PESAJE: ${siguienteFase?.fase || 'AMASADO'}`);

    // Calcular y guardar costos de MP
    try {
      const ingCostosResult = await db.query(
        `SELECT im.id, im.ingrediente_sap_code, im.cantidad_kilos, inv.costo_promedio
         FROM ingredientes_masa im
         LEFT JOIN sap_inventario_mp inv ON inv.item_code = im.ingrediente_sap_code
         WHERE im.masa_id = $1 AND im.es_empaque = false`,
        [masaId]
      );

      let costoMPTotal = 0;
      let kilosMasaReal = 0;

      for (const ing of ingCostosResult.rows) {
        const costo = parseFloat(ing.costo_promedio || 0);
        const kilos = parseFloat(ing.cantidad_kilos || 0);
        const costoTotal = costo * kilos;
        costoMPTotal += costoTotal;
        kilosMasaReal += kilos;

        await db.query(
          `UPDATE ingredientes_masa
           SET costo_unitario_sap = $1, costo_total_mp = $2
           WHERE id = $3`,
          [costo, costoTotal, ing.id]
        );
      }

      const costoPorKilo = kilosMasaReal > 0 ? costoMPTotal / kilosMasaReal : 0;

      // Upsert en costos_masa
      await db.query(
        `INSERT INTO costos_masa
           (masa_id, costo_mp_total, costo_total_masa, kilos_masa_real, costo_por_kilo, fecha_calculo_mp)
         VALUES ($1, $2, $2, $3, $4, NOW())
         ON CONFLICT (masa_id) DO UPDATE SET
           costo_mp_total     = EXCLUDED.costo_mp_total,
           costo_total_masa   = EXCLUDED.costo_mp_total,
           kilos_masa_real    = EXCLUDED.kilos_masa_real,
           costo_por_kilo     = EXCLUDED.costo_por_kilo,
           fecha_calculo_mp   = NOW(),
           updated_at         = NOW()`,
        [masaId, costoMPTotal, kilosMasaReal, costoPorKilo]
      );

      // Prorratear costo por producto
      const productosResult = await db.query(
        `SELECT id, kilos_programados FROM productos_por_masa WHERE masa_id = $1`,
        [masaId]
      );

      for (const prod of productosResult.rows) {
        const kilosProd = parseFloat(prod.kilos_programados || 0);
        const costoMPUnitario = kilosMasaReal > 0 ? (costoMPTotal / kilosMasaReal) * kilosProd : 0;
        await db.query(
          `UPDATE productos_por_masa
           SET costo_mp_unitario = $1, costo_mp_total_prod = $2
           WHERE id = $3`,
          [costoPorKilo, costoMPUnitario, prod.id]
        );
      }

      logger.info(`Costos MP calculados para masa ${masaId}: $${costoMPTotal.toFixed(2)} total, $${costoPorKilo.toFixed(2)}/kg`);
    } catch (costoError) {
      logger.warn(`Error calculando costos MP para masa ${masaId} (no bloquea):`, costoError.message);
    }

    // Enviar salida de inventario SAP (no bloquea)
    enviarGoodsIssuePesaje(masaId, req.user.id).catch(() => {});

    res.json({
      success: true,
      message: 'Pesaje confirmado exitosamente',
      data: {
        fase_completada:   'PESAJE',
        fase_desbloqueada: siguienteFase?.fase || 'AMASADO',
        subdivision:       null,
      },
    });
  } catch (error) {
    logger.error('Error al confirmar pesaje:', error);
    logger.error('Stack trace:', error.stack);
    next(error);
  }
};

/**
 * @desc    Enviar correo al área de empaque
 * @route   POST /api/pesaje/:masaId/enviar-correo
 * @access  Private
 */
const enviarCorreoEmpaque = async (req, res, next) => {
  try {
    const { masaId } = req.params;

    const progresoFases = await fasesModel.getProgresoFases(masaId);
    const fasePesaje    = progresoFases.find(f => f.fase === 'PESAJE');

    if (!fasePesaje || fasePesaje.estado !== 'COMPLETADA') {
      return res.status(400).json({
        success: false,
        message: 'El pesaje debe estar completado antes de enviar el correo',
      });
    }

    const masa      = await fasesModel.getMasaById(masaId);
    const productos = await fasesModel.getProductosByMasa(masaId);

    const destinatarios = ['empaque@artesa.com'];
    const asunto        = `Pesaje completado - Masa ${masa.codigo_masa}`;
    const cuerpo        = `
      Se ha completado el pesaje de la masa ${masa.codigo_masa}.
      Tipo: ${masa.tipo_masa}
      Fecha de producción: ${masa.fecha_produccion}
      Total kilos: ${masa.total_kilos_con_merma}
      Productos: ${productos.length}
    `;

    const notificacion = await fasesModel.createNotificacionEmpaque({
      masa_id:       masaId,
      destinatarios,
      asunto,
      cuerpo,
      estado_envio:  'PENDIENTE',
      fecha_envio:   null,
      error_mensaje: null,
      enviado_por:   req.user.id,
    });

    res.json({
      success: true,
      message: 'Notificación registrada (correo pendiente de envío)',
      data: {
        enviado:     false,
        destinatarios,
        fecha_envio: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error al enviar correo:', error);
    next(error);
  }
};

module.exports = {
  getChecklist,
  updateIngrediente,
  confirmarPesaje,
  enviarCorreoEmpaque,
};
