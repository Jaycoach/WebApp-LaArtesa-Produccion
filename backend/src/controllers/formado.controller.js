/**
 * Controlador para el proceso de FORMADO
 * Basado en reunión 23/01/2026
 */

const db = require('../database/connection');
const logger = require('../utils/logger');

/**
 * Obtener información de formado para una masa
 * GET /api/formado/:masaId
 */
exports.getFormadoInfo = async (req, res) => {
  try {
    const { masaId } = req.params;

    // Verificar que la masa existe y que requiere formado
    const masaQuery = `
      SELECT
        mp.id,
        mp.uuid,
        mp.codigo_masa,
        mp.tipo_masa,
        mp.nombre_masa,
        mp.estado,
        mp.fase_actual,
        ctm.requiere_formado,
        ctm.requiere_reposo_pre_division,
        ctm.tiempo_reposo_division_minutos
      FROM masas_produccion mp
      LEFT JOIN catalogo_tipos_masa ctm ON mp.tipo_masa = ctm.tipo_masa
      WHERE mp.id = $1
    `;

    const masaResult = await db.query(masaQuery, [masaId]);

    if (masaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Masa no encontrada'
      });
    }

    const masa = masaResult.rows[0];

    // Verificar que la masa requiere formado
    if (!masa.requiere_formado) {
      return res.status(400).json({
        success: false,
        message: 'Esta masa no requiere proceso de formado'
      });
    }

    // Obtener productos a formar con sus cantidades
    const productosQuery = `
      SELECT
        ppm.id,
        ppm.uuid,
        ppm.producto_codigo,
        ppm.producto_nombre,
        ppm.presentacion,
        ppm.gramaje_unitario,
        ppm.unidades_pedidas,
        ppm.unidades_programadas,
        ppm.unidades_producidas,
        ppm.cantidad_divisiones AS unidades_a_formar,
        ef.largo_cm,
        ef.ancho_cm,
        ef.alto_cm,
        ef.diametro_cm,
        ef.tolerancia_cm
      FROM productos_por_masa ppm
      LEFT JOIN especificaciones_formado ef
        ON ppm.producto_codigo = ef.producto_codigo
        OR ef.tipo_masa = $2
      WHERE ppm.masa_id = $1
      ORDER BY ppm.producto_nombre
    `;

    const productosResult = await db.query(productosQuery, [masaId, masa.tipo_masa]);

    // Obtener máquinas de formado disponibles
    const maquinasQuery = `
      SELECT id, uuid, nombre, codigo, tipo, capacidad_kg, activa
      FROM maquinas_formado
      WHERE activa = TRUE
      ORDER BY nombre
    `;

    const maquinasResult = await db.query(maquinasQuery);

    // Obtener registro existente de formado (si existe)
    const registroQuery = `
      SELECT
        rf.id,
        rf.uuid,
        rf.maquina_formado_id,
        rf.maquina_nombre,
        rf.fecha_inicio,
        rf.fecha_fin,
        rf.duracion_minutos,
        rf.usuario_id,
        rf.usuario_nombre,
        rf.observaciones,
        rf.fecha_registro
      FROM registros_formado rf
      WHERE rf.masa_id = $1
      ORDER BY rf.fecha_registro DESC
      LIMIT 1
    `;

    const registroResult = await db.query(registroQuery, [masaId]);

    res.json({
      success: true,
      data: {
        masa: {
          id: masa.id,
          uuid: masa.uuid,
          codigo: masa.codigo_masa,
          tipo: masa.tipo_masa,
          nombre: masa.nombre_masa,
          estado: masa.estado,
          fase_actual: masa.fase_actual,
          requiere_reposo: masa.requiere_reposo_pre_division,
          tiempo_reposo_minutos: masa.tiempo_reposo_division_minutos
        },
        productos: productosResult.rows,
        maquinas_disponibles: maquinasResult.rows,
        registro_actual: registroResult.rows[0] || null
      }
    });
  } catch (error) {
    logger.error('Error al obtener info de formado:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de formado',
      error: error.message
    });
  }
};

