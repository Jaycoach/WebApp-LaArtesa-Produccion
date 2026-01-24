/**
 * Controlador para el proceso de HORNEADO
 * Basado en reunión 23/01/2026
 */

const db = require('../database/connection');
const logger = require('../utils/logger');

/**
 * Obtener información de horneado para una masa
 * GET /api/horneado/:masaId
 */
exports.getHorneadoInfo = async (req, res) => {
  try {
    const { masaId } = req.params;

    // Obtener info de la masa
    const masaQuery = `
      SELECT
        mp.id,
        mp.uuid,
        mp.codigo_masa,
        mp.tipo_masa,
        mp.nombre_masa,
        mp.estado,
        mp.fase_actual
      FROM masas_produccion mp
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

    // Obtener hornos disponibles
    const hornosQuery = `
      SELECT
        id,
        uuid,
        nombre,
        codigo,
        tipo,
        capacidad_bandejas,
        tiene_damper,
        tiene_control_automatico,
        activo
      FROM tipos_horno
      WHERE activo = TRUE
      ORDER BY
        CASE tipo
          WHEN 'ROTATIVO' THEN 1
          WHEN 'PISO' THEN 2
        END,
        nombre
    `;

    const hornosResult = await db.query(hornosQuery);

    // Obtener programas de horneado activos
    const programasQuery = `
      SELECT
        id,
        uuid,
        numero_programa,
        nombre,
        descripcion,
        temperatura_inicial,
        temperatura_media,
        temperatura_final,
        tiempo_temperatura_media,
        tiempo_total_minutos,
        usa_damper,
        tiempo_inicio_damper,
        tiempo_fin_damper,
        tipo_masa_sugerido,
        activo
      FROM programas_horneo
      WHERE activo = TRUE
      ORDER BY numero_programa
    `;

    const programasResult = await db.query(programasQuery);

    // Filtrar programas sugeridos para el tipo de masa
    const programasSugeridos = programasResult.rows.filter(
      p => p.tipo_masa_sugerido === masa.tipo_masa
    );

    // Obtener registro de horneado existente
    const registroQuery = `
      SELECT
        rh.id,
        rh.uuid,
        rh.tipo_horno_id,
        rh.horno_nombre,
        rh.programa_horneo_id,
        rh.numero_programa,
        rh.hora_entrada,
        rh.hora_cambio_temperatura,
        rh.hora_salida,
        rh.tiempo_total_minutos,
        rh.temperatura_inicial_real,
        rh.temperatura_media_real,
        rh.temperatura_final_real,
        rh.uso_damper_real,
        rh.tiempo_inicio_damper_real,
        rh.tiempo_fin_damper_real,
        rh.calidad_color,
        rh.calidad_coccion,
        rh.usuario_id,
        rh.usuario_nombre,
        rh.observaciones,
        rh.fecha_registro,
        th.nombre AS horno_nombre_completo,
        th.tipo AS horno_tipo,
        ph.nombre AS programa_nombre
      FROM registros_horneado rh
      LEFT JOIN tipos_horno th ON rh.tipo_horno_id = th.id
      LEFT JOIN programas_horneo ph ON rh.programa_horneo_id = ph.id
      WHERE rh.masa_id = $1
      ORDER BY rh.fecha_registro DESC
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
          fase_actual: masa.fase_actual
        },
        hornos_disponibles: hornosResult.rows,
        programas_todos: programasResult.rows,
        programas_sugeridos: programasSugeridos,
        registro_actual: registroResult.rows[0] || null
      }
    });
  } catch (error) {
    logger.error('Error al obtener info de horneado:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de horneado',
      error: error.message
    });
  }
};

/**
 * Obtener catálogo de hornos
 * GET /api/horneado/hornos
 */
exports.getHornos = async (req, res) => {
  try {
    const query = `
      SELECT
        id,
        uuid,
        nombre,
        codigo,
        tipo,
        capacidad_bandejas,
        tiene_damper,
        tiene_control_automatico,
        activo,
        observaciones
      FROM tipos_horno
      WHERE activo = TRUE
      ORDER BY nombre
    `;

    const result = await db.query(query);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error al obtener hornos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener catálogo de hornos',
      error: error.message
    });
  }
};

/**
 * Obtener programas de horneado
 * GET /api/horneado/programas
 */
