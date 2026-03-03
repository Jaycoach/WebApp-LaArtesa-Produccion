/**
 * Controlador para el proceso de EMPAQUE
 * Última fase de producción — ARTESA
 * 2026-03-02
 */

const db = require('../database/connection');
const logger = require('../utils/logger');

/**
 * Obtener información de empaque para una masa
 * GET /api/empaque/:masaId
 */
exports.getEmpaqueInfo = async (req, res) => {
  try {
    const { masaId } = req.params;

    const masaQuery = `
      SELECT
        mp.id,
        mp.uuid,
        mp.codigo_masa,
        mp.tipo_masa,
        mp.nombre_masa,
        mp.estado,
        mp.fase_actual,
        mp.lote_produccion,
        mp.fecha_produccion
      FROM masas_produccion mp
      WHERE mp.id = $1
    `;
    const masaResult = await db.query(masaQuery, [masaId]);

    if (masaResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });
    }

    const masa = masaResult.rows[0];

    // Obtener productos
    const productosQuery = `
      SELECT
        id,
        sap_item_code,
        producto_codigo,
        producto_nombre,
        presentacion,
        gramaje_unitario,
        unidades_pedidas,
        COALESCE(unidades_ajustadas, unidades_programadas, unidades_pedidas) AS unidades_ajustadas,
        COALESCE(unidades_producidas, 0) AS unidades_producidas,
        COALESCE(unidades_excedente, 0) AS unidades_excedente,
        sap_doc_entry,
        sap_doc_num,
        COALESCE(unidades_por_paquete, 1) AS unidades_por_paquete,
        COALESCE(cantidad_paquetes, 0) AS cantidad_paquetes
      FROM productos_por_masa
      WHERE masa_id = $1
      ORDER BY producto_nombre
    `;
    const productosResult = await db.query(productosQuery, [masaId]);

    // Obtener registro de empaque si existe
    const registroQuery = `
      SELECT
        re.id,
        re.fecha_vencimiento,
        re.estado,
        re.observaciones,
        re.fecha_registro
      FROM registros_empaque re
      WHERE re.masa_id = $1
      ORDER BY re.fecha_registro DESC
      LIMIT 1
    `;
    const registroResult = await db.query(registroQuery, [masaId]);
    const registroEmpaque = registroResult.rows[0] || null;

    // Si hay registro, obtener detalles por producto
    const detallesMap = {};
    if (registroEmpaque) {
      const detallesQuery = `
        SELECT
          producto_masa_id,
          unidades_empacadas,
          unidades_merma
        FROM empaque_detalles
        WHERE empaque_id = $1
      `;
      const detallesResult = await db.query(detallesQuery, [registroEmpaque.id]);
      detallesResult.rows.forEach((d: any) => {
        detallesMap[d.producto_masa_id] = d;
      });
    }

    // Combinar productos con sus detalles de empaque
    const productos = productosResult.rows.map((p: any) => ({
      ...p,
      unidades_empacadas: detallesMap[p.id]?.unidades_empacadas ?? null,
      unidades_merma: detallesMap[p.id]?.unidades_merma ?? null,
    }));

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
          lote_produccion: masa.lote_produccion || masa.codigo_masa,
          fecha_produccion: masa.fecha_produccion,
        },
        productos,
        registro_empaque: registroEmpaque,
      }
    });
  } catch (error) {
    logger.error('Error al obtener info de empaque:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener información de empaque',
      error: error.message
    });
  }
};

/**
 * Iniciar empaque — crea el registro cabecera y los detalles por producto
 * POST /api/empaque/:masaId/iniciar
 */
