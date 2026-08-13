/**
 * Controlador para el proceso de FORMADO
 * Basado en reunión 23/01/2026
 */

const db = require('../database/connection');
const logger = require('../utils/logger');
const { calcularAjustesPendientes } = require('./pesaje.controller');

/**
 * Obtener información de formado para una masa
 * GET /api/formado/:masaId
 */
exports.getFormadoInfo = async (req, res) => {
  try {
    const { masaId } = req.params;

    // Verificar que la masa existe
    const masaQuery = `
      SELECT
        mp.id,
        mp.uuid,
        mp.codigo_masa,
        mp.tipo_masa,
        mp.nombre_masa,
        mp.estado,
        mp.fase_actual,
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

    // Fase 5 (12-ago-2026): requiere_formado ya no es de la masa completa —
    // se decide por producto (productos_por_masa.requiere_formado).
    const requiereResult = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM productos_por_masa WHERE masa_id = $1 AND requiere_formado = true
       ) AS requiere_formado`,
      [masaId]
    );
    const masaRequiereFormado = requiereResult.rows[0]?.requiere_formado === true;

    // Si ningún producto de la masa requiere formado, no es un error —
    // informar la fase siguiente para que el frontend muestre un CTA
    // directo en vez de un mensaje de error sin salida.
    if (!masaRequiereFormado) {
      return res.json({
        success: true,
        data: {
          no_requiere_formado: true,
          masa: {
            id: masa.id,
            codigo: masa.codigo_masa,
            tipo: masa.tipo_masa,
            nombre: masa.nombre_masa,
            estado: masa.estado,
            fase_actual: masa.fase_actual,
          },
          siguiente_fase: 'FERMENTACION',
        }
      });
    }

    // Obtener SOLO los productos que requieren formado
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
      LEFT JOIN LATERAL (
        SELECT largo_cm, ancho_cm, alto_cm, diametro_cm, tolerancia_cm
        FROM especificaciones_formado
        WHERE producto_codigo = ppm.producto_codigo
           OR tipo_masa = $2
        ORDER BY
          CASE WHEN producto_codigo = ppm.producto_codigo THEN 0 ELSE 1 END
        LIMIT 1
      ) ef ON true
      WHERE ppm.masa_id = $1 AND ppm.requiere_formado = true
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

    // Obtener registro existente de formado (si existe) + detalle por producto
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

    const detallesResult = registroResult.rows[0]
      ? await db.query(
          `SELECT fd.id, fd.producto_masa_id, fd.maquina_formado_id, fd.maquina_nombre,
                  fd.unidades_formadas, fd.fecha_actualizacion
           FROM formado_detalles fd
           WHERE fd.registro_formado_id = $1`,
          [registroResult.rows[0].id]
        )
      : { rows: [] };

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
        registro_actual: registroResult.rows[0] || null,
        detalles: detallesResult.rows
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
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;

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

    // Crear registro de formado (header — la máquina/unidades se registran
    // por producto en formado_detalles, Fase 5)
    const insertQuery = `
      INSERT INTO registros_formado (
        masa_id,
        fecha_inicio,
        usuario_id,
        usuario_nombre,
        observaciones
      ) VALUES ($1, NOW(), $2, $3, $4)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      masaId,
      usuario.id,
      usuario.nombre_completo,
      observaciones || null
    ]);
    const registroFormadoId = result.rows[0].id;

    // Un formado_detalles por producto que requiere formado — mismo patrón
    // que iniciarEmpaque/empaque_detalles (empaque.controller.js:353-381)
    const prodsR = await client.query(
      `SELECT id FROM productos_por_masa WHERE masa_id = $1 AND requiere_formado = true`,
      [masaId]
    );
    for (const p of prodsR.rows) {
      await client.query(
        `INSERT INTO formado_detalles (registro_formado_id, producto_masa_id, unidades_formadas)
         VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
        [registroFormadoId, p.id]
      );
    }

    // Actualizar progreso de fase FORMADO a EN_PROGRESO
    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'EN_PROGRESO',
        fecha_inicio = NOW(),
        usuario_responsable = $2
      WHERE masa_id = $1 AND fase = 'FORMADO'
    `;
    await client.query(updateFaseQuery, [masaId, usuario.id]);

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
 * Actualizar máquina/unidades formadas de un producto puntual (Fase 5)
 * PATCH /api/formado/:masaId/detalle/:productoId
 */
exports.actualizarDetalle = async (req, res) => {
  try {
    const { masaId, productoId } = req.params;
    const { maquina_formado_id, unidades_formadas } = req.body;

    const regR = await db.query(
      `SELECT id FROM registros_formado WHERE masa_id = $1 ORDER BY fecha_registro DESC LIMIT 1`,
      [masaId]
    );
    if (!regR.rows.length) {
      return res.status(400).json({ success: false, message: 'No hay formado en progreso' });
    }

    let maquinaNombre = null;
    if (maquina_formado_id) {
      const maqR = await db.query(`SELECT nombre FROM maquinas_formado WHERE id = $1`, [maquina_formado_id]);
      if (!maqR.rows.length) {
        return res.status(404).json({ success: false, message: 'Máquina de formado no encontrada' });
      }
      maquinaNombre = maqR.rows[0].nombre;
    }

    const r = await db.query(
      `UPDATE formado_detalles
       SET maquina_formado_id = COALESCE($3, maquina_formado_id),
           maquina_nombre     = COALESCE($4, maquina_nombre),
           unidades_formadas  = COALESCE($5, unidades_formadas),
           fecha_actualizacion = NOW()
       WHERE registro_formado_id = $1 AND producto_masa_id = $2
       RETURNING *`,
      [regR.rows[0].id, productoId, maquina_formado_id ?? null, maquinaNombre, unidades_formadas ?? null]
    );
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'Detalle de formado no encontrado para este producto' });
    }

    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    logger.error('Error actualizarDetalle formado:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Completar proceso de formado
 * POST /api/formado/:masaId/completar
 */
exports.completarFormado = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;

    const usuario = req.user;

    // Bloqueo: no se puede completar si hay ajustes de pesaje pendientes de SAP
    const ajustesPendientes = await calcularAjustesPendientes(masaId);
    if (ajustesPendientes.length > 0) {
      return res.status(409).json({
        success: false,
        message: `No se puede completar FORMADO: hay ${ajustesPendientes.length} ajuste(s) de pesaje pendientes de transmitir a SAP. Ve a Pesaje y confirma los ajustes antes de continuar.`,
        data: { ajustes_pendientes: ajustesPendientes },
      });
    }

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

    // Validar que todos los productos de este formado ya tienen unidades formadas
    const pendientesR = await client.query(
      `SELECT ppm.producto_nombre
       FROM formado_detalles fd
       JOIN productos_por_masa ppm ON ppm.id = fd.producto_masa_id
       WHERE fd.registro_formado_id = $1 AND fd.unidades_formadas <= 0`,
      [registro.id]
    );
    if (pendientesR.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Faltan productos por formar: ${pendientesR.rows.map(p => p.producto_nombre).join(', ')}`,
      });
    }

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
        observaciones = $2
      WHERE masa_id = $1 AND fase = 'FORMADO'
    `;
    await client.query(updateFaseQuery, [masaId, observaciones || null]);

    await client.query('COMMIT');

    // Desbloquear fase FERMENTACION usando el modelo estándar
    const fasesModel = require('../models/fases.model');
    await fasesModel.desbloquearSiguienteFase(masaId, 'FORMADO');

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
