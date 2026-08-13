/**
 * Controlador para el proceso de FERMENTACIÓN
 * Basado en reunión 23/01/2026
 * Fase 6 (13-ago-2026): fermentación por producto/línea — cada producto
 * puede ir a una cámara distinta (camaras_fermentacion, migración 053),
 * con su propia hora de entrada/salida. Ver fermentacion_detalles
 * (migración 057). La cámara fría ya no es un paso condicional aparte:
 * es una fila más del catálogo elegible en la entrada de cualquier línea.
 */

const db = require('../database/connection');
const logger = require('../utils/logger');
const { calcularAjustesPendientes } = require('./pesaje.controller');

/**
 * Obtener información de fermentación para una masa
 * GET /api/fermentacion/:masaId
 */
exports.getFermentacionInfo = async (req, res) => {
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

    // Catálogo de cámaras disponibles (migración 053) — incluye la fría,
    // ya no es un flujo condicional aparte (Fase 6)
    const camarasResult = await db.query(
      `SELECT id, nombre, tipo FROM camaras_fermentacion WHERE activa = true ORDER BY nombre`
    );

    // Registro de fermentación (header de sesión — Fase 6 lo simplifica,
    // el detalle por línea vive en fermentacion_detalles)
    const registroQuery = `
      SELECT
        rf.id,
        rf.uuid,
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

    // Kevin (reunión, 1:00:03): solo código + nombre + cantidad de panes,
    // sin gramaje ni paquetes pedidos — solo lo esencial para identificar el producto.
    const productosQuery = `
      SELECT
        pm.id,
        pm.producto_codigo,
        pm.producto_nombre,
        pm.sap_item_code,
        COALESCE(pm.cantidad_divisiones, pm.unidades_ajustadas, pm.unidades_pedidas, 0) AS cantidad_panes
      FROM productos_por_masa pm
      WHERE pm.masa_id = $1
      ORDER BY pm.producto_nombre
    `;
    const productosResult = await db.query(productosQuery, [masaId]);

    // Detalle por línea (Fase 6) — solo si ya hay un registro de sesión
    const detallesResult = registroResult.rows[0]
      ? await db.query(
          `SELECT fd.id, fd.producto_masa_id, fd.camara_id, fd.camara_nombre,
                  fd.hora_entrada_camara, fd.hora_salida_camara,
                  fd.tiempo_fermentacion_minutos, fd.temperatura_camara, fd.humedad_camara,
                  fd.fecha_actualizacion
           FROM fermentacion_detalles fd
           WHERE fd.registro_fermentacion_id = $1`,
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
          tiempo_fermentacion_estandar_minutos: masa.tiempo_fermentacion_estandar_minutos
        },
        camaras_disponibles: camarasResult.rows,
        registro_actual: registroResult.rows[0] || null,
        productos: productosResult.rows,
        detalles: detallesResult.rows
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
 * Registrar entrada a cámara de una línea (producto) de fermentación.
 * Crea el registro de sesión (header) si es la primera línea de la masa.
 * POST /api/fermentacion/:masaId/camara/entrada/:productoId
 */
exports.registrarEntradaCamara = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId, productoId } = req.params;
    const {
      temperatura_camara,
      humedad_camara,
      hora_entrada_real,
      camara_id
    } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    // El producto debe pertenecer a esta masa
    const productoCheck = await client.query(
      `SELECT id FROM productos_por_masa WHERE id = $1 AND masa_id = $2`,
      [productoId, masaId]
    );
    if (!productoCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Producto no encontrado en esta masa' });
    }

    let camaraNombre = null;
    if (camara_id) {
      const camR = await client.query(
        `SELECT nombre FROM camaras_fermentacion WHERE id = $1 AND activa = true`, [camara_id]
      );
      if (!camR.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Cámara no encontrada o inactiva' });
      }
      camaraNombre = camR.rows[0].nombre;
    }

    // Buscar registro de sesión existente; si no hay, esta es la primera
    // línea que entra — validar fase anterior y crear el header
    let registroResult = await client.query(
      `SELECT id FROM registros_fermentacion WHERE masa_id = $1 ORDER BY fecha_registro DESC LIMIT 1`,
      [masaId]
    );

    let registroFermentacionId;

    if (registroResult.rows.length === 0) {
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

      const insertHeaderQuery = `
        INSERT INTO registros_fermentacion (masa_id, usuario_id, usuario_nombre)
        VALUES ($1, $2, $3)
        RETURNING id
      `;
      const headerResult = await client.query(insertHeaderQuery, [
        masaId, usuario.id, usuario.nombre_completo
      ]);
      registroFermentacionId = headerResult.rows[0].id;

      const updateFaseQuery = `
        UPDATE progreso_fases
        SET estado = 'EN_PROGRESO', fecha_inicio = NOW(), usuario_responsable = $2
        WHERE masa_id = $1 AND fase = 'FERMENTACION'
      `;
      await client.query(updateFaseQuery, [masaId, usuario.id]);

      const updateMasaQuery = `
        UPDATE masas_produccion SET fase_actual = 'FERMENTACION' WHERE id = $1
      `;
      await client.query(updateMasaQuery, [masaId]);
    } else {
      registroFermentacionId = registroResult.rows[0].id;
    }

    // Registrar/actualizar la línea (permite corregir si el operario se equivoca)
    const upsertQuery = `
      INSERT INTO fermentacion_detalles (
        registro_fermentacion_id, producto_masa_id, camara_id, camara_nombre,
        hora_entrada_camara, temperatura_camara, humedad_camara
      ) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7)
      ON CONFLICT (registro_fermentacion_id, producto_masa_id) DO UPDATE SET
        camara_id = EXCLUDED.camara_id,
        camara_nombre = EXCLUDED.camara_nombre,
        hora_entrada_camara = EXCLUDED.hora_entrada_camara,
        temperatura_camara = EXCLUDED.temperatura_camara,
        humedad_camara = EXCLUDED.humedad_camara,
        fecha_actualizacion = NOW()
      RETURNING *
    `;
    const result = await client.query(upsertQuery, [
      registroFermentacionId,
      productoId,
      camara_id || null,
      camaraNombre,
      hora_entrada_real || null,
      temperatura_camara || null,
      humedad_camara || null
    ]);

    await client.query('COMMIT');

    logger.info(`Entrada a cámara registrada — masa ${masaId}, producto ${productoId}, por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Entrada a cámara registrada correctamente',
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
 * Registrar salida de cámara de una línea (producto) de fermentación.
 * Calcula y guarda el tiempo real de fermentación de esa línea.
 * POST /api/fermentacion/:masaId/camara/salida/:productoId
 */
