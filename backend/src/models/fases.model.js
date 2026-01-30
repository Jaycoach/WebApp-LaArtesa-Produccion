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

const getMasasByFecha = async (fecha) => {
  const result = await db.query(`
    SELECT 
      m.*,
      COUNT(DISTINCT omr.orden_sap_docentry) as total_ordenes,
      COUNT(pm.id) as total_productos,
      SUM(pm.unidades_pedidas) as total_unidades_pedidas,
      SUM(pm.unidades_programadas) as total_unidades_programadas
    FROM masas_produccion m
    LEFT JOIN orden_masa_relacion omr ON m.id = omr.masa_id
    LEFT JOIN productos_por_masa pm ON m.id = pm.masa_id
    WHERE m.fecha_produccion = $1
    GROUP BY m.id
    ORDER BY m.tipo_masa
  `, [fecha]);

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

const updateUnidadesProgramadas = async (productoId, unidades, userId) => {
  const result = await db.query(`
    UPDATE productos_por_masa
    SET 
      unidades_programadas = $1,
      kilos_programados = gramaje_unitario * $1 / 1000,
      updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [unidades, productoId]);

  return result.rows[0];
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
  } = data;

  const result = await db.query(`
    UPDATE ingredientes_masa
    SET 
      disponible = COALESCE($1, disponible),
      verificado = COALESCE($2, verificado),
      pesado = COALESCE($3, pesado),
      peso_real = COALESCE($4, peso_real),
      diferencia_gramos = CASE 
        WHEN $4 IS NOT NULL THEN $4 - cantidad_gramos 
        ELSE diferencia_gramos 
      END,
      lote = COALESCE($5, lote),
      fecha_vencimiento = COALESCE($6, fecha_vencimiento),
      observaciones = COALESCE($7, observaciones),
      usuario_peso = COALESCE($8, usuario_peso),
      timestamp_peso = CASE WHEN $3 = TRUE THEN NOW() ELSE timestamp_peso END,
      updated_at = NOW()
    WHERE id = $9
    RETURNING *
  `, [
    disponible, verificado, pesado, peso_real,
    lote, fecha_vencimiento, observaciones, usuarioId,
    ingredienteId,
  ]);

  return result.rows[0];
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