exports.getProgramas = async (req, res) => {
  try {
    const { tipo_masa } = req.query;

    let query = `
      SELECT
        id,
        uuid,
        numero_programa,
        nombre,
        descripcion,
        temperatura_inicial,
        temperatura_media,
        temperatura_final,
        tiempo_temperatura_media,
        tiempo_total_minutos,
        usa_damper,
        tiempo_inicio_damper,
        tiempo_fin_damper,
        tipo_masa_sugerido,
        activo
      FROM programas_horneo
      WHERE activo = TRUE
    `;

    const params = [];

    if (tipo_masa) {
      query += ` AND (tipo_masa_sugerido = $1 OR tipo_masa_sugerido IS NULL)`;
      params.push(tipo_masa);
    }

    query += ` ORDER BY numero_programa`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error al obtener programas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener programas de horneado',
      error: error.message
    });
  }
};

/**
 * Iniciar horneado
 * POST /api/horneado/:masaId/iniciar
 */
exports.iniciarHorneado = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { masaId } = req.params;
    const {
      tipo_horno_id,
      programa_horneo_id,
      temperatura_inicial_real,
      uso_damper_real,
      observaciones
    } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // Verificar que la fase FERMENTACION está completada
    const faseQuery = `
      SELECT estado
      FROM progreso_fases
      WHERE masa_id = $1 AND fase = 'FERMENTACION'
    `;
    const faseResult = await client.query(faseQuery, [masaId]);

    if (faseResult.rows.length === 0 || faseResult.rows[0].estado !== 'COMPLETADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Debe completar la fase de FERMENTACION antes de iniciar HORNEADO'
      });
    }

    // Obtener info del horno
    const hornoQuery = `
      SELECT nombre, tipo, tiene_damper
      FROM tipos_horno
      WHERE id = $1
    `;
    const hornoResult = await client.query(hornoQuery, [tipo_horno_id]);

    if (hornoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Horno no encontrado'
      });
    }

    const horno = hornoResult.rows[0];

    // Obtener info del programa (si se especificó)
    let numeroPrograma = null;
    if (programa_horneo_id) {
      const programaQuery = `
        SELECT numero_programa
        FROM programas_horneo
        WHERE id = $1
      `;
      const programaResult = await client.query(programaQuery, [programa_horneo_id]);

      if (programaResult.rows.length > 0) {
        numeroPrograma = programaResult.rows[0].numero_programa;
      }
    }

    // Validar uso de damper si el horno no lo tiene
    if (!horno.tiene_damper && uso_damper_real) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `El horno ${horno.nombre} no tiene damper`
      });
    }

    // Crear registro de horneado
    const insertQuery = `
      INSERT INTO registros_horneado (
        masa_id,
        tipo_horno_id,
        horno_nombre,
        programa_horneo_id,
        numero_programa,
        hora_entrada,
        temperatura_inicial_real,
        uso_damper_real,
        usuario_id,
        usuario_nombre,
        observaciones
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      masaId,
      tipo_horno_id,
      horno.nombre,
      programa_horneo_id || null,
      numeroPrograma,
      temperatura_inicial_real || null,
      uso_damper_real || false,
      usuario.id,
      usuario.nombre_completo,
      observaciones || null
    ]);

    // Actualizar progreso de fase HORNEADO a EN_PROGRESO
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'EN_PROGRESO',
        fecha_inicio = NOW(),
        usuario_responsable = $2,
        datos_fase = jsonb_build_object(
          'horno', $3,
          'programa', $4,
          'hora_entrada', NOW()
        ),
        fecha_actualizacion = NOW()
      WHERE masa_id = $1 AND fase = 'HORNEADO'
    `;
    await client.query(updateFaseQuery, [
      masaId,
      usuario.nombre_completo,
      horno.nombre,
      numeroPrograma
    ]);

    // Actualizar fase_actual y estado de la masa
    const updateMasaQuery = `
      UPDATE masas_produccion
      SET
        fase_actual = 'HORNEADO',
        estado = 'EN_PROCESO'
      WHERE id = $1
    `;
    await client.query(updateMasaQuery, [masaId]);

    await client.query('COMMIT');

    logger.info(`Horneado iniciado para masa ${masaId} en horno ${horno.nombre} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Horneado iniciado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al iniciar horneado:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar horneado',
      error: error.message
    });
  } finally {
    client.release();
  }
};

/**
 * Actualizar temperaturas durante horneado
 * PATCH /api/horneado/:masaId/temperaturas
 */
exports.actualizarTemperaturas = async (req, res) => {
  try {
    const { masaId } = req.params;
    const {
      temperatura_media_real,
      temperatura_final_real,
      hora_cambio_temperatura
    } = req.body;

    // Obtener registro actual
    const registroQuery = `
      SELECT id
      FROM registros_horneado
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await db.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontró un registro de horneado activo'
      });
    }

    const registro = registroResult.rows[0];

    // Actualizar temperaturas
    const updateQuery = `
      UPDATE registros_horneado
      SET
        temperatura_media_real = COALESCE($2, temperatura_media_real),
        temperatura_final_real = COALESCE($3, temperatura_final_real),
        hora_cambio_temperatura = COALESCE($4, hora_cambio_temperatura),
        fecha_actualizacion = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await db.query(updateQuery, [
      registro.id,
      temperatura_media_real || null,
      temperatura_final_real || null,
      hora_cambio_temperatura || null
    ]);

    logger.info(`Temperaturas actualizadas para horneado de masa ${masaId}`);

    res.json({
      success: true,
      message: 'Temperaturas actualizadas correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error al actualizar temperaturas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar temperaturas',
      error: error.message
    });
  }
};

/**
 * Actualizar damper durante horneado
 * PATCH /api/horneado/:masaId/damper
 */
exports.actualizarDamper = async (req, res) => {
  try {
    const { masaId } = req.params;
    const {
      tiempo_inicio_damper_real,
      tiempo_fin_damper_real
    } = req.body;

    // Obtener registro actual
    const registroQuery = `
      SELECT id
      FROM registros_horneado
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await db.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontró un registro de horneado activo'
      });
    }

    const registro = registroResult.rows[0];

    // Actualizar tiempos de damper
    const updateQuery = `
      UPDATE registros_horneado
      SET
        tiempo_inicio_damper_real = COALESCE($2, tiempo_inicio_damper_real),
        tiempo_fin_damper_real = COALESCE($3, tiempo_fin_damper_real),
        fecha_actualizacion = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await db.query(updateQuery, [
      registro.id,
      tiempo_inicio_damper_real || null,
      tiempo_fin_damper_real || null
    ]);

    logger.info(`Damper actualizado para horneado de masa ${masaId}`);

    res.json({
      success: true,
      message: 'Damper actualizado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error al actualizar damper:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar damper',
      error: error.message
    });
  }
};

/**
 * Completar horneado
 * POST /api/horneado/:masaId/completar
 */
exports.completarHorneado = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const { masaId } = req.params;
    const {
      calidad_color,
      calidad_coccion,
      observaciones
    } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // Obtener registro de horneado actual
    const registroQuery = `
      SELECT id, hora_entrada
      FROM registros_horneado
      WHERE masa_id = $1
      ORDER BY fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await client.query(registroQuery, [masaId]);

    if (registroResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No se encontró un registro de horneado activo'
      });
    }

    const registro = registroResult.rows[0];

    // Actualizar con hora de salida y calidad
    const updateQuery = `
      UPDATE registros_horneado
      SET
        hora_salida = NOW(),
        tiempo_total_minutos = EXTRACT(EPOCH FROM (NOW() - $2)) / 60,
        calidad_color = $3,
        calidad_coccion = $4,
        observaciones = COALESCE($5, observaciones),
        fecha_actualizacion = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      registro.id,
      registro.hora_entrada,
      calidad_color || null,
      calidad_coccion || null,
      observaciones || null
    ]);

    // Marcar fase HORNEADO como COMPLETADA
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'COMPLETADA',
        porcentaje_completado = 100,
        fecha_completado = NOW(),
        observaciones = $2,
        fecha_actualizacion = NOW()
      WHERE masa_id = $1 AND fase = 'HORNEADO'
    `;
    await client.query(updateFaseQuery, [masaId, observaciones || null]);

    // Actualizar estado de la masa a COMPLETADA
    const updateMasaQuery = `
      UPDATE masas_produccion
      SET
        estado = 'COMPLETADA',
        fase_actual = 'HORNEADO'
      WHERE id = $1
    `;
    await client.query(updateMasaQuery, [masaId]);

    await client.query('COMMIT');

    logger.info(`Horneado completado para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Horneado completado correctamente. Producción finalizada.',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al completar horneado:', error);
    res.status(500).json({
      success: false,
      message: 'Error al completar horneado',
      error: error.message
    });
  } finally {
    client.release();
  }
};
