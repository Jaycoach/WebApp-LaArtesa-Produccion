/**
 * Controlador para el proceso de HORNEADO
 * Basado en reunión 23/01/2026
 */

const db = require('../database/connection');
const logger = require('../utils/logger');
const { calcularAjustesPendientes } = require('./pesaje.controller');

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
        rh.unidades_terminadas,
        rh.unidades_terminadas_por_producto,
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

    // Productos con cantidad_divisiones reales para formulario por producto
    const productosHorneadoResult = await db.query(`
      SELECT id, producto_nombre, sap_item_code,
             COALESCE(cantidad_divisiones, 0) AS cantidad_divisiones,
             COALESCE(unidades_producidas, 0) AS unidades_producidas,
             division_completada
      FROM productos_por_masa
      WHERE masa_id = $1
      ORDER BY producto_nombre
    `, [masaId]);

    // Total divididas = suma real de cantidad_divisiones (no unidades_producidas que ya fue sobreescrita por horneado)
    const unidadesDivididas = productosHorneadoResult.rows.reduce(
      (s, p) => s + parseInt(p.cantidad_divisiones || 0), 0
    );

    res.json({
      success: true,
      data: {
        unidades_divididas: unidadesDivididas,
        productos_horneado: productosHorneadoResult.rows,
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
  const client = await db.getClient();

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

    // Horno tipo PISO solo admite Programa 1 — Fase 2, 12-ago-2026
    if (horno.tipo === 'PISO' && numeroPrograma !== 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `El horno ${horno.nombre} es de tipo PISO y solo admite el Programa 1`
      });
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
      ) VALUES ($1::integer, $2::integer, $3::text, $4::integer, $5::integer, NOW(), $6::numeric, $7::boolean, $8::integer, $9::text, $10::text)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      Number(masaId),
      Number(tipo_horno_id),
      horno.nombre,
      programa_horneo_id ? Number(programa_horneo_id) : null,
      numeroPrograma ? Number(numeroPrograma) : null,
      temperatura_inicial_real ? parseFloat(temperatura_inicial_real) : null,
      uso_damper_real === true || uso_damper_real === 'true',
      Number(usuario.id),
      usuario.nombre_completo,
      observaciones || null
    ]);

    // Actualizar progreso de fase HORNEADO a EN_PROGRESO
    await client.query(
      `UPDATE progreso_fases
       SET estado = 'EN_PROGRESO', fecha_inicio = NOW(), usuario_responsable = $2
       WHERE masa_id = $1 AND fase = 'HORNEADO'`,
      [Number(masaId), Number(usuario.id)]
    );
    await client.query(
      `UPDATE progreso_fases
       SET datos_fase = $2
       WHERE masa_id = $1 AND fase = 'HORNEADO'`,
      [Number(masaId), JSON.stringify({
        horno: horno.nombre,
        programa: numeroPrograma,
        hora_entrada: new Date().toISOString()
      })]
    );

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
/**
 * PATCH /api/horneado/:masaId/unidades-por-producto
 * Edición retroactiva de unidades terminadas por producto — solo admin/supervisor
 */
