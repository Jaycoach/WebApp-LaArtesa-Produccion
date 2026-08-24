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
    // La masa madre SUBDIVIDIDA solo se excluye cuando se filtra por fase
    // (Pesaje, Amasado, etc.) — en Planificación (fase=null) sí debe verse.
    whereExtra = `AND m.fase_actual = $2 AND m.estado != 'SUBDIVIDIDA'`;
  }

  const result = await db.query(`
    SELECT
      m.*,
      COALESCE((
        SELECT SUM(im.peso_real)
        FROM ingredientes_masa im
        WHERE im.masa_id = m.id
          AND im.es_empaque = false
          AND im.es_decoracion = false
          AND im.pesado = true
      ), 0) / 1000 AS total_kilos_pesado_real,
      (SELECT COUNT(DISTINCT ov.sap_doc_entry) FROM productos_por_masa_ov ov WHERE ov.masa_id = m.id) as total_ordenes,
      (SELECT array_agg(ov.sap_doc_num::text ORDER BY ov.sap_doc_num) FROM (SELECT DISTINCT sap_doc_num FROM productos_por_masa_ov WHERE masa_id = m.id) ov) as numeros_ov,
      COUNT(pm.id) as total_productos,
      SUM(pm.unidades_pedidas) as total_unidades_pedidas,
      SUM(COALESCE(pm.unidades_ajustadas, pm.unidades_programadas)) as total_unidades_programadas,
      -- FIX 2026-08-10: pese al nombre, esto sumaba cantidad_paquetes (no panes
      -- reales) sobre la base sin ajustar. Se deja el mismo criterio de paquetes
      -- pero ahora contra unidades_ajustadas, coherente con el resto del fix.
      SUM(COALESCE(pm.unidades_ajustadas, pm.cantidad_paquetes)) as total_panes,
      BOOL_AND(COALESCE(pm.division_completada, false)) as division_completada_total,
      SUM(CASE WHEN pm.division_completada THEN pm.unidades_producidas ELSE NULL END) as total_panes_cortados,
      json_agg(
        json_build_object(
          'producto_nombre', pm.producto_nombre,
          'sap_item_code', pm.sap_item_code,
          'unidades_por_paquete', pm.unidades_por_paquete,
          'cantidad_paquetes', pm.cantidad_paquetes,
          'unidades_producidas', pm.unidades_producidas,
          'division_completada', COALESCE(pm.division_completada, false),
          'apto_produccion', pm.apto_produccion,
          'campos_incompletos', sa.campos_incompletos
        ) ORDER BY pm.producto_nombre
      ) FILTER (WHERE pm.id IS NOT NULL) as productos_resumen
    FROM masas_produccion m
    LEFT JOIN productos_por_masa pm ON m.id = pm.masa_id
    LEFT JOIN sap_articulos sa ON sa.item_code = pm.sap_item_code
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
    SELECT
      mp.*,
      COALESCE((
        SELECT SUM(im.peso_real)
        FROM ingredientes_masa im
        WHERE im.masa_id = mp.id
          AND im.es_empaque = false
          AND im.es_decoracion = false
          AND im.pesado = true
      ), 0) / 1000 AS total_kilos_pesado_real
    FROM masas_produccion mp
    WHERE mp.id = $1
  `, [masaIdNum]);

  return result.rows[0];
};

/**
 * PRODUCTOS POR MASA
 */
