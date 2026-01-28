/**
 * Controlador para el proceso de FERMENTACIÓN
 * Basado en reunión 23/01/2026
 */

const db = require('../database/connection');
const logger = require('../utils/logger');

/**
 * Obtener información de fermentación para una masa
 * GET /api/fermentacion/:masaId
 */
exports.getFermentacionInfo = async (req, res) => {
  try {
    const { masaId } = req.params;

    // Obtener info de la masa y su configuración
    const masaQuery = `
      SELECT
        mp.id,
        mp.uuid,
        mp.codigo_masa,
        mp.tipo_masa,
        mp.nombre_masa,
        mp.estado,
        mp.fase_actual,
        ctm.requiere_camara_frio,
        ctm.tiempo_fermentacion_estandar_minutos
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

    // Obtener registro de fermentación existente
    const registroQuery = `
      SELECT
        rf.id,
        rf.uuid,
        rf.hora_entrada_camara,
        rf.hora_salida_camara_sugerida,
        rf.hora_salida_camara_real,
        rf.tiempo_fermentacion_minutos,
        rf.temperatura_camara,
        rf.humedad_camara,
        rf.requiere_camara_frio,
        rf.hora_entrada_frio,
        rf.hora_salida_frio,
        rf.tiempo_frio_minutos,
        rf.temperatura_frio,
        rf.usuario_id,
        rf.usuario_nombre,
        rf.observaciones,
        rf.fecha_registro
      FROM registros_fermentacion rf
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
          requiere_camara_frio: masa.requiere_camara_frio,
          tiempo_fermentacion_estandar_minutos: masa.tiempo_fermentacion_estandar_minutos
        },
        registro_actual: registroResult.rows[0] || null
      }
    });
  } catch (error) {
    logger.error('Error al obtener info de fermentación:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de fermentación',
      error: error.message
    });
  }
};

/**
 * Registrar entrada a cámara de fermentación
 * POST /api/fermentacion/:masaId/camara/entrada
 */
exports.registrarEntradaCamara = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const {
      temperatura_camara,
      humedad_camara,
      observaciones
    } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // Verificar que la fase anterior (FORMADO o DIVISION) está completada
    const faseQuery = `
      SELECT estado, fase
      FROM progreso_fases
      WHERE masa_id = $1
        AND fase IN ('FORMADO', 'DIVISION')
        AND estado = 'COMPLETADA'
      ORDER BY
        CASE fase
          WHEN 'FORMADO' THEN 1
          WHEN 'DIVISION' THEN 2
        END
      LIMIT 1
    `;
    const faseResult = await client.query(faseQuery, [masaId]);

    if (faseResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Debe completar FORMADO o DIVISION antes de iniciar FERMENTACION'
      });
    }

    // Obtener tiempo estándar de fermentación
    const tiempoQuery = `
      SELECT ctm.tiempo_fermentacion_estandar_minutos, ctm.requiere_camara_frio
      FROM masas_produccion mp
      JOIN catalogo_tipos_masa ctm ON mp.tipo_masa = ctm.tipo_masa
      WHERE mp.id = $1
    `;
    const tiempoResult = await client.query(tiempoQuery, [masaId]);
    const tiempoEstandar = tiempoResult.rows[0]?.tiempo_fermentacion_estandar_minutos || 40;
    const requiereFrio = tiempoResult.rows[0]?.requiere_camara_frio || false;

    // Calcular hora de salida sugerida
    const insertQuery = `
      INSERT INTO registros_fermentacion (
        masa_id,
        hora_entrada_camara,
        hora_salida_camara_sugerida,
        tiempo_fermentacion_minutos,
        temperatura_camara,
        humedad_camara,
        requiere_camara_frio,
        usuario_id,
        usuario_nombre,
        observaciones
      ) VALUES (
        $1,
        NOW(),
        NOW() + INTERVAL '${tiempoEstandar} minutes',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      masaId,
      tiempoEstandar,
      temperatura_camara || null,
      humedad_camara || null,
      requiereFrio,
      usuario.id,
      usuario.nombre_completo,
      observaciones || null
    ]);

    // Actualizar progreso de fase FERMENTACION a EN_PROGRESO
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'EN_PROGRESO',
        fecha_inicio = NOW(),
        usuario_responsable = $2,
        datos_fase = jsonb_build_object(
          'entrada_camara', NOW(),
          'salida_sugerida', NOW() + INTERVAL '${tiempoEstandar} minutes'
        ),
        fecha_actualizacion = NOW()
      WHERE masa_id = $1 AND fase = 'FERMENTACION'
    `;
    await client.query(updateFaseQuery, [masaId, usuario.nombre_completo]);

    // Actualizar fase_actual de la masa
    const updateMasaQuery = `
      UPDATE masas_produccion
      SET fase_actual = 'FERMENTACION'
      WHERE id = $1
    `;
    await client.query(updateMasaQuery, [masaId]);

    await client.query('COMMIT');

    logger.info(`Fermentación iniciada (entrada a cámara) para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Entrada a cámara de fermentación registrada correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al registrar entrada a cámara:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar entrada a cámara',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Registrar salida de cámara de fermentación
 * POST /api/fermentacion/:masaId/camara/salida
 */
exports.registrarSalidaCamara = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // Obtener registro de fermentación actual
    const registroQuery = `
      SELECT id, hora_entrada_camara, requiere_camara_frio
      FROM registros_fermentacion
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await client.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No se encontró un registro de entrada a cámara'
      });
    }

    const registro = registroResult.rows[0];

    // Actualizar con hora de salida real
    const updateQuery = `
      UPDATE registros_fermentacion
      SET
        hora_salida_camara_real = NOW(),
        observaciones = COALESCE($2, observaciones)
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      registro.id,
      observaciones || null
    ]);

    // Si no requiere cámara de frío, completar la fase
    if (!registro.requiere_camara_frio) {
      const updateFaseQuery = `
        UPDATE progreso_fases
        SET
          estado = 'COMPLETADA',
          porcentaje_completado = 100,
          fecha_completado = NOW(),
          observaciones = $2,
          fecha_actualizacion = NOW()
        WHERE masa_id = $1 AND fase = 'FERMENTACION'
      `;
      await client.query(updateFaseQuery, [masaId, observaciones || null]);

      // Desbloquear fase HORNEADO
      const desbloquearQuery = `
        UPDATE progreso_fases
        SET estado = 'BLOQUEADA'
        WHERE masa_id = $1 AND fase = 'HORNEADO' AND estado = 'BLOQUEADA'
      `;
      await client.query(desbloquearQuery, [masaId]);
    }

    await client.query('COMMIT');

    logger.info(`Salida de cámara registrada para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: registro.requiere_camara_frio
        ? 'Salida de cámara registrada. Debe ingresar a cámara de frío'
        : 'Fermentación completada. Puede proceder a HORNEADO',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al registrar salida de cámara:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar salida de cámara',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Registrar entrada a cámara de frío
 * POST /api/fermentacion/:masaId/frio/entrada
 */
