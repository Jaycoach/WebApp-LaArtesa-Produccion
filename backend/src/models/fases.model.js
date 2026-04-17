// backend/src/models/fases.model.js
const db = require('../database/connection');

/**
 * CONFIGURACIÓN
 */
const getFactorAbsorcion = async () => {
  const result = await db.query(
    'SELECT valor, updated_at FROM configuracion_sistema WHERE clave = $1',
    ['factor_absorcion_harina'],
  );
  return result.rows[0];
};

const updateFactorAbsorcion = async (factor, userId) => {
  const result = await db.query(`
    UPDATE configuracion_sistema 
    SET valor = $1, updated_by = $2, updated_at = NOW()
    WHERE clave = 'factor_absorcion_harina'
    RETURNING *
  `, [factor.toString(), userId]);
  return result.rows[0];
};

/**
 * MASAS DE PRODUCCIÓN
 */
const createMasaProduccion = async (data) => {
  const {
    codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
    total_kilos_base, total_kilos_con_merma, porcentaje_merma,
    factor_absorcion_usado, created_by,
  } = data;

  const result = await db.query(`
    INSERT INTO masas_produccion (
      codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
      total_kilos_base, total_kilos_con_merma, porcentaje_merma,
      factor_absorcion_usado, estado, fase_actual, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PLANIFICACION', 'PLANIFICACION', $9)
    RETURNING *
  `, [
    codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
    total_kilos_base, total_kilos_con_merma, porcentaje_merma,
    factor_absorcion_usado, created_by,
  ]);

  return result.rows[0];
};

const getMasasByFecha = async (fecha, fase = null) => {
  const params = [fecha];
  let whereExtra = '';

  if (fase) {
    params.push(fase.toUpperCase());
    whereExtra = `AND m.fase_actual = $2`;
  }

  const result = await db.query(`
    SELECT
      m.*,
      COUNT(DISTINCT pm.sap_doc_entry) as total_ordenes,
      COUNT(pm.id) as total_productos,
      SUM(pm.unidades_pedidas) as total_unidades_pedidas,
      SUM(pm.unidades_programadas) as total_unidades_programadas,
      SUM(pm.cantidad_paquetes) as total_panes,
      json_agg(
        json_build_object(
          'producto_nombre', pm.producto_nombre,
          'sap_item_code', pm.sap_item_code,
          'unidades_por_paquete', pm.unidades_por_paquete,
          'cantidad_paquetes', pm.cantidad_paquetes
        ) ORDER BY pm.producto_nombre
      ) FILTER (WHERE pm.id IS NOT NULL) as productos_resumen
    FROM masas_produccion m
    LEFT JOIN productos_por_masa pm ON m.id = pm.masa_id
    WHERE m.fecha_produccion = $1
    ${whereExtra}
    GROUP BY m.id
    ORDER BY m.tipo_masa
  `, params);

  return result.rows;
};

const getMasaById = async (masaId) => {
  // Asegurar que masaId sea un número
  const masaIdNum = Number(masaId);

  const result = await db.query(`
    SELECT * FROM masas_produccion WHERE id = $1
  `, [masaIdNum]);

  return result.rows[0];
};

/**
 * PRODUCTOS POR MASA
 */
const getProductosByMasa = async (masaId) => {
  // Asegurar que masaId sea un número
  const masaIdNum = Number(masaId);

  const result = await db.query(`
    SELECT * FROM productos_por_masa
    WHERE masa_id = $1
    ORDER BY producto_nombre, presentacion
  `, [masaIdNum]);

  return result.rows;
};