const getProductosByMasa = async (masaId) => {
  // Asegurar que masaId sea un número
  const masaIdNum = Number(masaId);

  // FIX B4 (2026-08-04): LEFT JOIN a sap_articulos para exponer el valor VIVO
  // del divisor en SAP junto al snapshot guardado (multiplo_divisor). No se
  // toca el snapshot — todos los cálculos existentes siguen usando la misma
  // columna de siempre. Solo se agrega multiplo_divisor_sap_actual para que
  // el frontend pueda avisar si están desincronizados.
  // FIX DetalleMasa (2026-08-06): LEFT JOIN LATERAL a productos_por_masa_ov
  // para exponer las OV de SAP que componen cada producto (hallazgo en
  // pruebas B1: la pantalla de detalle de masa no mostraba las OV incluidas,
  // aunque el dato ya existe en productos_por_masa_ov desde la migración 039).
  const result = await db.query(`
    SELECT ppm.*,
           sa.multiplo_divisor AS multiplo_divisor_sap_actual,
           sa.campos_incompletos,
           COALESCE(ov.ordenes, '[]'::json) AS ordenes_venta
    FROM productos_por_masa ppm
    LEFT JOIN sap_articulos sa ON sa.item_code = ppm.sap_item_code
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'sap_doc_entry', ppmo.sap_doc_entry,
                 'sap_doc_num', ppmo.sap_doc_num,
                 'sap_line_num', ppmo.sap_line_num,
                 'unidades_pedidas', ppmo.unidades_pedidas
               ) ORDER BY ppmo.sap_doc_num
             ) AS ordenes
      FROM productos_por_masa_ov ppmo
      WHERE ppmo.producto_masa_id = ppm.id
    ) ov ON true
    WHERE ppm.masa_id = $1
    ORDER BY ppm.producto_nombre, ppm.presentacion
  `, [masaIdNum]);

  return result.rows;
};

const getInfoCancelacion = async (masaId) => {
  const masasResult = await db.query(
    `WITH RECURSIVE relacionadas AS (
       SELECT m.id, m.codigo_masa, m.estado, m.sap_doc_entry_pesaje, m.masa_padre_id,
              m.masa_adicional_referencia_id
       FROM masas_produccion m
       WHERE m.id = $1
       UNION
       SELECT m.id, m.codigo_masa, m.estado, m.sap_doc_entry_pesaje, m.masa_padre_id,
              m.masa_adicional_referencia_id
       FROM masas_produccion m
       INNER JOIN relacionadas r
         ON m.masa_padre_id = r.id OR m.masa_adicional_referencia_id = r.id
     )
     SELECT r.id, r.codigo_masa, r.estado, r.sap_doc_entry_pesaje, pf.estado AS estado_pesaje
     FROM relacionadas r
     LEFT JOIN progreso_fases pf ON pf.masa_id = r.id AND pf.fase = 'PESAJE'
     WHERE r.estado != 'CANCELADA'
     ORDER BY r.id`,
    [masaId]
  );

  const masas = masasResult.rows.map(m => ({
    ...m,
    bloqueada: m.estado_pesaje === 'COMPLETADA' || !!m.sap_doc_entry_pesaje,
  }));

  const idsRelacionados = masas.map(m => m.id);
  let lineas = [];
  if (idsRelacionados.length > 0) {
    const lineasResult = await db.query(
      `SELECT ov.masa_id, ov.sap_doc_entry, ov.sap_doc_num, ov.sap_line_num,
              ov.sap_item_code, ov.unidades_pedidas, ov.cantidad_abierta_sap
       FROM productos_por_masa_ov ov
       WHERE ov.masa_id = ANY($1::int[])
       ORDER BY ov.sap_doc_num, ov.sap_line_num`,
      [idsRelacionados]
    );
    lineas = lineasResult.rows;
  }

  return { masas, lineas };
};

