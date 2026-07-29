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
const { sendPesajeCompletadoEmail } = require('../services/email.service');

/**
 * Notifica a correos_empaque al completar pesaje. Fire-and-forget — nunca bloquea.
 */
const notificarPesajeCompletado = async (masaId) => {
  try {
    const configResult = await db.query(
      `SELECT valor FROM configuracion_sistema WHERE clave = 'correos_empaque'`
    );
    const valor = configResult.rows[0]?.valor || '';
    const destinatarios = valor.split(',').map(e => e.trim()).filter(Boolean);
    if (destinatarios.length === 0) return;

    const masaResult = await db.query(
      `SELECT codigo_masa, tipo_masa, fecha_produccion,
              total_kilos_con_merma, lote_produccion, es_repeticion
       FROM masas_produccion WHERE id = $1`,
      [masaId]
    );
    if (!masaResult.rows.length) return;

    await sendPesajeCompletadoEmail({
      to: destinatarios.join(','),
      masa: masaResult.rows[0],
    });
    logger.info(`Notificación pesaje enviada para masa ${masaId} a: ${destinatarios.join(', ')}`);
  } catch (err) {
    logger.warn(`Notificación pesaje masa ${masaId} falló (no bloquea): ${err.message}`);
  }
};

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
           AND cantidad_disponible > 0
         ORDER BY item_code, expiration_date ASC NULLS LAST, admission_date ASC NULLS LAST`,
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
      // Lotes ordenados por expiration_date ASC (FEFO) → el primero es el sugerido
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
        lotes_consumo_sugerido: (() => {
          let restante = cantidadRequerida;
          const sugerido = [];
          for (const l of lotes) {
            if (restante <= 0) break;
            const aTomar = Math.min(parseFloat(l.cantidad_disponible), restante);
            if (aTomar > 0) {
              sugerido.push({ batch: l.batch, cantidad_kg: Number(aTomar.toFixed(3)) });
              restante -= aTomar;
            }
          }
          return sugerido;
        })(),
      };
    });

    const progresoFases = await fasesModel.getProgresoFases(masaId);
    const fasePesaje    = progresoFases.find(f => f.fase === 'PESAJE');

    // Decoración no exige los 3 checks manuales — se excluye del cálculo de progreso
    // para que la barra no quede atascada esperando algo que nunca se marca a mano.
    const ingredientesRequierenCheck = ingredientes.filter(i => !i.es_decoracion);

    const total          = ingredientesRequierenCheck.length;
    const disponibles    = ingredientesRequierenCheck.filter(i => i.disponible).length;
    const verificados    = ingredientesRequierenCheck.filter(i => i.verificado).length;
    const pesados        = ingredientesRequierenCheck.filter(i => i.pesado).length;

    const todosDisponibles = disponibles === total;
    const todosVerificados = verificados === total;
    const todosPesados     = pesados === total;
    const completado       = todosDisponibles && todosVerificados && todosPesados;

    const progreso = total > 0
      ? Math.round(((disponibles + verificados + pesados) / (total * 3)) * 100)
      : 100;

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

    // Productos con total de panes calculado
    const productosResult = await db.query(
      `SELECT producto_nombre, sap_item_code, unidades_pedidas,
              unidades_programadas, unidades_ajustadas, multiplo_divisor,
              unidades_por_paquete, cantidad_paquetes
       FROM productos_por_masa
       WHERE masa_id = $1
       ORDER BY producto_nombre`,
      [masaId]
    );
    const productosResumen = productosResult.rows.map(p => {
      const upq = (p.unidades_por_paquete && parseFloat(p.unidades_por_paquete) > 1)
        ? parseFloat(p.unidades_por_paquete)
        : (() => { const m = new RegExp(' X ?(\\d+)', 'i').exec(p.producto_nombre || ''); return m ? parseInt(m[1]) : 1; })();
      // Usar unidades_ajustadas (múltiplo del divisor) si aplica, si no unidades_programadas
      const paqAProducir = (parseInt(p.multiplo_divisor) > 0 && parseInt(p.unidades_ajustadas) > 0)
        ? parseInt(p.unidades_ajustadas)
        : parseInt(p.unidades_programadas);
      return {
        producto_nombre:      p.producto_nombre,
        sap_item_code:        p.sap_item_code,
        unidades_pedidas:     parseInt(p.unidades_pedidas),
        unidades_programadas: parseInt(p.unidades_programadas),
        unidades_ajustadas:   parseInt(p.unidades_ajustadas) || parseInt(p.unidades_programadas),
        multiplo_divisor:     parseInt(p.multiplo_divisor) || 0,
        unidades_por_paquete: upq,
        panes_totales:        paqAProducir * upq,
      };
    });

    const checklist = {
      masa_id:              masa.id,
      tipo_masa:            masa.tipo_masa,
      es_repeticion:        masa.es_repeticion ?? false,
      sap_doc_entry_pesaje: masa.sap_doc_entry_pesaje ?? null,
      sap_doc_num_pesaje:   masa.sap_doc_num_pesaje   ?? null,
      pesaje_transmitido:   !!(masa.sap_doc_entry_pesaje),
      pesaje_completado:    !!(masa.sap_doc_entry_pesaje) || fasePesaje?.estado === 'COMPLETADA',
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
      productos_resumen:         productosResumen,
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

    // Bloqueo estricto: el pesaje solo es editable hasta que Amasado se
    // complete. Una vez la masa avanza (División, Formado, Fermentación,
    // Horneado, Empaque), modificar un ingrediente ya usado en producción
    // no tiene sentido físico y queda prohibido — sin excepción de rol.
    const masaR = await db.query(`SELECT fase_actual FROM masas_produccion WHERE id = $1`, [masaId]);
    if (!masaR.rows.length) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }
    const fasesEditables = ['PLANIFICACION', 'PESAJE', 'AMASADO'];
    if (!fasesEditables.includes(masaR.rows[0].fase_actual)) {
      return res.status(403).json({
        success: false,
        message: `No se puede modificar el pesaje: la masa ya avanzó a la fase ${masaR.rows[0].fase_actual}. El pesaje solo es editable hasta completar Amasado.`,
      });
    }

    const {
      disponible,
      verificado,
      pesado,
      peso_real,
      lote,
      fecha_vencimiento,
      observaciones,
      lotes_consumo, // [{batch, cantidad_kg}] — opcional
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
      lotes_consumo,
    };

    const ingrediente = await fasesModel.updateIngredienteChecklist(ingredienteId, data);
    if (!ingrediente) {
      return res.status(404).json({ success: false, message: 'Ingrediente no encontrado' });
    }
    res.json({ success: true, data: ingrediente, message: 'Ingrediente actualizado correctamente' });

  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        success: false,
        message: error.message,
        data: {
          lote_fallido:   error.lote        || null,
          disponible:     error.disponible  ?? null,
          lotes_actuales: error.lotes_actuales || [],
        },
      });
    }
    logger.error('Error al actualizar ingrediente:', error);
    next(error);
  }
};

/**
 * Envía salida de inventario a SAP (InventoryGenExits) por los ingredientes pesados.
 * No bloquea el flujo de producción — errores son capturados y logueados.
 */
// Descuenta inventario local tras confirmación exitosa de SAP
const descontarInventarioLocal = async (rows, masaId) => {
  // 1. Descontar stock general por ítem en sap_inventario_mp
  for (const ing of rows) {
    const cantidadKg = parseFloat(ing.peso_real) / 1000;
    await db.query(
      `UPDATE sap_inventario_mp
       SET stock_almp  = GREATEST(0, stock_almp - $1),
           ultimo_sync = NOW()
       WHERE item_code = $2`,
      [cantidadKg, ing.ingrediente_sap_code]
    );
  }

  // 2. Descontar cantidad por lote en sap_lotes_mp usando pesaje_lotes_consumo
  // Solo filas aún no confirmadas, por si esta función se llama más de una vez (defensivo)
  const lotesResult = await db.query(
    `SELECT item_code, batch, cantidad_kg FROM pesaje_lotes_consumo WHERE masa_id = $1 AND confirmado_sap = false`,
    [masaId]
  );
  for (const lote of lotesResult.rows) {
    await db.query(
      `UPDATE sap_lotes_mp
       SET cantidad_disponible = GREATEST(0, cantidad_disponible - $1),
           ultimo_sync         = NOW()
       WHERE item_code = $2 AND batch = $3`,
      [parseFloat(lote.cantidad_kg), lote.item_code, lote.batch]
    );
  }

  // Marcar como confirmadas: ya se restaron acá, el sync periódico no debe
  // volver a restarlas como "reservado" (eso causaba el doble descuento).
  await db.query(
    `UPDATE pesaje_lotes_consumo SET confirmado_sap = true, confirmado_en = NOW()
     WHERE masa_id = $1 AND confirmado_sap = false`,
    [masaId]
  );

  logger.info(`Inventario local descontado para masa ${masaId}: ${rows.length} ítems, ${lotesResult.rows.length} lotes`);
};

// Envía InventoryGenExit a SAP. Retorna { success, docEntry, rows } o { success: false, error }
const enviarInventoryGenExits = async (masaId, usuarioId, fechaLocal) => {
  const inicio = Date.now();
  let requestPayload = null;
  try {
    // Ítems excluidos del consumo SAP (agua, insumos propios sin lote SAP)
    const configExc = await db.query(
      `SELECT valor FROM configuracion_sistema WHERE clave = 'ingredientes_excluir_stock_validacion'`
    );
    const excluidos = configExc.rows.length > 0
      ? configExc.rows[0].valor.split(',').map(c => c.trim()).filter(Boolean)
      : [];
    const excluidosParam = excluidos.length > 0 ? excluidos : null;

    const result = await db.query(
      `SELECT im.ingrediente_sap_code, im.ingrediente_nombre,
              im.peso_real, im.lote,
              inv.manage_batch_numbers
       FROM ingredientes_masa im
       LEFT JOIN sap_inventario_mp inv ON inv.item_code = im.ingrediente_sap_code
       WHERE im.masa_id = $1
         AND im.es_empaque = false
         AND im.pesado = true
         AND im.peso_real > 0
         AND ($2::text[] IS NULL OR im.ingrediente_sap_code != ALL($2::text[]))`,
      [masaId, excluidosParam]
    );

    if (result.rows.length === 0) {
      logger.warn(`InventoryGenExits masa ${masaId}: sin ingredientes pesados, omitiendo.`);
      return { success: true, docEntry: null, rows: [] };
    }

    const today = fechaLocal || new Date().toISOString().split('T')[0];

    // Leer lotes reservados en pesaje_lotes_consumo para esta masa
    const lotesResult = await db.query(
      `SELECT plc.item_code, plc.batch, plc.cantidad_kg,
              inv.manage_batch_numbers
       FROM pesaje_lotes_consumo plc
       JOIN ingredientes_masa im ON im.id = plc.ingrediente_id
       LEFT JOIN sap_inventario_mp inv ON inv.item_code = plc.item_code
       WHERE plc.masa_id = $1
         AND plc.confirmado_sap = false
         AND plc.liberado_en IS NULL
         AND im.es_empaque = false
         AND ($2::text[] IS NULL OR plc.item_code != ALL($2::text[]))`,
      [masaId, excluidosParam]
    );

    // Agrupar por item_code (un ítem puede tener múltiples lotes)
    const itemMap = {};
    for (const r of lotesResult.rows) {
      if (!itemMap[r.item_code]) {
        itemMap[r.item_code] = { manage_batch_numbers: r.manage_batch_numbers, total_kg: 0, batches: [] };
      }
      itemMap[r.item_code].total_kg += parseFloat(r.cantidad_kg);
      itemMap[r.item_code].batches.push({ batch: r.batch, cantidad_kg: parseFloat(r.cantidad_kg) });
    }

    // Ingredientes sin lotes en pesaje_lotes_consumo (ej: sin manejo de batch) → usar peso_real directo
    const sinLotesResult = await db.query(
      `SELECT im.ingrediente_sap_code, im.peso_real, im.lote, inv.manage_batch_numbers
       FROM ingredientes_masa im
       LEFT JOIN sap_inventario_mp inv ON inv.item_code = im.ingrediente_sap_code
       LEFT JOIN pesaje_lotes_consumo plc ON plc.ingrediente_id = im.id
       WHERE im.masa_id = $1
         AND im.es_empaque = false
         AND im.pesado = true
         AND im.peso_real > 0
         AND plc.id IS NULL
         AND ($2::text[] IS NULL OR im.ingrediente_sap_code != ALL($2::text[]))`,
      [masaId, excluidosParam]
    );
    for (const r of sinLotesResult.rows) {
      if (!itemMap[r.ingrediente_sap_code]) {
        const totalKg = parseFloat(r.peso_real) / 1000;
        const batches = (r.manage_batch_numbers && r.lote)
          ? [{ batch: r.lote, cantidad_kg: totalKg }]
          : [];
        itemMap[r.ingrediente_sap_code] = {
          manage_batch_numbers: r.manage_batch_numbers,
          total_kg: totalKg,
          batches,
        };
      }
    }

    const documentLines = Object.entries(itemMap).map(([itemCode, data]) => {
      const line = {
        ItemCode:         itemCode,
        Quantity:         data.total_kg,
        WarehouseCode:    'ALMP',
        AccountCode:      '14100501',
        DistributionRule: 'Operac',
      };
      if (data.manage_batch_numbers && data.batches.length > 0) {
        line.BatchNumbers = data.batches.map(b => ({
          BatchNumber: b.batch,
          Quantity:    b.cantidad_kg,
        }));
      }
      return line;
    });

    // Obtener codigo_masa para U_JZ_NumMasa
    const codigoMasaR = await db.query(
      `SELECT codigo_masa FROM masas_produccion WHERE id = $1`, [masaId]
    );
    const codigoMasaPesaje = codigoMasaR.rows[0]?.codigo_masa || String(masaId);

    requestPayload = {
      DocDate:       today,
      Comments:      `Consumo pesaje masa ${masaId}`,
      U_JZ_NumMasa:  String(masaId),
      DocumentLines: documentLines,
    };

    await sapService.ensureSession();
    const response = await sapService.client.post('/InventoryGenExits', requestPayload);

    const tiempoRespuesta = Date.now() - inicio;
    const docEntry = response.data?.DocEntry ?? null;
    const docNum   = response.data?.DocNum   ? String(response.data.DocNum) : null;
    logger.info(`InventoryGenExits enviado para masa ${masaId}: DocEntry ${docEntry}, DocNum ${docNum}`);

    // INSERT de log aislado: un fallo aquí NO debe contaminar el resultado exitoso de SAP
    try {
      await db.query(
        `INSERT INTO sap_sync_log
           (tipo_operacion, estado, sap_docentry, sap_docnum,
            request_payload, response_payload, tiempo_respuesta, usuario_id)
         VALUES ('GOODS_ISSUE_PESAJE', 'SUCCESS', $1, $2, $3, $4, $5, $6)`,
        [
          docEntry,
          docNum,
          JSON.stringify(requestPayload),
          JSON.stringify({ DocEntry: docEntry, DocNum: docNum, masa_id: masaId }),
          tiempoRespuesta,
          usuarioId,
        ]
      );
    } catch (logErr) {
      logger.warn(`Error logueando SUCCESS InventoryGenExits masa ${masaId} (no bloquea):`, logErr.message);
    }

    return { success: true, docEntry, docNum, rows: result.rows };

  } catch (err) {
    const tiempoRespuesta = Date.now() - inicio;
    const sapMsg = err?.response?.data?.error?.message?.value
      || err?.response?.data?.error?.message
      || err?.response?.data?.message
      || err.message;
    logger.error(`SAP error detalle masa ${masaId}:`, JSON.stringify(err?.response?.data || {}));
    logger.error(`Error enviando InventoryGenExits para masa ${masaId}: ${sapMsg}`);
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
      logger.error(`Error logueando fallo InventoryGenExits masa ${masaId}:`, logErr.message);
    }
    // Parsear error de stock insuficiente SAP (código 10001153)
    let lote_fallido = null;
    let alternativas = [];
    const matchStock = sapMsg.match(/10001153 - Insufficient quantity for item (\S+) with batch (\S+)/i);
    // Parsear error de batch inexistente en SAP (lote no existe en esta compañía/BD de SAP)
    const matchBatchNoExiste = sapMsg.match(/Batch\/serial number (\S+) selected in row (\d+) does not exist/i);
    if (matchBatchNoExiste) {
      const batchFallido = matchBatchNoExiste[1];
      const filaFallida = parseInt(matchBatchNoExiste[2], 10);
      const itemFallido = requestPayload?.DocumentLines?.[filaFallida - 1]?.ItemCode || null;
      if (itemFallido) {
        lote_fallido = { item_code: itemFallido, batch: batchFallido };
        try {
          const alt = await db.query(
            `SELECT sl.batch, sl.cantidad_disponible, sl.expiration_date,
                    si.item_name
             FROM sap_lotes_mp sl
             LEFT JOIN sap_inventario_mp si ON si.item_code = sl.item_code
             WHERE sl.item_code = $1
               AND sl.batch != $2
               AND sl.cantidad_disponible > 0
               AND (sl.status IS NULL OR sl.status = 'released')
             ORDER BY sl.expiration_date ASC NULLS LAST, sl.admission_date ASC NULLS LAST
             LIMIT 5`,
            [itemFallido, batchFallido]
          );
          alternativas = alt.rows;
          const nombreRes = await db.query(
            `SELECT item_name FROM sap_inventario_mp WHERE item_code = $1 LIMIT 1`,
            [itemFallido]
          );
          lote_fallido.item_name = nombreRes.rows[0]?.item_name || itemFallido;
        } catch (altErr) {
          logger.warn(`Error consultando alternativas de lote para ${itemFallido}:`, altErr.message);
        }
      }
    }
    if (matchStock) {
      const itemFallido = matchStock[1];
      const batchFallido = matchStock[2];
      lote_fallido = { item_code: itemFallido, batch: batchFallido };
      try {
        const alt = await db.query(
          `SELECT sl.batch, sl.cantidad_disponible, sl.expiration_date,
                  si.item_name
           FROM sap_lotes_mp sl
           LEFT JOIN sap_inventario_mp si ON si.item_code = sl.item_code
           WHERE sl.item_code = $1
             AND sl.batch != $2
             AND sl.cantidad_disponible > 0
             AND (sl.status IS NULL OR sl.status = 'released')
           ORDER BY sl.expiration_date ASC NULLS LAST, sl.admission_date ASC NULLS LAST
           LIMIT 5`,
          [itemFallido, batchFallido]
        );
        alternativas = alt.rows;
        // Agregar nombre del ingrediente al lote_fallido para mensaje claro al usuario
        const nombreRes = await db.query(
          `SELECT item_name FROM sap_inventario_mp WHERE item_code = $1 LIMIT 1`,
          [itemFallido]
        );
        lote_fallido.item_name = nombreRes.rows[0]?.item_name || itemFallido;
      } catch (altErr) {
        logger.warn(`Error consultando alternativas de lote para ${itemFallido}:`, altErr.message);
      }
    }
    return { success: false, error: sapMsg, lote_fallido, alternativas };
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
    const fecha_local = req.body?.fecha_local || null;
    logger.info(`Confirmando pesaje para masa ${masaId}`);

    // Validar que la masa esté APROBADA + control de idempotencia SAP
    const masaCheck = await db.query(
      `SELECT estado, sap_doc_entry_pesaje, sap_doc_num_pesaje FROM masas_produccion WHERE id = $1`, [masaId]
    );
    if (!masaCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }
    const masaRow = masaCheck.rows[0];
    if (masaRow.estado !== 'APROBADA') {
      return res.status(403).json({
        success: false,
        message: `La masa debe estar en estado APROBADA para confirmar el pesaje. Estado actual: ${masaRow.estado}`,
        estado: masaRow.estado,
      });
    }
    // Idempotencia: si ya se transmitió a SAP, solo completar fases sin re-enviar
    if (masaRow.sap_doc_entry_pesaje) {
      logger.info(`Masa ${masaId}: pesaje ya transmitido (DocNum ${masaRow.sap_doc_num_pesaje}). Completando fases sin re-envío SAP.`);
      await fasesModel.updateEstadoFase(masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, {});
      await fasesModel.updateEstadoFase(masaId, 'PESAJE', 'COMPLETADA', 100, req.user.id, { confirmado_en: new Date() });
      // Red de seguridad: si el intento original dejó filas sin marcar
      // (por ejemplo, descontarInventarioLocal falló a medias), las cerramos aquí.
      // No se vuelve a restar cantidad_disponible — solo se evita que el sync
      // las siga contando como "reservado" indefinidamente.
      await db.query(
        `UPDATE pesaje_lotes_consumo SET confirmado_sap = true, confirmado_en = NOW()
         WHERE masa_id = $1 AND confirmado_sap = false`,
        [masaId]
      );
      await db.query(
        `UPDATE progreso_fases SET estado = 'EN_PROGRESO', updated_at = NOW()
         WHERE masa_id = $1 AND fase = 'AMASADO' AND estado = 'BLOQUEADA'`, [masaId]
      );
      await db.query(
        `UPDATE masas_produccion SET fase_actual = 'AMASADO', updated_at = NOW() WHERE id = $1`, [masaId]
      );
      return res.json({
        success: true,
        message: `Pesaje ya transmitido a SAP. Salida Nº ${masaRow.sap_doc_num_pesaje}. Fases corregidas.`,
        data: {
          fase_completada:    'PESAJE',
          fase_desbloqueada:  'AMASADO',
          sap_doc_entry:      masaRow.sap_doc_entry_pesaje,
          sap_doc_num:        masaRow.sap_doc_num_pesaje,
          ya_transmitido:     true,
        },
      });
    }

    // Auto-completar ingredientes de decoración: nadie los pesa a mano, pero sí se
    // descuentan del inventario asignando lote FEFO (mismo criterio que el resto del sistema).
    await fasesModel.autoCompletarDecoracion(masaId, req.user.id);

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

    // NOTA: fase PESAJE se marca COMPLETADA solo tras SAP OK (más abajo)
    // No se hacen cambios de fase aquí para evitar estados inconsistentes
    logger.info(`Fase PESAJE validada para masa ${masaId}, esperando confirmación SAP`);

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

      // Enviar a SAP — bloqueante
      const sapResult = await enviarInventoryGenExits(masaId, req.user.id, fecha_local);
      if (!sapResult.success) {
        // Rollback: revertir PESAJE a EN_PROGRESO y AMASADO a BLOQUEADA
        try {
          await fasesModel.updateEstadoFase(masaId, 'PESAJE', 'EN_PROGRESO', 90, req.user.id, {});
          await db.query(
            `UPDATE progreso_fases SET estado = 'BLOQUEADA', porcentaje_completado = 0
             WHERE masa_id = $1 AND fase = 'AMASADO'`,
            [masaId]
          );
          await db.query(
            `UPDATE masas_produccion SET fase_actual = 'PESAJE', estado = 'APROBADA' WHERE id = $1`,
            [masaId]
          );
        } catch (rollbackErr) {
          logger.error(`Error en rollback de masa ${masaId}:`, rollbackErr.message);
        }
        return res.status(502).json({
          success: false,
          message: `No se pudo registrar el consumo en SAP: ${sapResult.error}`,
          data: {
            reintentable: true,
            lote_fallido:  sapResult.lote_fallido  || null,
            alternativas:  sapResult.alternativas  || [],
          },
        });
      }

      // SAP OK → descontar inventario local
      if (sapResult.rows.length > 0) {
        try {
          await descontarInventarioLocal(sapResult.rows, masaId);
        } catch (descErr) {
          logger.error(`Error descontando inventario local masa ${masaId}:`, descErr.message);
        }
      }

      notificarPesajeCompletado(masaId); // fire-and-forget
      return res.json({
        success: true,
        message: `Pesaje confirmado. La masa supera el límite de ${subdivision.limite_kg} kg y fue dividida en ${subdivision.n_tandas} tandas. Cada tanda ya tiene el pesaje registrado.`,
        data: {
          fase_completada:    'PESAJE',
          fase_desbloqueada:  'AMASADO',
          sap_docentry:       sapResult.docEntry,
          subdivision,
        },
      });
    }

    // ── Flujo estándar sin subdivisión ─────────────────────────────
    // NOTA: desbloquearSiguienteFase se ejecuta DESPUÉS de guardar sap_doc_entry_pesaje
    // para evitar que el rollback de SAP pise un desbloqueo ya exitoso.

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
        `SELECT id, kilos_programados, unidades_programadas FROM productos_por_masa WHERE masa_id = $1`,
        [masaId]
      );

      for (const prod of productosResult.rows) {
        const kilosProd = parseFloat(prod.kilos_programados || 0);
        const costoMPTotalProd = kilosMasaReal > 0 ? (costoMPTotal / kilosMasaReal) * kilosProd : 0;
        const unidadesProg = parseFloat(prod.unidades_programadas || 1);
        const costoMPUnitarioPorPaquete = unidadesProg > 0 ? costoMPTotalProd / unidadesProg : 0;
        await db.query(
          `UPDATE productos_por_masa
           SET costo_mp_unitario = $1, costo_mp_total_prod = $2
           WHERE id = $3`,
          [costoMPUnitarioPorPaquete, costoMPTotalProd, prod.id]
        );
      }

      logger.info(`Costos MP calculados para masa ${masaId}: $${costoMPTotal.toFixed(2)} total, $${costoPorKilo.toFixed(2)}/kg`);
    } catch (costoError) {
      logger.warn(`Error calculando costos MP para masa ${masaId} (no bloquea):`, costoError.message);
    }

    // Enviar a SAP — bloqueante. PESAJE aún no se marcó COMPLETADA, no hay nada que revertir.
    const sapResult = await enviarInventoryGenExits(masaId, req.user.id, fecha_local);
    if (!sapResult.success) {
      return res.status(502).json({
        success: false,
        message: `No se pudo registrar el consumo en SAP: ${sapResult.error}`,
        data: {
          reintentable: true,
          lote_fallido:  sapResult.lote_fallido  || null,
          alternativas:  sapResult.alternativas  || [],
        },
      });
    }

    // SAP OK → primero persistir idempotencia, luego avanzar fases (orden crítico)
    await db.query(
      `UPDATE masas_produccion
       SET sap_doc_entry_pesaje = $1, sap_doc_num_pesaje = $2, updated_at = NOW()
       WHERE id = $3`,
      [sapResult.docEntry, sapResult.docNum, masaId]
    );

    // Ahora sí: marcar PESAJE=COMPLETADA y desbloquear AMASADO
    await fasesModel.updateEstadoFase(
      masaId, 'PESAJE', 'COMPLETADA', 100, req.user.id,
      { confirmado_en: new Date() }
    );
    logger.info(`Fase PESAJE completada para masa ${masaId}`);
    await fasesModel.updateEstadoFase(masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, {});
    const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'PESAJE');
    logger.info(`Fase desbloqueada después de PESAJE: ${siguienteFase?.fase || 'AMASADO'}`);

    // SAP OK → descontar inventario local
    if (sapResult.rows.length > 0) {
      try {
        await descontarInventarioLocal(sapResult.rows, masaId);
      } catch (descErr) {
        logger.error(`Error descontando inventario local masa ${masaId}:`, descErr.message);
      }
    }

    notificarPesajeCompletado(masaId); // fire-and-forget
    res.json({
      success: true,
      message: `Pesaje confirmado. Salida SAP Nº ${sapResult.docNum || sapResult.docEntry} creada exitosamente.`,
      data: {
        fase_completada:   'PESAJE',
        fase_desbloqueada: siguienteFase?.fase || 'AMASADO',
        sap_doc_entry:     sapResult.docEntry,
        sap_doc_num:       sapResult.docNum,
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

/**
 * Devuelve al stock local todos los lotes reservados de una masa.
 * Llamar al cancelar o rechazar una masa que tenga pesaje en progreso.
 */
const devolverStockMasa = async (masaId) => {
  const lotes = await db.query(
    `SELECT item_code, batch, SUM(cantidad_kg) as total_kg
     FROM pesaje_lotes_consumo
     WHERE masa_id = $1 AND confirmado_sap = false AND liberado_en IS NULL
     GROUP BY item_code, batch`,
    [masaId]
  );
  for (const l of lotes.rows) {
    await db.query(
      `UPDATE sap_lotes_mp
       SET cantidad_disponible = cantidad_disponible + $1, ultimo_sync = NOW()
       WHERE item_code = $2 AND batch = $3`,
      [l.total_kg, l.item_code, l.batch]
    );
  }
  // No se elimina el registro: se conserva para auditoría y reportes de OVs
  // canceladas. Solo se marca liberado_en para que el sync no lo siga
  // contando como reservado.
  await db.query(
    `UPDATE pesaje_lotes_consumo SET liberado_en = NOW()
     WHERE masa_id = $1 AND confirmado_sap = false AND liberado_en IS NULL`,
    [masaId]
  );
  logger.info(`Stock devuelto para masa cancelada ${masaId}: ${lotes.rows.length} lotes liberados`);
};

/**
 * Calcula, para cada ingrediente de una masa ya transmitida a SAP, la diferencia
 * pendiente de sincronizar (excedente/faltante) contra la línea base peso_confirmado_sap,
 * descontando ajustes ya exitosos previos. Solo lectura — no llama a SAP.
 */
const calcularAjustesPendientes = async (masaId) => {
  const ingR = await db.query(
    `SELECT im.id, im.ingrediente_sap_code, im.ingrediente_nombre,
            im.peso_real, im.peso_confirmado_sap, im.lote
     FROM ingredientes_masa im
     WHERE im.masa_id = $1
       AND im.es_empaque = false
       AND im.pesado = true
       AND im.peso_confirmado_sap IS NOT NULL`,
    [masaId]
  );

  const prevR = await db.query(
    `SELECT ingrediente_id, COALESCE(SUM(delta_gramos), 0) AS ajustado_previo
     FROM pesaje_ajustes_sap
     WHERE masa_id = $1 AND sap_doc_entry IS NOT NULL
     GROUP BY ingrediente_id`,
    [masaId]
  );
  const prevMap = {};
  for (const r of prevR.rows) prevMap[r.ingrediente_id] = parseFloat(r.ajustado_previo);

  const pendientes = [];
  for (const ing of ingR.rows) {
    const pesoBase = parseFloat(ing.peso_confirmado_sap);
    const pesoActual = parseFloat(ing.peso_real);
    const ajustadoPrevio = prevMap[ing.id] || 0;
    const delta = parseFloat((pesoActual - pesoBase - ajustadoPrevio).toFixed(2));
    if (Math.abs(delta) >= 0.01) {
      pendientes.push({
        ingrediente_id: ing.id,
        ingrediente_sap_code: ing.ingrediente_sap_code,
        ingrediente_nombre: ing.ingrediente_nombre,
        peso_confirmado_sap: pesoBase,
        ajustado_previo: ajustadoPrevio,
        peso_actual: pesoActual,
        delta_gramos: delta,
        tipo: delta > 0 ? 'EXCEDENTE' : 'FALTANTE',
        lote: ing.lote,
      });
    }
  }
  return pendientes;
};

/**
 * @desc    Lista ajustes pendientes de sincronizar con SAP, SIN transmitir nada.
 * @route   GET /api/pesaje/:masaId/ajustes-pendientes
 * @access  Private
 */
const getAjustesPendientes = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const masaR = await db.query(`SELECT sap_doc_entry_pesaje FROM masas_produccion WHERE id = $1`, [masaId]);
    if (!masaR.rows.length) return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    if (!masaR.rows[0].sap_doc_entry_pesaje) {
      return res.json({ success: true, data: { pesaje_transmitido: false, pendientes: [] } });
    }
    const pendientes = await calcularAjustesPendientes(masaId);
    res.json({ success: true, data: { pesaje_transmitido: true, pendientes } });
  } catch (error) {
    logger.error('Error en getAjustesPendientes:', error);
    next(error);
  }
};

// Inserta filas de auditoría exitosas y actualiza stock local
const registrarAjustesYStock = async (masaId, items, docInfo, usuarioId) => {
  for (const p of items) {
    await db.query(
      `INSERT INTO pesaje_ajustes_sap
         (masa_id, ingrediente_id, ingrediente_sap_code, ingrediente_nombre,
          peso_confirmado_sap_g, ajustado_previo_g, peso_nuevo_g, delta_gramos,
          tipo, lote, sap_doc_entry, sap_doc_num, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [masaId, p.ingrediente_id, p.ingrediente_sap_code, p.ingrediente_nombre,
       p.peso_confirmado_sap, p.ajustado_previo, p.peso_actual, p.delta_gramos,
       p.tipo, p.lote, docInfo.doc_entry, docInfo.doc_num, usuarioId]
    );
    const signo = p.tipo === 'EXCEDENTE' ? -1 : 1;
    const cantidadKg = Math.abs(p.delta_gramos) / 1000;
    await db.query(
      `UPDATE sap_inventario_mp SET stock_almp = GREATEST(0, stock_almp + $1), ultimo_sync = NOW()
       WHERE item_code = $2`,
      [signo * cantidadKg, p.ingrediente_sap_code]
    );
    await db.query(
      `UPDATE sap_lotes_mp SET cantidad_disponible = GREATEST(0, cantidad_disponible + $1), ultimo_sync = NOW()
       WHERE item_code = $2 AND batch = $3`,
      [signo * cantidadKg, p.ingrediente_sap_code, p.lote]
    );
  }
};