const updateUnidadesProgramadas = async (productoId, unidades, userId, motivo = null) => {
  // Leer estado anterior para auditoría
  const anterior = await db.query(
    'SELECT id, masa_id, unidades_programadas, kilos_programados FROM productos_por_masa WHERE id = $1',
    [productoId]
  );
  if (!anterior.rows[0]) return null;

  const result = await db.query(`
    UPDATE productos_por_masa
    SET
      unidades_programadas = $1::integer,
      kilos_programados = gramaje_unitario * $1::integer / 1000.0,
      updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [unidades, productoId]);

  const actualizado = result.rows[0];
  if (!actualizado) return null;

  try {
    await db.query(`
      INSERT INTO auditoria_cambios
        (tabla, registro_id, masa_id, operacion, datos_anteriores, datos_nuevos, campos_modificados, usuario_id, motivo)
      VALUES
        ('productos_por_masa', $1, $2, 'UPDATE', $3::jsonb, $4::jsonb,
         ARRAY['unidades_programadas','kilos_programados'], $5, $6)
    `, [
      productoId,
      anterior.rows[0].masa_id,
      JSON.stringify({ unidades_programadas: anterior.rows[0].unidades_programadas, kilos_programados: anterior.rows[0].kilos_programados }),
      JSON.stringify({ unidades_programadas: actualizado.unidades_programadas, kilos_programados: actualizado.kilos_programados }),
      userId || null,
      motivo || null,
    ]);
  } catch (auditErr) {
    console.error('Error registrando auditoría de ajuste:', auditErr.message);
  }

  return actualizado;
};

/**
 * INGREDIENTES DE MASA
 */
const getIngredientesByMasa = async (masaId) => {
  // Asegurar que masaId sea un número
  const masaIdNum = Number(masaId);

  const result = await db.query(`
    SELECT * FROM ingredientes_masa
    WHERE masa_id = $1
    ORDER BY orden_visualizacion
  `, [masaIdNum]);

  return result.rows;
};

const updateIngredienteChecklist = async (ingredienteId, data) => {
  const {
    disponible, verificado, pesado, peso_real,
    lote, fecha_vencimiento, observaciones, usuarioId,
    lotes_consumo, // array opcional: [{batch, cantidad_kg}]
  } = data;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // ── Reserva de lotes si viene lotes_consumo ──────────────────────
    if (Array.isArray(lotes_consumo) && lotes_consumo.length > 0) {

      // Obtener masa_id e item_code del ingrediente
      const ingRow = await client.query(
        `SELECT masa_id, ingrediente_sap_code FROM ingredientes_masa WHERE id = $1`,
        [ingredienteId]
      );
      if (!ingRow.rows[0]) throw Object.assign(new Error('Ingrediente no encontrado'), { status: 404 });
      const { masa_id, ingrediente_sap_code } = ingRow.rows[0];

      // Devolver stock previo de este ingrediente (si ya tenía lotes reservados)
      const previos = await client.query(
        `SELECT batch, cantidad_kg FROM pesaje_lotes_consumo WHERE ingrediente_id = $1`,
        [ingredienteId]
      );
      for (const p of previos.rows) {
        await client.query(
          `UPDATE sap_lotes_mp
           SET cantidad_disponible = cantidad_disponible + $1, ultimo_sync = NOW()
           WHERE item_code = $2 AND batch = $3`,
          [p.cantidad_kg, ingrediente_sap_code, p.batch]
        );
      }
      await client.query(
        `DELETE FROM pesaje_lotes_consumo WHERE ingrediente_id = $1`,
        [ingredienteId]
      );

      // Validar y descontar cada lote nuevo — SELECT FOR UPDATE evita concurrencia
      for (const lc of lotes_consumo) {
        const lockRow = await client.query(
          `SELECT cantidad_disponible FROM sap_lotes_mp
           WHERE item_code = $1 AND batch = $2
           FOR UPDATE`,
          [ingrediente_sap_code, lc.batch]
        );
        if (!lockRow.rows[0]) {
          throw Object.assign(
            new Error(`Lote ${lc.batch} no encontrado para ítem ${ingrediente_sap_code}`),
            { status: 409, lote: lc.batch }
          );
        }
        const disponibleLote = parseFloat(lockRow.rows[0].cantidad_disponible);
        if (disponibleLote < lc.cantidad_kg) {
          const lotesActuales = await client.query(
            `SELECT batch, cantidad_disponible, expiration_date
             FROM sap_lotes_mp
             WHERE item_code = $1 AND cantidad_disponible > 0
             ORDER BY expiration_date ASC NULLS LAST`,
            [ingrediente_sap_code]
          );
          throw Object.assign(
            new Error(`Stock insuficiente: lote ${lc.batch} tiene ${disponibleLote} kg, se requieren ${lc.cantidad_kg} kg`),
            { status: 409, lote: lc.batch, disponible: disponibleLote, lotes_actuales: lotesActuales.rows }
          );
        }
        await client.query(
          `UPDATE sap_lotes_mp
           SET cantidad_disponible = cantidad_disponible - $1, ultimo_sync = NOW()
           WHERE item_code = $2 AND batch = $3`,
          [lc.cantidad_kg, ingrediente_sap_code, lc.batch]
        );
        await client.query(
          `INSERT INTO pesaje_lotes_consumo
             (ingrediente_id, masa_id, item_code, batch, cantidad_kg, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ingredienteId, masa_id, ingrediente_sap_code, lc.batch, lc.cantidad_kg, usuarioId]
        );
      }

      // lote legacy = primer batch (compatibilidad con enviarInventoryGenExits)
      if (lotes_consumo[0]) data.lote = lotes_consumo[0].batch;
    }

    // ── Validar lote manual contra sap_lotes_mp (cuando no viene lotes_consumo) ─
    if (lote && (!Array.isArray(lotes_consumo) || lotes_consumo.length === 0)) {
      const ingRow2 = await client.query(
        `SELECT ingrediente_sap_code FROM ingredientes_masa WHERE id = $1`,
        [ingredienteId]
      );
      if (ingRow2.rows[0]) {
        const { ingrediente_sap_code } = ingRow2.rows[0];
        const invRow = await client.query(
          `SELECT manage_batch_numbers FROM sap_inventario_mp WHERE item_code = $1`,
          [ingrediente_sap_code]
        );
        if (invRow.rows[0]?.manage_batch_numbers) {
          const loteRow = await client.query(
            `SELECT batch, cantidad_disponible FROM sap_lotes_mp
             WHERE item_code = $1 AND batch = $2 LIMIT 1`,
            [ingrediente_sap_code, lote.trim()]
          );
          if (loteRow.rowCount === 0) {
            const lotesDisp = await client.query(
              `SELECT batch, cantidad_disponible FROM sap_lotes_mp
               WHERE item_code = $1 AND cantidad_disponible > 0
               ORDER BY cantidad_disponible DESC`,
              [ingrediente_sap_code]
            );
            throw Object.assign(
              new Error(`Lote '${lote}' no existe en SAP para ítem ${ingrediente_sap_code}`),
              { status: 409, lote: lote, disponible: 0, lotes_actuales: lotesDisp.rows }
            );
          }
        }
      }
    }

    // ── UPDATE principal ─────────────────────────────────────────────
    const result = await client.query(`
      UPDATE ingredientes_masa
      SET
        disponible        = COALESCE($1, disponible),
        verificado        = COALESCE($2, verificado),
        pesado            = COALESCE($3, pesado),
        peso_real         = COALESCE($4, peso_real),
        diferencia_gramos = CASE
          WHEN $4 IS NOT NULL THEN $4 - cantidad_gramos
          ELSE diferencia_gramos
        END,
        lote              = COALESCE($5, lote),
        fecha_vencimiento = COALESCE($6, fecha_vencimiento),
        observaciones     = COALESCE($7, observaciones),
        usuario_peso      = COALESCE($8, usuario_peso),
        timestamp_peso    = CASE WHEN $3 = TRUE THEN NOW() ELSE timestamp_peso END,
        updated_at        = NOW()
      WHERE id = $9
      RETURNING *
    `, [
      disponible, verificado, pesado, peso_real,
      data.lote ?? lote, fecha_vencimiento, observaciones, usuarioId,
      ingredienteId,
    ]);

    await client.query('COMMIT');
    return result.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const checkTodosPesados = async (masaId) => {
  // Asegurar que masaId sea un número
  const masaIdNum = Number(masaId);

  const result = await db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN disponible AND verificado AND pesado THEN 1 ELSE 0 END) as completados,
      ARRAY_AGG(
        CASE
          WHEN NOT (disponible AND verificado AND pesado)
          THEN ingrediente_nombre
        END
      ) FILTER (WHERE NOT (disponible AND verificado AND pesado)) as faltantes
    FROM ingredientes_masa
    WHERE masa_id = $1
  `, [masaIdNum]);

  const { total, completados, faltantes } = result.rows[0];
  return {
    completo: parseInt(total) === parseInt(completados),
    total: parseInt(total),
    completados: parseInt(completados),
    faltantes: faltantes || [],
  };
};

/**
 * PROGRESO DE FASES
 */
const getProgresoFases = async (masaId) => {
  // Asegurar que masaId sea un número
  const masaIdNum = Number(masaId);

  const result = await db.query(`
    SELECT * FROM progreso_fases
    WHERE masa_id = $1
    ORDER BY
      CASE fase
        WHEN 'PLANIFICACION' THEN 1
        WHEN 'PESAJE' THEN 2
        WHEN 'AMASADO' THEN 3
        WHEN 'DIVISION' THEN 4
        WHEN 'FORMADO' THEN 5
        WHEN 'FERMENTACION' THEN 6
        WHEN 'HORNEADO' THEN 7
        WHEN 'EMPAQUE' THEN 8
      END
  `, [masaIdNum]);

  return result.rows;
};

const updateEstadoFase = async (masaId, fase, estado, porcentaje, userId, datosFase = null) => {
  // Asegurar que los tipos sean correctos
  const masaIdNum = Number(masaId);
  const userIdNum = userId ? Number(userId) : null;
  const porcentajeNum = Number(porcentaje);

  // Si datosFase es null, no actualizar ese campo
  if (!datosFase) {
    const result = await db.query(`
      UPDATE progreso_fases
      SET
        estado = $1::text,
        porcentaje_completado = $2::integer,
        usuario_responsable = $3::integer,
        fecha_completado = CASE WHEN $1::text = 'COMPLETADA' THEN NOW() ELSE fecha_completado END,
        fecha_inicio = CASE WHEN $1::text = 'EN_PROGRESO' AND fecha_inicio IS NULL THEN NOW() ELSE fecha_inicio END,
        updated_at = NOW()
      WHERE masa_id = $4::integer AND fase = $5::text
      RETURNING *
    `, [estado, porcentajeNum, userIdNum, masaIdNum, fase]);

    return result.rows[0];
  }

  // Si datosFase existe, incluirlo en la actualización
  const datosFaseJson = JSON.stringify(datosFase);

  const result = await db.query(`
    UPDATE progreso_fases
    SET
      estado = $1::text,
      porcentaje_completado = $2::integer,
      usuario_responsable = $3::integer,
      fecha_completado = CASE WHEN $1::text = 'COMPLETADA' THEN NOW() ELSE fecha_completado END,
      fecha_inicio = CASE WHEN $1::text = 'EN_PROGRESO' AND fecha_inicio IS NULL THEN NOW() ELSE fecha_inicio END,
      datos_fase = $4::jsonb,
      updated_at = NOW()
    WHERE masa_id = $5::integer AND fase = $6::text
    RETURNING *
  `, [estado, porcentajeNum, userIdNum, datosFaseJson, masaIdNum, fase]);

  return result.rows[0];
};

const desbloquearSiguienteFase = async (masaId, faseActual) => {
  const fasesOrden = {
    PLANIFICACION: 'PESAJE',
    PESAJE: 'AMASADO',
    AMASADO: 'DIVISION',
    DIVISION: 'FORMADO',
    FORMADO: 'FERMENTACION',
    FERMENTACION: 'HORNEADO',
    HORNEADO: 'EMPAQUE',
  };

  const siguienteFase = fasesOrden[faseActual];
  if (!siguienteFase) return null;

  const masaIdNum = Number(masaId);

  // Desbloquear la siguiente fase estableciéndola como EN_PROGRESO
  const result = await db.query(`
    UPDATE progreso_fases
    SET estado = 'EN_PROGRESO', updated_at = NOW()
    WHERE masa_id = $1 AND fase = $2
    RETURNING *
  `, [masaIdNum, siguienteFase]);

  // Actualizar fase_actual en masas_produccion
  await db.query(`
    UPDATE masas_produccion
    SET fase_actual = $1, updated_at = NOW()
    WHERE id = $2
  `, [siguienteFase, masaIdNum]);

  return result.rows[0];
};

/**
 * NOTIFICACIONES EMPAQUE
 */
const createNotificacionEmpaque = async (data) => {
  const {
    masa_id, destinatarios, asunto, cuerpo,
    estado_envio, fecha_envio, error_mensaje, enviado_por,
  } = data;

  const result = await db.query(`
    INSERT INTO notificaciones_empaque (
      masa_id, destinatarios, asunto, cuerpo,
      estado_envio, fecha_envio, error_mensaje, enviado_por
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    masa_id, destinatarios, asunto, cuerpo,
    estado_envio, fecha_envio, error_mensaje, enviado_por,
  ]);

  return result.rows[0];
};

module.exports = {
  // Configuración
  getFactorAbsorcion,
  updateFactorAbsorcion,
  // Masas
  createMasaProduccion,
  getMasasByFecha,
  getMasaById,
  // Productos
  getProductosByMasa,
  updateUnidadesProgramadas,
  // Ingredientes
  getIngredientesByMasa,
  updateIngredienteChecklist,
  checkTodosPesados,
  // Progreso
  getProgresoFases,
  updateEstadoFase,
  desbloquearSiguienteFase,
  // Notificaciones
  createNotificacionEmpaque,
};