const updateUnidadesProgramadas = async (productoId, unidades, userId, motivo = null) => {
  // Leer estado anterior para auditoría
  const anterior = await db.query(
    'SELECT id, masa_id, unidades_programadas, unidades_pedidas, kilos_programados FROM productos_por_masa WHERE id = $1',
    [productoId]
  );
  if (!anterior.rows[0]) return null;

  const deltaAjuste = Number(unidades) - Number(anterior.rows[0].unidades_pedidas);
  // FIX 2026-08-10: recalcular unidades_ajustadas/unidades_excedente al guardar el
  // delta manual — antes solo se recalculaban al aprobar (y solo para productos
  // nunca tocados), dejando el ajuste manual con el multiplo_divisor congelado
  // desde la sincronizacion de OV.
  const result = await db.query(`
    UPDATE productos_por_masa
    SET
      unidades_programadas = $1::integer,
      kilos_programados = gramaje_unitario * ($1::integer * unidades_por_paquete) / 1000.0,
      cantidad_paquetes = $1::integer,
      delta_ajuste = $3::integer,
      unidades_ajustadas = CASE
        WHEN multiplo_divisor > 0 AND unidades_por_paquete > 0 THEN
          ROUND(
            (CEIL(($1::integer * unidades_por_paquete) / multiplo_divisor::numeric) * multiplo_divisor)
            / unidades_por_paquete
          )
        ELSE $1::integer
      END,
      unidades_excedente = CASE
        WHEN multiplo_divisor > 0 AND unidades_por_paquete > 0 THEN
          ROUND(
            (CEIL(($1::integer * unidades_por_paquete) / multiplo_divisor::numeric) * multiplo_divisor)
            / unidades_por_paquete
          ) - $1::integer
        ELSE 0
      END,
      updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [unidades, productoId, deltaAjuste]);

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
    WHERE masa_id = $1 AND es_empaque = false
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
        `SELECT masa_id, ingrediente_sap_code FROM ingredientes_masa WHERE id = $1 FOR UPDATE`,
        [ingredienteId]
      );
      if (!ingRow.rows[0]) throw Object.assign(new Error('Ingrediente no encontrado'), { status: 404 });
      const { masa_id, ingrediente_sap_code } = ingRow.rows[0];

      // Ya no se "devuelve" stock aquí — cantidad_disponible es el stock real
      // de SAP y las reservas nunca lo restan. Solo se limpia la reserva previa.
      await client.query(
        `DELETE FROM pesaje_lotes_consumo WHERE ingrediente_id = $1`,
        [ingredienteId]
      );

      // Validar y descontar cada lote nuevo — SELECT FOR UPDATE evita concurrencia
      for (const lc of lotes_consumo) {
        // FIX 2026-08-24: sin este chequeo, una cantidad que resuelve a 0 (o
        // negativa) llegaba intacta hasta el INSERT y violaba el
        // CHECK (cantidad_kg > 0) de pesaje_lotes_consumo — una excepción de
        // Postgres sin manejar que el controller devolvía como 500 vacío.
        if (!(parseFloat(lc.cantidad_kg) > 0)) {
          throw Object.assign(
            new Error(`Cantidad inválida para el lote ${lc.batch}: debe ser mayor a 0 kg.`),
            { status: 422, lote: lc.batch }
          );
        }
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
        // La reserva ya NO descuenta cantidad_disponible (stock real) — solo queda
        // registrada en pesaje_lotes_consumo, informativa, sin bloquear a otras masas.
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

/**
 * Auto-completa ingredientes de decoración al confirmar pesaje: asigna lote(s)
 * FEFO (mismo criterio que lotes_consumo_sugerido: expiration_date ASC NULLS LAST),
 * descuenta sap_lotes_mp, y marca disponible/verificado/pesado=true con peso teórico.
 * Si no hay stock suficiente, NO bloquea — marca pesado igual, sin lote asignado
 * (o parcial), para que el consumo a SAP se siga enviando con lo disponible.
 */
const autoCompletarDecoracion = async (masaId, usuarioId) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const decoResult = await client.query(
      `SELECT id, ingrediente_sap_code, cantidad_gramos, cantidad_kilos
       FROM ingredientes_masa
       WHERE masa_id = $1 AND es_decoracion = true AND es_empaque = false AND pesado IS DISTINCT FROM true`,
      [masaId]
    );

    for (const ing of decoResult.rows) {
      const cantidadKgRequerida = parseFloat(ing.cantidad_kilos) || (parseFloat(ing.cantidad_gramos) / 1000) || 0;
      let loteAsignado = null;

      if (ing.ingrediente_sap_code && cantidadKgRequerida > 0) {
        const lotesResult = await client.query(
          `SELECT batch, cantidad_disponible FROM sap_lotes_mp
           WHERE item_code = $1 AND cantidad_disponible > 0
           ORDER BY expiration_date ASC NULLS LAST, admission_date ASC NULLS LAST
           FOR UPDATE`,
          [ing.ingrediente_sap_code]
        );

        let restante = cantidadKgRequerida;
        for (const lote of lotesResult.rows) {
          if (restante <= 0) break;
          const disponibleLote = parseFloat(lote.cantidad_disponible);
          const aTomar = Math.min(disponibleLote, restante);
          if (aTomar <= 0) continue;

          await client.query(
            `UPDATE sap_lotes_mp SET cantidad_disponible = cantidad_disponible - $1, ultimo_sync = NOW()
             WHERE item_code = $2 AND batch = $3`,
            [aTomar, ing.ingrediente_sap_code, lote.batch]
          );
          await client.query(
            `INSERT INTO pesaje_lotes_consumo (ingrediente_id, masa_id, item_code, batch, cantidad_kg, usuario_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ing.id, masaId, ing.ingrediente_sap_code, lote.batch, aTomar, usuarioId]
          );
          if (!loteAsignado) loteAsignado = lote.batch;
          restante -= aTomar;
        }
      }

      await client.query(
        `UPDATE ingredientes_masa
         SET disponible = true, verificado = true, pesado = true,
             peso_real = COALESCE(peso_real, cantidad_gramos),
             lote = COALESCE($2, lote),
             usuario_peso = COALESCE(usuario_peso, $3),
             timestamp_peso = COALESCE(timestamp_peso, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [ing.id, loteAsignado, usuarioId]
      );
    }

    await client.query('COMMIT');
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

  // Los ingredientes de decoración se consumen automático (Kevin, reunión: "no lo pesen,
  // pero mándenlo en el consumo") — no exigen los 3 checks manuales del operario.
  const result = await db.query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN es_decoracion OR (disponible AND verificado AND pesado) THEN 1 ELSE 0 END) as completados,
      ARRAY_AGG(
        CASE
          WHEN NOT (es_decoracion OR (disponible AND verificado AND pesado))
          THEN ingrediente_nombre
        END
      ) FILTER (WHERE NOT (es_decoracion OR (disponible AND verificado AND pesado))) as faltantes
    FROM ingredientes_masa
    WHERE masa_id = $1 AND es_empaque = false
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

const desbloquearSiguienteFase = async (masaId, faseActual, usuarioId = null) => {
  const fasesOrden = {
    PLANIFICACION: 'PESAJE',
    PESAJE: 'AMASADO',
    AMASADO: 'DIVISION',
    DIVISION: 'FORMADO',
    FORMADO: 'FERMENTACION',
    FERMENTACION: 'HORNEADO',
    HORNEADO: 'EMPAQUE',
  };

  const masaIdNum = Number(masaId);

  // Si viene de DIVISION, verificar si la masa requiere formado.
  // Fase 5 (12-ago-2026): el criterio pasa de tipo_masa completo
  // (catalogo_tipos_masa.requiere_formado, deprecado para esto) a
  // producto/SKU individual — se abre FORMADO si AL MENOS UN producto de
  // la masa lo requiere, aunque otros de la misma masa no lo necesiten.
  if (faseActual === 'DIVISION') {
    const reqResult = await db.query(`
      SELECT EXISTS (
        SELECT 1 FROM productos_por_masa
        WHERE masa_id = $1 AND requiere_formado = true
      ) AS requiere_formado
    `, [masaIdNum]);

    const requiereFormado = reqResult.rows[0]?.requiere_formado === true;

    if (!requiereFormado) {
      // Saltar FORMADO: marcarlo COMPLETADA automáticamente y abrir FERMENTACION.
      // Se firma con el usuario que completó DIVISION (quien disparó este auto-skip)
      // ya que no hay una acción manual propia de FORMADO que lo firme en este caso.
      await db.query(`
        UPDATE progreso_fases
        SET estado = 'COMPLETADA', porcentaje_completado = 100, fecha_completado = NOW(),
            usuario_responsable = $2, updated_at = NOW()
        WHERE masa_id = $1 AND fase = 'FORMADO'
      `, [masaIdNum, usuarioId]);

      const result = await db.query(`
        UPDATE progreso_fases
        SET estado = 'EN_PROGRESO', updated_at = NOW()
        WHERE masa_id = $1 AND fase = 'FERMENTACION'
        RETURNING *
      `, [masaIdNum]);

      await db.query(`
        UPDATE masas_produccion
        SET fase_actual = 'FERMENTACION', updated_at = NOW()
        WHERE id = $1
      `, [masaIdNum]);

      return result.rows[0];
    }
    // Si requiere formado: flujo normal → abre FORMADO
  }

  const siguienteFase = fasesOrden[faseActual];
  if (!siguienteFase) return null;

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
  getInfoCancelacion,
  // Ingredientes
  getIngredientesByMasa,
  updateIngredienteChecklist,
  autoCompletarDecoracion,
  checkTodosPesados,
  // Progreso
  getProgresoFases,
  updateEstadoFase,
  desbloquearSiguienteFase,
  // Notificaciones
  createNotificacionEmpaque,
};
