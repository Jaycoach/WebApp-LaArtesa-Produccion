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
// Fix B: la subdivisión (y su lógica de ajuste de grupo "Fase 4") se movió a
// completarFase('planificacion') en fases.controller.js — este archivo ya no
// necesita importar nada de subdivisión/plan de lotes.
const { sendPesajeCompletadoEmail } = require('../services/email.service');
const { upqDesdeProducto } = require('../utils/unidadesPorPaquete');

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

    // Adjuntar datos de stock a cada ingrediente
    const ingredientesConStock = ingredientes.map(ing => {
      const esExcluido = excluidos.includes(ing.ingrediente_sap_code);
      const inv = inventarioMap[ing.ingrediente_sap_code] || null;
      // Disponibilidad real = solo stock_almp. committed_almp (OV abiertas comprometiendo
      // el ítem) es informativo — no debe bloquear el pesaje: si hay stock físico, hay.
      const stockDisponible = inv ? parseFloat(inv.stock_almp) : null;
      const cantidadRequerida = parseFloat(ing.cantidad_kilos) || 0;
      // Excluidos (agua) solo se libran de manejo de LOTE hacia SAP — el stock
      // real SIEMPRE se valida igual que cualquier otro ingrediente.
      // Una vez pesado, el ingrediente ya se consumió físicamente — no se
      // vuelve a marcar sin_stock aunque el stock global caiga después
      // (ej: otra masa consume el mismo ítem). El bloqueo por stock
      // insuficiente solo aplica mientras pesado = false.
      const sinStock = !ing.pesado && (inv !== null && stockDisponible < cantidadRequerida);
      const costoUnitario = inv ? parseFloat(inv.costo_promedio) : null;
      // Lotes ordenados por expiration_date ASC (FEFO) → el primero es el sugerido
      const lotes = lotesMap[ing.ingrediente_sap_code] || [];
      return {
        ...ing,
        stock_almp:          inv ? parseFloat(inv.stock_almp) : null,
        committed_almp:      inv ? parseFloat(inv.committed_almp) : null,
        stock_disponible:    stockDisponible,
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
              // FIX 2026-08-24: toFixed(3) redondeaba a gramo entero (0.001 kg),
              // colapsando a 0 cualquier ingrediente traza del BOM (< 0.5 g, ej.
              // AJONJOLI NEGRO a 0.00001 kg) — con eso, la fila que se insertaba
              // en pesaje_lotes_consumo (cantidad_kg NUMERIC(12,6), CHECK > 0)
              // violaba el CHECK y tiraba un 500 sin mensaje. toFixed(6) conserva
              // la misma precisión que ya trae sap_bom_componentes.cantidad.
              sugerido.push({ batch: l.batch, cantidad_kg: Number(aTomar.toFixed(6)) });
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
      const upq = upqDesdeProducto(p.unidades_por_paquete, p.producto_nombre);
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
      codigo_masa:          masa.codigo_masa,
      lote_produccion:      masa.lote_produccion,
      lotes_simulados:      masa.lotes_simulados,
      tipo_masa:            masa.tipo_masa,
      fase_actual:          masa.fase_actual,
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
    if (error.status === 422) {
      return res.status(422).json({
        success: false,
        message: error.message,
        data: { lote_fallido: error.lote || null },
      });
    }
    logger.error('Error al actualizar ingrediente:', error);
    next(error);
  }
};

/**
 * Clasifica un error de SAP en una de tres categorías:
 *  - 'CONEXION': Service Layer inalcanzable (red caída, timeout, DNS). No es
 *    un rechazo de negocio — no debe bloquear el pesaje.
 *  - 'AUTENTICACION': la sesión SAP nunca se estableció por una razón que NO
 *    es de red (credenciales de integración inválidas/vencidas, usuario
 *    bloqueado en SAP, CompanyDB mal configurada). SAP nunca llegó a
 *    procesar el documento — es una caída de infraestructura tan real como
 *    CONEXION, no un rechazo de negocio del documento en sí, así que se
 *    trata IGUAL que CONEXION (pendiente_sap = true).
 *  - 'NEGOCIO': SAP sí procesó el documento y lo rechazó (stock
 *    insuficiente, lote inexistente, etc.) — sigue bloqueando.
 *
 * Usa `err.code` (señal estructurada de axios/Node, ej. 'ECONNREFUSED')
 * cuando está disponible, además del regex sobre el mensaje — el regex solo
 * es necesario porque sap.service.js re-envuelve algunos errores en un
 * `new Error(...)` de texto libre antes de que lleguen hasta acá.
 */
const CODIGOS_RED_SAP = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNABORTED', 'EAI_AGAIN',
]);