exports.registrarEntradaFrio = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { temperatura_frio, observaciones } = req.body;

    await client.query('BEGIN');

    // Obtener registro actual
    const registroQuery = `
      SELECT id, requiere_camara_frio, hora_salida_camara_real
      FROM registros_fermentacion
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await client.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0 || !registroResult.rows[0].requiere_camara_frio) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Esta masa no requiere cámara de frío'
      });
    }

    if (!registroResult.rows[0].hora_salida_camara_real) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Debe registrar la salida de cámara de fermentación primero'
      });
    }

    const registro = registroResult.rows[0];

    // Actualizar con entrada a frío
    const updateQuery = `
      UPDATE registros_fermentacion
      SET
        hora_entrada_frio = NOW(),
        temperatura_frio = $2,
        observaciones = COALESCE($3, observaciones)
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      registro.id,
      temperatura_frio || null,
      observaciones || null
    ]);

    await client.query('COMMIT');

    logger.info(`Entrada a cámara de frío registrada para masa ${masaId}`);

    res.json({
      success: true,
      message: 'Entrada a cámara de frío registrada correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al registrar entrada a frío:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar entrada a frío',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Registrar salida de cámara de frío
 * POST /api/fermentacion/:masaId/frio/salida
 */
exports.registrarSalidaFrio = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // Obtener registro actual
    const registroQuery = `
      SELECT id, hora_entrada_frio
      FROM registros_fermentacion
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await client.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0 || !registroResult.rows[0].hora_entrada_frio) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No se encontró registro de entrada a cámara de frío'
      });
    }

    const registro = registroResult.rows[0];

    // Calcular tiempo en frío
    const updateQuery = `
      UPDATE registros_fermentacion
      SET
        hora_salida_frio = NOW(),
        tiempo_frio_minutos = EXTRACT(EPOCH FROM (NOW() - $2)) / 60,
        observaciones = COALESCE($3, observaciones)
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      registro.id,
      registro.hora_entrada_frio,
      observaciones || null
    ]);

    // Completar fase FERMENTACION
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'COMPLETADA',
        porcentaje_completado = 100,
        fecha_completado = NOW(),
        observaciones = $2,
        fecha_actualizacion = NOW()
      WHERE masa_id = $1 AND fase = 'FERMENTACION'
    `;
    await client.query(updateFaseQuery, [masaId, observaciones || null]);

    // Desbloquear fase HORNEADO
    const desbloquearQuery = `
      UPDATE progreso_fases
      SET estado = 'BLOQUEADA'
      WHERE masa_id = $1 AND fase = 'HORNEADO' AND estado = 'BLOQUEADA'
    `;
    await client.query(desbloquearQuery, [masaId]);

    await client.query('COMMIT');

    logger.info(`Salida de cámara de frío y fermentación completada para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Fermentación completada. Puede proceder a HORNEADO',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al registrar salida de frío:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar salida de frío',
      error: error.message
    });
  } finally {
    client.release();
  }
};