exports.registrarSalidaCamara = async (req, res) => {
  const client = await db.getClient();

  try {
    const { masaId, productoId } = req.params;
    const { hora_salida_real } = req.body;

    const usuario = req.user;

    await client.query('BEGIN');

    const registroResult = await client.query(
      `SELECT id FROM registros_fermentacion WHERE masa_id = $1 ORDER BY fecha_registro DESC LIMIT 1`,
      [masaId]
    );
    if (registroResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No hay una fermentación iniciada para esta masa'
      });
    }
    const registroFermentacionId = registroResult.rows[0].id;

    const detalleResult = await client.query(
      `SELECT id, hora_entrada_camara FROM fermentacion_detalles
       WHERE registro_fermentacion_id = $1 AND producto_masa_id = $2`,
      [registroFermentacionId, productoId]
    );
    if (detalleResult.rows.length === 0 || !detalleResult.rows[0].hora_entrada_camara) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Debe registrar la entrada de esta línea antes de registrar la salida'
      });
    }

    const updateQuery = `
      UPDATE fermentacion_detalles
      SET
        hora_salida_camara = COALESCE($2::timestamptz, NOW()),
        tiempo_fermentacion_minutos = ROUND(
          EXTRACT(EPOCH FROM (COALESCE($2::timestamptz, NOW()) - hora_entrada_camara)) / 60
        ),
        fecha_actualizacion = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await client.query(updateQuery, [
      detalleResult.rows[0].id,
      hora_salida_real || null
    ]);

    await client.query('COMMIT');

    logger.info(`Salida de cámara registrada — masa ${masaId}, producto ${productoId}, por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Salida de cámara registrada correctamente',
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
 * Completar fermentación — exige que todas las líneas tengan salida
 * de cámara registrada. Desbloquea HORNEADO.
 * POST /api/fermentacion/:masaId/completar
 */
exports.completarFermentacion = async (req, res) => {
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
        message: `No se puede completar FERMENTACION: hay ${ajustesPendientes.length} ajuste(s) de pesaje pendientes de transmitir a SAP. Ve a Pesaje y confirma los ajustes antes de continuar.`,
        data: { ajustes_pendientes: ajustesPendientes },
      });
    }

    await client.query('BEGIN');

    const registroResult = await client.query(
      `SELECT id FROM registros_fermentacion WHERE masa_id = $1 ORDER BY fecha_registro DESC LIMIT 1`,
      [masaId]
    );
    if (registroResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'No se encontró una fermentación iniciada para esta masa'
      });
    }
    const registroFermentacionId = registroResult.rows[0].id;

    // Todas las líneas (todos los productos de la masa) deben tener salida registrada
    const pendientesR = await client.query(
      `SELECT ppm.producto_nombre
       FROM productos_por_masa ppm
       LEFT JOIN fermentacion_detalles fd
         ON fd.producto_masa_id = ppm.id AND fd.registro_fermentacion_id = $2
       WHERE ppm.masa_id = $1 AND fd.hora_salida_camara IS NULL`,
      [masaId, registroFermentacionId]
    );
    if (pendientesR.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Faltan líneas por sacar de cámara: ${pendientesR.rows.map(p => p.producto_nombre).join(', ')}`,
      });
    }

    const updateHeaderQuery = `
      UPDATE registros_fermentacion
      SET observaciones = COALESCE($2, observaciones)
      WHERE id = $1
    `;
    await client.query(updateHeaderQuery, [registroFermentacionId, observaciones || null]);

    const updateFaseQuery = `
      UPDATE progreso_fases
      SET
        estado = 'COMPLETADA',
        porcentaje_completado = 100,
        fecha_completado = NOW(),
        observaciones = $2
      WHERE masa_id = $1 AND fase = 'FERMENTACION'
    `;
    await client.query(updateFaseQuery, [masaId, observaciones || null]);

    await client.query('COMMIT');

    // Desbloquear fase HORNEADO usando el modelo estándar (mismo patrón que
    // completarFormado — corrige el no-op que tenía este controller antes)
    const fasesModel = require('../models/fases.model');
    await fasesModel.desbloquearSiguienteFase(masaId, 'FERMENTACION');

    logger.info(`Fermentación completada para masa ${masaId} por usuario ${usuario.username}`);

    res.json({
      success: true,
      message: 'Fermentación completada. Puede proceder a HORNEADO'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error al completar fermentación:', error);
    res.status(500).json({
      success: false,
      message: 'Error al completar fermentación',
      error: error.message
    });
  } finally {
    client.release();
  }
};