const clasificarErrorSAP = (mensaje, err) => {
  const codigoRed = err?.code || err?.cause?.code;
  if (codigoRed && CODIGOS_RED_SAP.has(codigoRed)) return 'CONEXION';

  const patronesConexion = /ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|Couldn't connect to server|timeout/i;
  if (patronesConexion.test(mensaje || '')) return 'CONEXION';

  // La sesión SAP falló en login() (ver sap.service.js) por una razón que ya
  // descartamos que sea de red arriba — es un fallo de autenticación real
  // (credenciales/usuario/CompanyDB), no un rechazo de negocio de ningún
  // documento (SAP nunca llegó a ver el InventoryGenExit).
  const statusLogin = err?.response?.status || err?.cause?.response?.status;
  const esFalloDeLogin = /^Error de autenticación SAP:/i.test(mensaje || '');
  if (esFalloDeLogin || statusLogin === 401 || statusLogin === 403) {
    return 'AUTENTICACION';
  }

  return 'NEGOCIO';
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
  let rows = [];
  try {
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
    rows = result.rows;

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
         AND im.es_empaque = false`,
      [masaId]
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
         AND plc.id IS NULL`,
      [masaId]
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

    return { success: true, docEntry, docNum, rows };

  } catch (err) {
    const tiempoRespuesta = Date.now() - inicio;
    let sapMsg = err?.response?.data?.error?.message?.value
      || err?.response?.data?.error?.message
      || err?.response?.data?.message
      || err.message;
    logger.error(`SAP error detalle masa ${masaId}:`, JSON.stringify(err?.response?.data || {}));
    logger.error(`Error enviando InventoryGenExits para masa ${masaId}: ${sapMsg}`);

    const tipoError = clasificarErrorSAP(sapMsg, err);

    if (tipoError === 'CONEXION' || tipoError === 'AUTENTICACION') {
      // Service Layer inalcanzable, o la sesión SAP no se pudo establecer por
      // credenciales/CompanyDB (AUTENTICACION) — en ninguno de los dos casos
      // es un rechazo de negocio del documento. No bloqueamos el pesaje: se
      // deja el consumo como PENDING para reenvío posterior desde
      // /api/pesaje/sap-pendientes. Las rows ya se construyeron ANTES del intento
      // de red, así que se puede descontar el inventario local igual que en éxito.
      try {
        await db.query(
          `INSERT INTO sap_sync_log
             (tipo_operacion, estado, masa_id, request_payload,
              error_message, tiempo_respuesta, usuario_id)
           VALUES ('GOODS_ISSUE_PESAJE', 'PENDING', $1, $2, $3, $4, $5)`,
          [
            masaId,
            JSON.stringify(requestPayload),
            sapMsg,
            tiempoRespuesta,
            usuarioId,
          ]
        );
      } catch (logErr) {
        logger.error(`Error logueando PENDING InventoryGenExits masa ${masaId}:`, logErr.message);
      }
      logger.warn(`SAP no disponible (${tipoError.toLowerCase()}) para masa ${masaId}: ${sapMsg}. Pesaje continúa con sincronización pendiente.`);
      return { success: true, pendiente_sap: true, docEntry: null, docNum: null, rows };
    }

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
    // Parsear error de stock insuficiente en ítem SIN lote (ej: agua, MP0007/MP0008).
    // SAP no reporta ItemCode/batch en este mensaje, solo el número de línea del documento.
    const matchNegativeInventory = sapMsg.match(/Quantity falls into negative inventory\s*\[DocumentLines\.\w+\]\[line:\s*(\d+)\]/i);
    if (matchNegativeInventory) {
      const filaFallida = parseInt(matchNegativeInventory[1], 10);
      const itemFallido = requestPayload?.DocumentLines?.[filaFallida - 1]?.ItemCode || null;
      if (itemFallido) {
        try {
          const nombreRes = await db.query(
            `SELECT item_name FROM sap_inventario_mp WHERE item_code = $1 LIMIT 1`,
            [itemFallido]
          );
          const itemNombre = nombreRes.rows[0]?.item_name || itemFallido;
          sapMsg = `Stock insuficiente en SAP para ${itemFallido} (${itemNombre}) — no hay inventario suficiente para completar la salida. Verificar con Diana/SAP antes de reintentar.`;
        } catch (nombreErr) {
          logger.warn(`Error consultando nombre de ítem para negative inventory ${itemFallido}:`, nombreErr.message);
        }
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

    const sinStock = ingResult.rows.filter(ing => {
      // Excluidos (agua) solo se libran de manejo de LOTE — el stock real se
      // valida igual que cualquier otro ingrediente.
      if (!ing.stock_almp && ing.stock_almp !== 0) return false; // sin datos SAP: no bloquear
      // Disponibilidad real = solo stock_almp. committed_almp (OV abiertas
      // comprometiendo el ítem) es informativo — no bloquea: si hay stock, hay.
      const disponible = parseFloat(ing.stock_almp);
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
            disponible_kg: Math.max(0, parseFloat(i.stock_almp)),
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

    // ── Validar antigüedad del snapshot de stock por lote (Hallazgo 3) ───
    // sap_lotes_mp.cantidad_disponible es un snapshot cacheado (sync
    // programado 2x/día). Las reservas locales en pesaje_lotes_consumo NO
    // lo descuentan (ver comentarios en fases.model.js) -- así que un lote
    // puede seguir apareciendo "disponible" en Orbit por horas/días después
    // de agotarse en SAP. Sin este chequeo, el checklist completo deja
    // avanzar con normalidad y el error real de SAP solo aparece tarde, en
    // esta misma llamada, después de que el usuario ya pesó todo. Se
    // bloquea acá, antes de intentar SAP, si algún lote reservado para esta
    // masa tiene un snapshot más viejo que el umbral configurado.
    const umbralConfigResult = await db.query(
      `SELECT valor FROM configuracion_sistema WHERE clave = 'pesaje_umbral_sync_lotes_horas'`
    );
    const umbralHoras = umbralConfigResult.rows.length > 0
      ? parseFloat(umbralConfigResult.rows[0].valor)
      : 6; // default: cron de sync corre 2x/día

    const lotesUsadosResult = await db.query(
      `SELECT DISTINCT im.ingrediente_nombre, plc.item_code, plc.batch, sl.ultimo_sync,
              EXTRACT(EPOCH FROM (NOW() - sl.ultimo_sync)) / 3600 AS horas_desde_sync
       FROM pesaje_lotes_consumo plc
       JOIN ingredientes_masa im ON im.id = plc.ingrediente_id
       LEFT JOIN sap_lotes_mp sl ON sl.item_code = plc.item_code AND sl.batch = plc.batch
       WHERE plc.masa_id = $1 AND plc.confirmado_sap = false`,
      [masaId]
    );

    const lotesDesactualizados = lotesUsadosResult.rows.filter(
      l => l.ultimo_sync === null || parseFloat(l.horas_desde_sync) > umbralHoras
    );

    if (lotesDesactualizados.length > 0) {
      // Hallazgo 4: mensaje en lenguaje llano (sin "snapshot") — item_code se
      // incluye para que el frontend pueda ofrecer "Sincronizar ahora" sobre
      // justo estos ítems, sin que el usuario navegue a otra pantalla.
      return res.status(409).json({
        success: false,
        message: `El stock de ${lotesDesactualizados.length} producto(s) no se ha actualizado en las últimas ${umbralHoras} horas. Sincroniza el inventario antes de confirmar.`,
        data: {
          lotes_desactualizados: lotesDesactualizados.map(l => ({
            ingrediente:      l.ingrediente_nombre,
            item_code:        l.item_code,
            lote:             l.batch,
            ultimo_sync:      l.ultimo_sync,
            horas_desde_sync: l.ultimo_sync ? Math.round(parseFloat(l.horas_desde_sync) * 10) / 10 : null,
          })),
          instruccion: 'Sincroniza el inventario y vuelve a intentar confirmar.',
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

    // Fix B (mover subdivisión a completarFase('planificacion')): la
    // subdivisión real ya ocurrió, si correspondía, al completar
    // Planificación ("Iniciar Pesaje") — mucho antes de este punto. Para
    // cuando se llega acá, `masaId` es SIEMPRE una masa pesable por sí
    // misma: la masa original si nunca necesitó subdividirse, o una tanda
    // (sub-masa) individual si sí. Ya no hay nada que subdividir ni SAP que
    // enviar "por lote completo" — cada tanda se pesa y confirma por
    // separado, con su propio documento SAP (comportamiento esperado, no
    // un caso especial). El bloque `if (subdivision) {...}` que existía acá
    // (carga de plan, segunda pasada de ajuste de grupo "Fase 4", llamada a
    // ejecutarSubdivision, envío a SAP del lote completo) se eliminó por
    // completo — quedaba muerto tras el cambio.
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

    if (sapResult.pendiente_sap) {
      // SAP inalcanzable por conexión (no error de negocio): completar Pesaje y
      // desbloquear Amasado igual que en el flujo exitoso, pero SIN persistir
      // sap_doc_entry_pesaje/sap_doc_num_pesaje (no hay documento SAP real aún).
      // El registro quedó en sap_sync_log como PENDING para reenvío en
      // /api/pesaje/sap-pendientes/reenviar cuando SAP vuelva a estar disponible.
      await fasesModel.updateEstadoFase(
        masaId, 'PESAJE', 'COMPLETADA', 100, req.user.id,
        { confirmado_en: new Date() }
      );
      logger.info(`Fase PESAJE completada para masa ${masaId} (SAP pendiente de sincronización)`);
      await fasesModel.updateEstadoFase(masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, {});
      const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'PESAJE');
      logger.info(`Fase desbloqueada después de PESAJE: ${siguienteFase?.fase || 'AMASADO'}`);

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
        message: 'Pesaje confirmado. SAP no disponible — el consumo se sincronizará automáticamente cuando se restablezca la conexión.',
        data: {
          fase_completada:   'PESAJE',
          fase_desbloqueada: siguienteFase?.fase || 'AMASADO',
          pendiente_sap:     true,
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

    // Fija la línea base para detectar ajustes futuros (ediciones post-transmisión).
    // Sin esto, calcularAjustesPendientes excluye todo el checklist (peso_confirmado_sap IS NULL)
    // y "Revisar ajustes pendientes SAP" queda ciego para cualquier masa transmitida.
    await db.query(
      `UPDATE ingredientes_masa
       SET peso_confirmado_sap = peso_real
       WHERE masa_id = $1 AND pesado = true`,
      [masaId]
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
  // cantidad_disponible es el stock real de SAP — las reservas nunca lo
  // restaron, así que al cancelar no hay nada que "devolver" ahí. Solo se
  // marca liberado_en para que quede claro que la reserva ya no es activa.
  // No se elimina el registro: se conserva para auditoría y reportes de OVs
  // canceladas.
  const liberados = await db.query(
    `UPDATE pesaje_lotes_consumo SET liberado_en = NOW()
     WHERE masa_id = $1 AND confirmado_sap = false AND liberado_en IS NULL`,
    [masaId]
  );
  logger.info(`Stock devuelto para masa cancelada ${masaId}: ${liberados.rowCount} lotes liberados`);
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

/**
 * @desc    Lista transmisiones de pesaje a SAP pendientes de sincronizar
 *          (quedaron PENDING porque el Service Layer estaba inalcanzable, o
 *          la sesión SAP no se pudo autenticar), AGRUPADAS POR FECHA DE
 *          PRODUCCIÓN de la masa — vive como sección de Sincronizar SAP,
 *          no dentro de Pesaje.
 * @route   GET /api/pesaje/sap-pendientes
 * @access  Private (admin, supervisor)
 */
const getPendientesSAP = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT ssl.id, ssl.masa_id, ssl.request_payload, ssl.error_message,
              ssl.fecha_operacion, ssl.intentos, ssl.usuario_id,
              mp.codigo_masa, mp.tipo_masa, mp.lote_produccion, mp.fase_actual,
              mp.fecha_produccion
       FROM sap_sync_log ssl
       LEFT JOIN masas_produccion mp ON mp.id = ssl.masa_id
       WHERE ssl.estado = 'PENDING' AND ssl.tipo_operacion = 'GOODS_ISSUE_PESAJE'
       ORDER BY mp.fecha_produccion DESC NULLS LAST, ssl.fecha_operacion ASC`
    );

    // Agrupar en JS (no en SQL) — más simple de leer y de mantener que un
    // array_agg/json_agg, y el volumen esperado (pendientes reales) es bajo.
    const grupos = new Map();
    for (const row of result.rows) {
      // fecha_produccion es DATE — Postgres ya la devuelve como string 'YYYY-MM-DD'
      // vía el driver de node-postgres, no como objeto Date, así que no hace
      // falta convertir timezone.
      const clave = row.fecha_produccion || 'sin_fecha';
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(row);
    }

    const data = Array.from(grupos.entries()).map(([fecha_produccion, masas]) => ({
      fecha_produccion,
      total: masas.length,
      masas,
    }));

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Error en getPendientesSAP:', error);
    next(error);
  }
};

/**
 * @desc    Reenvía a SAP uno o más registros de pesaje pendientes de sincronizar,
 *          reutilizando el request_payload tal cual quedó guardado (NO se
 *          reconstruye llamando a enviarInventoryGenExits de nuevo: los lotes
 *          reservados en pesaje_lotes_consumo ya quedaron marcados
 *          confirmado_sap=true al momento del pesaje original, así que
 *          recalcular el payload perdería los BatchNumbers — reenviar el
 *          documento ya armado es lo correcto). NO vuelve a descontar
 *          inventario local — ya se descontó en el pesaje original.
 *
 *          Acepta `ids` (array explícito de sap_sync_log.id) o
 *          `fecha_produccion` ('YYYY-MM-DD', o 'todas') para reintentar en
 *          lote todo lo pendiente de un día de producción — la UI vive en
 *          Sincronizar SAP, agrupada por fecha.
 * @route   POST /api/pesaje/sap-pendientes/reenviar
 * @access  Private (admin, supervisor)
 */
const reenviarPendientesSAP = async (req, res, next) => {
  try {
    const { fecha_produccion } = req.body;
    let { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      if (!fecha_produccion) {
        return res.status(400).json({
          success: false,
          message: 'Debe indicar "ids" (array) o "fecha_produccion" ("YYYY-MM-DD", o "todas").',
        });
      }
      const query = fecha_produccion === 'todas'
        ? `SELECT ssl.id FROM sap_sync_log ssl
           WHERE ssl.estado = 'PENDING' AND ssl.tipo_operacion = 'GOODS_ISSUE_PESAJE'`
        : `SELECT ssl.id FROM sap_sync_log ssl
           JOIN masas_produccion mp ON mp.id = ssl.masa_id
           WHERE ssl.estado = 'PENDING' AND ssl.tipo_operacion = 'GOODS_ISSUE_PESAJE'
             AND mp.fecha_produccion = $1`;
      const params = fecha_produccion === 'todas' ? [] : [fecha_produccion];
      const idsResult = await db.query(query, params);
      ids = idsResult.rows.map((r) => r.id);

      if (ids.length === 0) {
        return res.json({
          success: true,
          message: 'No hay transmisiones pendientes para ese grupo.',
          data: [],
          resumen: { total: 0, exitosos: 0, fallidos: 0 },
        });
      }
    }

    const pendientesResult = await db.query(
      `SELECT id, masa_id, request_payload
       FROM sap_sync_log
       WHERE id = ANY($1) AND estado = 'PENDING' AND tipo_operacion = 'GOODS_ISSUE_PESAJE'`,
      [ids]
    );

    await sapService.ensureSession();

    const resultados = [];
    for (const log of pendientesResult.rows) {
      const inicio = Date.now();
      try {
        const response = await sapService.client.post('/InventoryGenExits', log.request_payload);
        const tiempoRespuesta = Date.now() - inicio;
        const docEntry = response.data?.DocEntry ?? null;
        const docNum   = response.data?.DocNum   ? String(response.data.DocNum) : null;

        if (log.masa_id) {
          await db.query(
            `UPDATE masas_produccion
             SET sap_doc_entry_pesaje = $1, sap_doc_num_pesaje = $2, updated_at = NOW()
             WHERE id = $3`,
            [docEntry, docNum, log.masa_id]
          );
          // Misma línea base que en el flujo de éxito original — necesaria para
          // que calcularAjustesPendientes no excluya esta masa después.
          await db.query(
            `UPDATE ingredientes_masa
             SET peso_confirmado_sap = peso_real
             WHERE masa_id = $1 AND pesado = true`,
            [log.masa_id]
          );
        }

        await db.query(
          `UPDATE sap_sync_log
           SET estado = 'SUCCESS', sap_docentry = $1, sap_docnum = $2,
               response_payload = $3, tiempo_respuesta = $4, intentos = intentos + 1
           WHERE id = $5`,
          [
            docEntry,
            docNum,
            JSON.stringify({ DocEntry: docEntry, DocNum: docNum, masa_id: log.masa_id }),
            tiempoRespuesta,
            log.id,
          ]
        );

        logger.info(`Reenvío SAP exitoso sap_sync_log ${log.id} (masa ${log.masa_id}): DocEntry ${docEntry}`);
        resultados.push({ id: log.id, masa_id: log.masa_id, success: true, sap_doc_entry: docEntry, sap_doc_num: docNum });
      } catch (err) {
        const tiempoRespuesta = Date.now() - inicio;
        const sapMsg = err?.response?.data?.error?.message?.value
          || err?.response?.data?.error?.message
          || err?.response?.data?.message
          || err.message;
        const tipoError = clasificarErrorSAP(sapMsg, err);

        if (tipoError === 'CONEXION' || tipoError === 'AUTENTICACION') {
          await db.query(
            `UPDATE sap_sync_log
             SET intentos = intentos + 1, error_message = $1, tiempo_respuesta = $2
             WHERE id = $3`,
            [sapMsg, tiempoRespuesta, log.id]
          );
          logger.warn(`Reenvío SAP sigue fallando por ${tipoError.toLowerCase()}, sap_sync_log ${log.id} permanece PENDING: ${sapMsg}`);
          resultados.push({ id: log.id, masa_id: log.masa_id, success: false, pendiente_sap: true, error: sapMsg });
        } else {
          await db.query(
            `UPDATE sap_sync_log
             SET estado = 'ERROR', intentos = intentos + 1, error_message = $1, tiempo_respuesta = $2
             WHERE id = $3`,
            [sapMsg, tiempoRespuesta, log.id]
          );
          logger.error(`Reenvío SAP falló por error de negocio, sap_sync_log ${log.id} marcado ERROR (requiere revisión manual): ${sapMsg}`);
          resultados.push({ id: log.id, masa_id: log.masa_id, success: false, pendiente_sap: false, requiere_revision: true, error: sapMsg });
        }
      }
    }

    const exitosos = resultados.filter((r) => r.success).length;
    res.json({
      success: true,
      message: `Reintento procesado: ${exitosos}/${resultados.length} exitoso(s).`,
      data: resultados,
      resumen: { total: resultados.length, exitosos, fallidos: resultados.length - exitosos },
    });
  } catch (error) {
    logger.error('Error en reenviarPendientesSAP:', error);
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
  getPendientesSAP,
  reenviarPendientesSAP,
};
