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
      ingredientes,
      todosDisponibles,
      todosVerificados,
      todosPesados,
      completado,
      progreso,
      productos_con_ajuste: productosConAjuste,
      hay_ajustes_divisor:  hayAjustesDiv,
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