// Inserta filas de auditoría con error (sap_doc_entry queda NULL — no cuentan como "ya enviadas",
// así que el próximo intento las vuelve a incluir automáticamente)
const registrarAjustesFallidos = async (masaId, items, errorMsg, usuarioId) => {
  for (const p of items) {
    await db.query(
      `INSERT INTO pesaje_ajustes_sap
         (masa_id, ingrediente_id, ingrediente_sap_code, ingrediente_nombre,
          peso_confirmado_sap_g, ajustado_previo_g, peso_nuevo_g, delta_gramos,
          tipo, lote, sap_error, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [masaId, p.ingrediente_id, p.ingrediente_sap_code, p.ingrediente_nombre,
       p.peso_confirmado_sap, p.ajustado_previo, p.peso_actual, p.delta_gramos,
       p.tipo, p.lote, errorMsg, usuarioId]
    );
  }
};

/**
 * @desc    Transmite a SAP TODOS los ajustes pendientes de una masa, agrupados en
 *          un único InventoryGenExits (excedentes) y/o un único InventoryGenEntries
 *          (faltantes) — mismo patrón multi-línea que el pesaje original.
 * @route   POST /api/pesaje/:masaId/ajustes-pendientes/confirmar
 * @access  Private
 */
const confirmarAjustesPendientes = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const masaR = await db.query(`SELECT sap_doc_entry_pesaje FROM masas_produccion WHERE id = $1`, [masaId]);
    if (!masaR.rows.length) return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    if (!masaR.rows[0].sap_doc_entry_pesaje) {
      return res.status(422).json({ success: false, message: 'El pesaje aún no ha sido transmitido a SAP.' });
    }

    const pendientes = await calcularAjustesPendientes(masaId);
    if (pendientes.length === 0) {
      return res.json({ success: true, message: 'No hay ajustes pendientes por transmitir.', data: { procesados: [] } });
    }

    const sinLote = pendientes.filter(p => !p.lote);
    if (sinLote.length > 0) {
      return res.status(422).json({
        success: false,
        message: `Sin lote registrado, no se pueden ajustar en SAP: ${sinLote.map(p => p.ingrediente_nombre).join(', ')}`,
      });
    }

    const excedentes = pendientes.filter(p => p.tipo === 'EXCEDENTE');
    const faltantes  = pendientes.filter(p => p.tipo === 'FALTANTE');

    await sapService.ensureSession();
    const hoy = new Date().toISOString().split('T')[0];
    const resultado = { excedente: null, faltante: null, errores: [] };

    if (excedentes.length > 0) {
      try {
        const resp = await sapService.client.post('/InventoryGenExits', {
          DocDate: hoy,
          Comments: `Ajuste excedentes pesaje masa ${masaId}`,
          U_JZ_NumMasa: String(masaId),
          DocumentLines: excedentes.map(p => ({
            ItemCode: p.ingrediente_sap_code,
            Quantity: Math.abs(p.delta_gramos) / 1000,
            WarehouseCode: 'ALMP',
            AccountCode: '14100501',
            DistributionRule: 'Operac',
            BatchNumbers: [{ BatchNumber: p.lote, Quantity: Math.abs(p.delta_gramos) / 1000 }],
          })),
        });
        resultado.excedente = { doc_entry: resp.data?.DocEntry, doc_num: String(resp.data?.DocNum || '') };
        await registrarAjustesYStock(masaId, excedentes, resultado.excedente, req.user.id);
      } catch (err) {
        const msg = err?.response?.data?.error?.message?.value || err?.response?.data?.error?.message || err.message;
        resultado.errores.push({ tipo: 'EXCEDENTE', mensaje: msg });
        await registrarAjustesFallidos(masaId, excedentes, msg, req.user.id);
      }
    }

    if (faltantes.length > 0) {
      try {
        const resp = await sapService.client.post('/InventoryGenEntries', {
          DocDate: hoy,
          Comments: `Ajuste faltantes pesaje masa ${masaId}`,
          U_JZ_NumMasa: String(masaId),
          DocumentLines: faltantes.map(p => ({
            ItemCode: p.ingrediente_sap_code,
            Quantity: Math.abs(p.delta_gramos) / 1000,
            WarehouseCode: 'ALMP',
            AccountCode: '14100501',
            DistributionRule: 'Operac',
            BatchNumbers: [{ BatchNumber: p.lote, Quantity: Math.abs(p.delta_gramos) / 1000 }],
          })),
        });
        resultado.faltante = { doc_entry: resp.data?.DocEntry, doc_num: String(resp.data?.DocNum || '') };
        await registrarAjustesYStock(masaId, faltantes, resultado.faltante, req.user.id);
      } catch (err) {
        const msg = err?.response?.data?.error?.message?.value || err?.response?.data?.error?.message || err.message;
        resultado.errores.push({ tipo: 'FALTANTE', mensaje: msg });
        await registrarAjustesFallidos(masaId, faltantes, msg, req.user.id);
      }
    }

    res.json({
      success: resultado.errores.length === 0,
      message: resultado.errores.length === 0
        ? 'Ajustes transmitidos a SAP correctamente.'
        : `Algunos ajustes fallaron: ${resultado.errores.map(e => e.mensaje).join(' | ')}`,
      data: resultado,
    });
  } catch (error) {
    logger.error('Error en confirmarAjustesPendientes:', error);
    next(error);
  }
};

module.exports = {
  getChecklist,
  updateIngrediente,
  confirmarPesaje,
  enviarCorreoEmpaque,
  devolverStockMasa,
  getAjustesPendientes,
  confirmarAjustesPendientes,
  calcularAjustesPendientes,
};