/**
 * Iniciar proceso de formado
 * POST /api/formado/:masaId/iniciar
 */
exports.iniciarFormado = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { masaId } = req.params;
    const {
      maquina_formado_id,
      observaciones
    } = req.body;

    const usuario = req.user; // Del middleware auth

    await client.query('BEGIN');

    // Verificar que la fase anterior (DIVISION) está completada
    const faseQuery = `
      SELECT estado
      FROM progreso_fases
      WHERE masa_id = $1 AND fase = 'DIVISION'
    `;
    const faseResult = await client.query(faseQuery, [masaId]);

    if (faseResult.rows.length === 0 || faseResult.rows[0].estado !== 'COMPLETADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Debe completar la fase de DIVISION antes de iniciar FORMADO'
      });
    }

    // Obtener info de la máquina
    const maquinaQuery = `
      SELECT nombre FROM maquinas_formado WHERE id = $1
    `;
    const maquinaResult = await client.query(maquinaQuery, [maquina_formado_id]);

    if (maquinaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Máquina de formado no encontrada'
      });
    }

    const maquinaNombre = maquinaResult.rows[0].nombre;

    // Crear registro de formado
    const insertQuery = `
      INSERT INTO registros_formado (
        masa_id,
        maquina_formado_id,
        maquina_nombre,
        fecha_inicio,
        usuario_id,
        usuario_nombre,
        observaciones
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      masaId,
      maquina_formado_id,
      maquinaNombre,
      usuario.id,
      usuario.nombre_completo,
      observaciones || null
    ]);

    // Actualizar progreso de fase FORMADO a EN_PROGRESO
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'EN_PROGRESO',
        fecha_inicio = NOW(),
        usuario_responsable = $2,
        fecha_actualizacion = NOW()
      WHERE masa_id = $1 AND fase = 'FORMADO'
    `;
    await client.query(updateFaseQuery, [masaId, usuario.nombre_completo]);

    // Actualizar fase_actual de la masa
    const updateMasaQuery = `
      UPDATE masas_produccion
      SET fase_actual = 'FORMADO'
      WHERE id = $1
    `;
    await client.query(updateMasaQuery, [masaId]);

    await client.query('COMMIT');

    logger.info(`Formado iniciado para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Proceso de formado iniciado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al iniciar formado:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar formado',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Completar proceso de formado
 * POST /api/formado/:masaId/completar
 */
exports.completarFormado = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // Obtener registro de formado actual
    const registroQuery = `
      SELECT id, fecha_inicio
      FROM registros_formado
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await client.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No se encontró un registro de formado iniciado'
      });
    }

    const registro = registroResult.rows[0];

    // Calcular duración en minutos
    const updateQuery = `
      UPDATE registros_formado
      SET
        fecha_fin = NOW(),
        duracion_minutos = EXTRACT(EPOCH FROM (NOW() - $2)) / 60,
        observaciones = COALESCE($3, observaciones)
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      registro.id,
      registro.fecha_inicio,
      observaciones || null
    ]);

    // Marcar fase FORMADO como COMPLETADA
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'COMPLETADA',
        porcentaje_completado = 100,
        fecha_completado = NOW(),
        observaciones = $2,
        fecha_actualizacion = NOW()
      WHERE masa_id = $1 AND fase = 'FORMADO'
    `;
    await client.query(updateFaseQuery, [masaId, observaciones || null]);

    // Desbloquear fase FERMENTACION
    const desbloquearQuery = `
      UPDATE progreso_fases
      SET estado = 'BLOQUEADA'
      WHERE masa_id = $1 AND fase = 'FERMENTACION' AND estado = 'BLOQUEADA'
    `;
    await client.query(desbloquearQuery, [masaId]);

    await client.query('COMMIT');

    logger.info(`Formado completado para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Proceso de formado completado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al completar formado:', error);
    res.status(500).json({
      success: false,
      message: 'Error al completar formado',
      error: error.message
    });
  } finally {
    client.release();
  }
};