exports.iniciarEmpaque = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { fecha_vencimiento, observaciones } = req.body;
    const usuario = req.user;

    if (!fecha_vencimiento) {
      return res.status(400).json({ success: false, message: 'La fecha de vencimiento es obligatoria' });
    }

    await client.query('BEGIN');

    // Verificar que HORNEADO está completado
    const faseQuery = `
      SELECT estado FROM progreso_fases
      WHERE masa_id = $1 AND fase = 'HORNEADO'
    `;
    const faseResult = await client.query(faseQuery, [masaId]);

    if (faseResult.rows.length === 0 || faseResult.rows[0].estado !== 'COMPLETADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Debe completar la fase de HORNEADO antes de iniciar EMPAQUE'
      });
    }

    // Verificar que no existe ya un empaque
    const existeQuery = `SELECT id FROM registros_empaque WHERE masa_id = $1 LIMIT 1`;
    const existeResult = await client.query(existeQuery, [masaId]);
    if (existeResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Ya existe un registro de empaque para esta masa' });
    }

    // Crear registro cabecera
    const insertEmpaqueQuery = `
      INSERT INTO registros_empaque (
        masa_id,
        fecha_vencimiento,
        estado,
        usuario_id,
        usuario_nombre,
        observaciones
      ) VALUES ($1, $2, 'EN_PROGRESO', $3, $4, $5)
      RETURNING *
    `;
    const empaqueResult = await client.query(insertEmpaqueQuery, [
      masaId,
      fecha_vencimiento,
      usuario.id,
      usuario.nombre_completo,
      observaciones || null
    ]);

    const empaqueId = empaqueResult.rows[0].id;

    // Obtener productos de la masa para crear detalles
    const productosQuery = `
      SELECT
        id,
        COALESCE(unidades_ajustadas, unidades_programadas, unidades_pedidas) AS unidades_ajustadas
      FROM productos_por_masa
      WHERE masa_id = $1
    `;
    const productosResult = await client.query(productosQuery, [masaId]);

    // Insertar detalle por producto
    for (const p of productosResult.rows) {
      await client.query(
        `INSERT INTO empaque_detalles (empaque_id, producto_masa_id, unidades_empacadas, unidades_merma)
         VALUES ($1, $2, $3, 0)`,
        [empaqueId, p.id, p.unidades_ajustadas]
      );
    }

    // Actualizar progreso de fase EMPAQUE
    await client.query(
      `UPDATE progreso_fases
       SET estado = 'EN_PROGRESO', fecha_inicio = NOW(), usuario_responsable = $2, fecha_actualizacion = NOW()
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [masaId, usuario.nombre_completo]
    );

    // Actualizar masa: fase_actual = EMPAQUE
    await client.query(
      `UPDATE masas_produccion SET fase_actual = 'EMPAQUE' WHERE id = $1`,
      [masaId]
    );

    await client.query('COMMIT');

    logger.info(`Empaque iniciado para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Empaque iniciado correctamente',
      data: empaqueResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al iniciar empaque:', error);
    res.status(500).json({ success: false, message: 'Error al iniciar empaque', error: error.message });
  } finally {
    client.release();
  }
};

/**
 * Actualizar unidades empacadas/merma de un producto
 * PATCH /api/empaque/:masaId/detalle/:productoId
 */
exports.actualizarDetalle = async (req, res) => {
  try {
    const { masaId, productoId } = req.params;
    const { unidades_empacadas, unidades_merma } = req.body;

    // Obtener el empaque activo
    const empaqueQuery = `SELECT id FROM registros_empaque WHERE masa_id = $1 AND estado = 'EN_PROGRESO' LIMIT 1`;
    const empaqueResult = await db.query(empaqueQuery, [masaId]);

    if (empaqueResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No se encontró un empaque en progreso para esta masa' });
    }

    const empaqueId = empaqueResult.rows[0].id;

    const updateQuery = `
      UPDATE empaque_detalles
      SET
        unidades_empacadas = COALESCE($3, unidades_empacadas),
        unidades_merma = COALESCE($4, unidades_merma),
        fecha_actualizacion = NOW()
      WHERE empaque_id = $1 AND producto_masa_id = $2
      RETURNING *
    `;
    const result = await db.query(updateQuery, [
      empaqueId,
      productoId,
      unidades_empacadas !== undefined ? unidades_empacadas : null,
      unidades_merma !== undefined ? unidades_merma : null,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Detalle de empaque no encontrado' });
    }

    res.json({ success: true, message: 'Detalle actualizado', data: result.rows[0] });
  } catch (error) {
    logger.error('Error al actualizar detalle de empaque:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar detalle', error: error.message });
  }
};

/**
 * Completar empaque — finaliza la producción
 * POST /api/empaque/:masaId/completar
 */
exports.completarEmpaque = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;
    const usuario = req.user;

    await client.query('BEGIN');

    // Obtener registro de empaque activo
    const empaqueQuery = `
      SELECT id FROM registros_empaque WHERE masa_id = $1 AND estado = 'EN_PROGRESO' LIMIT 1
    `;
    const empaqueResult = await client.query(empaqueQuery, [masaId]);

    if (empaqueResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No se encontró un empaque en progreso' });
    }

    const empaqueId = empaqueResult.rows[0].id;

    // Marcar empaque como COMPLETADO
    await client.query(
      `UPDATE registros_empaque
       SET estado = 'COMPLETADO', fecha_completado = NOW(), observaciones = COALESCE($2, observaciones), fecha_actualizacion = NOW()
       WHERE id = $1`,
      [empaqueId, observaciones || null]
    );

    // Marcar fase EMPAQUE como COMPLETADA
    await client.query(
      `UPDATE progreso_fases
       SET estado = 'COMPLETADA', porcentaje_completado = 100, fecha_completado = NOW(),
           observaciones = $2, fecha_actualizacion = NOW()
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [masaId, observaciones || null]
    );

    // Marcar masa como COMPLETADA
    await client.query(
      `UPDATE masas_produccion SET estado = 'COMPLETADA', fase_actual = 'EMPAQUE' WHERE id = $1`,
      [masaId]
    );

    await client.query('COMMIT');

    logger.info(`Empaque completado para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Empaque completado. Producción finalizada.',
      data: { empaque_id: empaqueId }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al completar empaque:', error);
    res.status(500).json({ success: false, message: 'Error al completar empaque', error: error.message });
  } finally {
    client.release();
  }
};