exports.editarUnidadesPorProducto = async (req, res) => {
  const client = await db.getClient();
  try {
    const { masaId } = req.params;
    const { unidades_por_producto, motivo } = req.body;
    const usuario = req.user;

    // Verificar rol
    if (!['admin', 'supervisor'].includes(usuario.rol)) {
      return res.status(403).json({ success: false, message: 'Solo admin o supervisor pueden editar valores históricos' });
    }
    if (!unidades_por_producto || typeof unidades_por_producto !== 'object') {
      return res.status(400).json({ success: false, message: 'unidades_por_producto requerido' });
    }
    if (!motivo || motivo.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Debe ingresar un motivo de modificación (mínimo 5 caracteres)' });
    }

    await client.query('BEGIN');

    // Obtener registro actual para auditoría
    const regR = await client.query(
      `SELECT id, unidades_terminadas, unidades_terminadas_por_producto
       FROM registros_horneado WHERE masa_id = $1 ORDER BY fecha_registro DESC LIMIT 1`,
      [masaId]
    );
    if (!regR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Registro de horneado no encontrado' });
    }
    const reg = regR.rows[0];

    // Calcular nuevo total
    const nuevoTotal = Object.values(unidades_por_producto).reduce((s, v) => s + parseInt(String(v)), 0);

    // Helper auditoría
    const insertAudit = async (campo, anterior, nuevo) => {
      await client.query(
        `INSERT INTO auditoria_modificaciones
           (tabla, registro_id, campo, valor_anterior, valor_nuevo, motivo,
            usuario_id, usuario_nombre, usuario_rol, masa_id)
         VALUES ('registros_horneado', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [reg.id, campo, String(anterior ?? ''), String(nuevo ?? ''), motivo,
         Number(usuario.id), usuario.nombre_completo || usuario.username, usuario.rol, Number(masaId)]
      );
    };

    await insertAudit('unidades_terminadas', reg.unidades_terminadas, nuevoTotal);
    await insertAudit('unidades_terminadas_por_producto',
      JSON.stringify(reg.unidades_terminadas_por_producto),
      JSON.stringify(unidades_por_producto));

    // Actualizar registros_horneado
    await client.query(
      `UPDATE registros_horneado
       SET unidades_terminadas = $2,
           unidades_terminadas_por_producto = $3,
           fecha_actualizacion = NOW()
       WHERE id = $1`,
      [reg.id, nuevoTotal, JSON.stringify(unidades_por_producto)]
    );

    // Actualizar productos_por_masa por producto
    for (const [prodId, cantidad] of Object.entries(unidades_por_producto)) {
      const cant = parseInt(String(cantidad));
      const prevR = await client.query(
        `SELECT unidades_producidas FROM productos_por_masa WHERE id = $1`, [parseInt(prodId)]
      );
      await insertAudit(`unidades_producidas_prod_${prodId}`,
        prevR.rows[0]?.unidades_producidas, cant);

      await client.query(
        `UPDATE productos_por_masa SET unidades_producidas = $2, usuario_id = $4, updated_at = NOW()
         WHERE id = $1 AND masa_id = $3`,
        [parseInt(prodId), cant, Number(masaId), req.user.id]
      );
    }

    // Actualizar datos_fase HORNEADO
    await client.query(
      `UPDATE progreso_fases
       SET datos_fase = datos_fase || $2::jsonb
       WHERE masa_id = $1 AND fase = 'HORNEADO'`,
      [masaId, JSON.stringify({ unidades_terminadas: nuevoTotal, unidades_por_producto })]
    );

    await client.query('COMMIT');
    logger.info(`Edición retroactiva horneado masa ${masaId} por ${usuario.username}: ${JSON.stringify(unidades_por_producto)}`);
    res.json({ success: true, message: 'Unidades actualizadas y auditadas correctamente', data: { nuevoTotal, unidades_por_producto } });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error editarUnidadesPorProducto:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
};

exports.completarHorneado = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const {
      calidad_color,
      calidad_coccion,
      observaciones,
      unidades_terminadas,
      unidades_por_producto   // objeto { "prod_id": cantidad, ... }
    } = req.body;

    const usuario = req.user;

    // Bloqueo: no se puede completar si hay ajustes de pesaje pendientes de SAP
    const ajustesPendientes = await calcularAjustesPendientes(masaId);
    if (ajustesPendientes.length > 0) {
      return res.status(409).json({
        success: false,
        message: `No se puede completar HORNEADO: hay ${ajustesPendientes.length} ajuste(s) de pesaje pendientes de transmitir a SAP. Ve a Pesaje y confirma los ajustes antes de continuar.`,
        data: { ajustes_pendientes: ajustesPendientes },
      });
    }

    // ── Validar que ningún producto activo quede con 0 unidades terminadas ──
    // SAP no permite crear una OV sin cantidad, así que un producto en 0/nulo
    // en HORNEADO es siempre un error de captura, nunca un estado de negocio
    // válido (mismo criterio que DIVISION en fases.controller.js). Se calcula
    // acá la distribución final (por producto o por fallback proporcional)
    // para validarla ANTES de escribir nada, y se reutiliza más abajo.
    const productosResult = await db.query(
      `SELECT id, producto_nombre, presentacion, COALESCE(cantidad_divisiones, 0) AS cantidad_divisiones
       FROM productos_por_masa WHERE masa_id = $1 ORDER BY producto_nombre`,
      [masaId]
    );

    if (productosResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'La masa no tiene productos para hornear.',
      });
    }

    const distribucionFinal = {};
    if (unidades_por_producto && typeof unidades_por_producto === 'object') {
      for (const prod of productosResult.rows) {
        distribucionFinal[prod.id] = parseInt(String(unidades_por_producto[prod.id] ?? 0)) || 0;
      }
    } else if (unidades_terminadas && parseInt(unidades_terminadas) > 0) {
      const totalDiv = productosResult.rows.reduce((s, p) => s + parseInt(p.cantidad_divisiones), 0);
      const totalTerm = parseInt(unidades_terminadas);
      if (totalDiv > 0) {
        let asignado = 0;
        productosResult.rows.forEach((p, i) => {
          const cant = i === productosResult.rows.length - 1
            ? totalTerm - asignado
            : Math.round((parseInt(p.cantidad_divisiones) / totalDiv) * totalTerm);
          asignado += cant;
          distribucionFinal[p.id] = cant;
        });
      } else {
        productosResult.rows.forEach((p) => { distribucionFinal[p.id] = totalTerm; });
      }
    } else {
      productosResult.rows.forEach((p) => { distribucionFinal[p.id] = 0; });
    }

    const faltantes = productosResult.rows
      .filter((p) => (distribucionFinal[p.id] || 0) <= 0)
      .map((p) => `${p.producto_nombre}${p.presentacion ? ' ' + p.presentacion : ''}`);

    if (faltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'No se puede completar el horneado: hay productos sin unidades terminadas registradas.',
        data: {
          total: productosResult.rows.length,
          completados: productosResult.rows.length - faltantes.length,
          faltantes,
        },
      });
    }

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
        unidades_terminadas = $6,
        fecha_actualizacion = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      registro.id,
      registro.hora_entrada,
      calidad_color || null,
      calidad_coccion || null,
      observaciones || null,
      unidades_terminadas ? parseInt(unidades_terminadas) : null
    ]);

    // Actualizar unidades_producidas en productos_por_masa — distribución ya
    // calculada y validada (>0 en todos los productos) antes del BEGIN.
    if (unidades_por_producto && typeof unidades_por_producto === 'object') {
      // Guardar desglose por producto tal como lo envió el usuario
      await client.query(`
        UPDATE registros_horneado
        SET unidades_terminadas_por_producto = $2
        WHERE id = $1
      `, [registro.id, JSON.stringify(unidades_por_producto)]);
    }

    for (const [prodId, cantidad] of Object.entries(distribucionFinal)) {
      await client.query(`
        UPDATE productos_por_masa
        SET unidades_producidas = $2, usuario_id = $4, updated_at = NOW()
        WHERE id = $1 AND masa_id = $3
      `, [parseInt(prodId), cantidad, Number(masaId), req.user.id]);
    }

    // Marcar fase HORNEADO como COMPLETADA
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'COMPLETADA',
        porcentaje_completado = 100,
        fecha_completado = NOW(),
        usuario_responsable = $4,
        observaciones = $2,
        datos_fase = datos_fase || $3::jsonb
      WHERE masa_id = $1 AND fase = 'HORNEADO'
    `;
    await client.query(updateFaseQuery, [
      masaId,
      observaciones || null,
      JSON.stringify({ unidades_terminadas: unidades_terminadas ? parseInt(unidades_terminadas) : null }),
      usuario.id,
    ]);

    // Avanzar masa a fase EMPAQUE
    const updateMasaQuery = `
      UPDATE masas_produccion
      SET
        estado = 'EN_PROCESO',
        fase_actual = 'EMPAQUE'
      WHERE id = $1
    `;
    await client.query(updateMasaQuery, [masaId]);

    // Desbloquear fase EMPAQUE
    await client.query(`
      UPDATE progreso_fases
      SET estado = 'EN_PROGRESO', updated_at = NOW()
      WHERE masa_id = $1 AND fase = 'EMPAQUE'
    `, [masaId]);

    await client.query('COMMIT');

    logger.info(`Horneado completado para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Horneado completado correctamente. Masa lista para empaque.',
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
