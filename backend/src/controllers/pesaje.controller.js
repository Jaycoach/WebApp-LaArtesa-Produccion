/**
 * Controlador para gestión de pesaje y checklist
 */

const fasesModel = require('../models/fases.model');
const logger = require('../utils/logger');

/**
 * @desc    Obtener checklist de pesaje de una masa
 * @route   GET /api/pesaje/:masaId/checklist
 * @access  Private
 */
const getChecklist = async (req, res, next) => {
  try {
    const { masaId } = req.params;

    // Obtener masa
    const masa = await fasesModel.getMasaById(masaId);
    if (!masa) {
      return res.status(404).json({
        success: false,
        message: 'Masa no encontrada',
      });
    }

    // Obtener ingredientes con su estado de checklist
    const ingredientes = await fasesModel.getIngredientesByMasa(masaId);

    // Obtener progreso de la fase de pesaje
    const progresoFases = await fasesModel.getProgresoFases(masaId);
    const fasePesaje = progresoFases.find(f => f.fase === 'PESAJE');

    // Calcular estadísticas del checklist
    const total = ingredientes.length;
    const disponibles = ingredientes.filter(i => i.disponible).length;
    const verificados = ingredientes.filter(i => i.verificado).length;
    const pesados = ingredientes.filter(i => i.pesado).length;

    const todosDisponibles = disponibles === total;
    const todosVerificados = verificados === total;
    const todosPesados = pesados === total;
    const completado = todosDisponibles && todosVerificados && todosPesados;

    // Calcular progreso
    const progreso = total > 0
      ? Math.round(((disponibles + verificados + pesados) / (total * 3)) * 100)
      : 0;

    const checklist = {
      masa_id: masa.id,
      tipo_masa: masa.tipo_masa,
      fecha_inicio: fasePesaje?.fecha_inicio,
      usuario_responsable: fasePesaje?.usuario_responsable,
      ingredientes,
      todosDisponibles,
      todosVerificados,
      todosPesados,
      completado,
      progreso,
    };

    res.json({
      success: true,
      data: checklist,
    });
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
      fecha_vencimiento,
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
 */
const confirmarPesaje = async (req, res, next) => {
  try {
    const { masaId } = req.params;

    // Verificar que todos los ingredientes estén pesados
    const resultado = await fasesModel.checkTodosPesados(masaId);

    if (!resultado.completo) {
      return res.status(400).json({
        success: false,
        message: 'No se puede confirmar el pesaje. Hay ingredientes pendientes.',
        data: {
          total: resultado.total,
          completados: resultado.completados,
          faltantes: resultado.faltantes,
        },
      });
    }

    // Completar la fase de pesaje
    await fasesModel.updateEstadoFase(
      masaId,
      'PESAJE',
      'COMPLETADA',
      100,
      req.user.id,
      { confirmado_en: new Date() }
    );

    // Desbloquear la fase de amasado
    const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'PESAJE');

    res.json({
      success: true,
      message: 'Pesaje confirmado exitosamente',
      data: {
        fase_completada: 'PESAJE',
        fase_desbloqueada: siguienteFase?.fase || 'AMASADO',
      },
    });
  } catch (error) {
    logger.error('Error al confirmar pesaje:', error);
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

    // Verificar que el pesaje esté completado
    const progresoFases = await fasesModel.getProgresoFases(masaId);
    const fasePesaje = progresoFases.find(f => f.fase === 'PESAJE');

    if (!fasePesaje || fasePesaje.estado !== 'COMPLETADA') {
      return res.status(400).json({
        success: false,
        message: 'El pesaje debe estar completado antes de enviar el correo',
      });
    }

    // Obtener información de la masa
    const masa = await fasesModel.getMasaById(masaId);
    const productos = await fasesModel.getProductosByMasa(masaId);

    // TODO: Implementar lógica real de envío de correo
    // Por ahora simularemos el envío
    const destinatarios = ['empaque@artesa.com']; // Esto debería venir de la configuración
    const asunto = `Pesaje completado - Masa ${masa.codigo_masa}`;
    const cuerpo = `
      Se ha completado el pesaje de la masa ${masa.codigo_masa}.
      Tipo: ${masa.tipo_masa}
      Fecha de producción: ${masa.fecha_produccion}
      Total kilos: ${masa.total_kilos_con_merma}
      Productos: ${productos.length}
    `;

    // Registrar la notificación
    const notificacion = await fasesModel.createNotificacionEmpaque({
      masa_id: masaId,
      destinatarios,
      asunto,
      cuerpo,
      estado_envio: 'PENDIENTE', // Cambiar a 'ENVIADO' cuando se implemente el envío real
      fecha_envio: null,
      error_mensaje: null,
      enviado_por: req.user.id,
    });

    res.json({
      success: true,
      message: 'Notificación registrada (correo pendiente de envío)',
      data: {
        enviado: false, // Cambiar a true cuando se implemente el envío real
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
