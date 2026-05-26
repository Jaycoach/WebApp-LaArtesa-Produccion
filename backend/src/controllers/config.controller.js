/**
 * config.controller.js — ARTESA
 * Configuración del sistema: factor absorción, correos, costos agua,
 * tipos de mano de obra, costos indirectos, etiquetas, precios empaque SAP.
 */
const fasesModel = require('../models/fases.model');
const db = require('../database/connection');
const logger = require('../utils/logger');

// ── helpers ──────────────────────────────────────────────────────────────────
const getConfig = async (clave) => {
  const r = await db.query(
    `SELECT valor FROM configuracion_sistema WHERE clave = $1`, [clave]
  );
  return r.rows[0]?.valor ?? null;
};
const setConfig = async (clave, valor, usuarioId) => {
  await db.query(
    `INSERT INTO configuracion_sistema (clave, valor, actualizado_por)
     VALUES ($1, $2, $3)
     ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado_por = $3, fecha_actualizacion = NOW()`,
    [clave, String(valor), usuarioId]
  );
};

// ── FACTOR ABSORCIÓN ─────────────────────────────────────────────────────────
exports.getFactorAbsorcion = async (req, res, next) => {
  try {
    const config = await fasesModel.getFactorAbsorcion();
    if (!config) return res.status(404).json({ success: false, message: 'Configuración no encontrada' });
    res.json({ success: true, data: { factor: parseFloat(config.valor), updated_at: config.updated_at } });
  } catch (e) { next(e); }
};

exports.updateFactorAbsorcion = async (req, res, next) => {
  try {
    const { factorAbsorcion } = req.body;
    if (!factorAbsorcion || factorAbsorcion <= 0)
      return res.status(400).json({ success: false, message: 'Factor de absorción inválido' });
    const config = await fasesModel.updateFactorAbsorcion(factorAbsorcion, req.user.id);
    res.json({ success: true, data: { factor: parseFloat(config.valor) }, message: 'Factor actualizado' });
  } catch (e) { next(e); }
};

// ── CORREOS ──────────────────────────────────────────────────────────────────
exports.getCorreos = async (req, res, next) => {
  try {
    const valor = await getConfig('correos_empaque');
    res.json({ success: true, data: { correos: valor || '' } });
  } catch (e) { next(e); }
};

exports.updateCorreos = async (req, res, next) => {
  try {
    const { correos } = req.body;
    await setConfig('correos_empaque', correos, req.user.id);
    res.json({ success: true, message: 'Correos actualizados', data: { correos } });
  } catch (e) { next(e); }
};

// ── COSTOS AGUA ──────────────────────────────────────────────────────────────
exports.getCostoAgua = async (req, res, next) => {
  try {
    const valor = await getConfig('costo_agua_litro');
    res.json({ success: true, data: { costo: parseFloat(valor || '0') } });
  } catch (e) { next(e); }
};
exports.updateCostoAgua = async (req, res, next) => {
  try {
    const { costo } = req.body;
    if (costo === undefined || costo === null || isNaN(parseFloat(costo)) || parseFloat(costo) < 0)
      return res.status(400).json({ success: false, message: 'Costo inválido. Debe ser un número >= 0' });
    await setConfig('costo_agua_litro', parseFloat(costo), req.user.id);
    res.json({ success: true, message: 'Costo agua actualizado' });
  } catch (e) { next(e); }
};
exports.getCostoAgua2 = async (req, res, next) => {
  try {
    const valor = await getConfig('costo_agua2_litro');
    res.json({ success: true, data: { costo: parseFloat(valor || '0') } });
  } catch (e) { next(e); }
};
exports.updateCostoAgua2 = async (req, res, next) => {
  try {
    const { costo } = req.body;
    if (costo === undefined || costo === null || isNaN(parseFloat(costo)) || parseFloat(costo) < 0)
      return res.status(400).json({ success: false, message: 'Costo inválido. Debe ser un número >= 0' });
    await setConfig('costo_agua2_litro', parseFloat(costo), req.user.id);
    res.json({ success: true, message: 'Costo agua 2 actualizado' });
  } catch (e) { next(e); }
};

// ── COSTOS INDIRECTOS ────────────────────────────────────────────────────────
exports.getCostosIndirectos = async (req, res, next) => {
  try {
    const [ind, dep] = await Promise.all([
      getConfig('costo_indirecto_por_kg'),
      getConfig('costo_depreciacion_por_kg'),
    ]);
    res.json({ success: true, data: {
      costo_indirecto_por_kg:    parseFloat(ind || '0'),
      costo_depreciacion_por_kg: parseFloat(dep || '0'),
    }});
  } catch (e) { next(e); }
};
exports.updateCostosIndirectos = async (req, res, next) => {
  try {
    const { costo_indirecto_por_kg, costo_depreciacion_por_kg } = req.body;
    if (costo_indirecto_por_kg !== undefined)
      await setConfig('costo_indirecto_por_kg', costo_indirecto_por_kg, req.user.id);
    if (costo_depreciacion_por_kg !== undefined)
      await setConfig('costo_depreciacion_por_kg', costo_depreciacion_por_kg, req.user.id);
    res.json({ success: true, message: 'Costos indirectos actualizados' });
  } catch (e) { next(e); }
};

// ── TIPOS MANO DE OBRA ───────────────────────────────────────────────────────
exports.getTiposMO = async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id, nombre, descripcion, costo_hora, activo
       FROM tipos_mano_obra WHERE activo = true ORDER BY nombre`
    );
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

exports.createTipoMO = async (req, res, next) => {
  try {
    const { nombre, descripcion, costo_hora } = req.body;
    if (!nombre || costo_hora === undefined)
      return res.status(400).json({ success: false, message: 'nombre y costo_hora son requeridos' });
    const r = await db.query(
      `INSERT INTO tipos_mano_obra (nombre, descripcion, costo_hora)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre, descripcion || null, costo_hora]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.updateTipoMO = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, costo_hora, activo } = req.body;
    const r = await db.query(
      `UPDATE tipos_mano_obra
       SET nombre = COALESCE($2, nombre),
           descripcion = COALESCE($3, descripcion),
           costo_hora = COALESCE($4, costo_hora),
           activo = COALESCE($5, activo),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, nombre, descripcion, costo_hora, activo]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'No encontrado' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

exports.deleteTipoMO = async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE tipos_mano_obra SET activo = false WHERE id = $1`, [id]);
    res.json({ success: true, message: 'Tipo de MO desactivado' });
  } catch (e) { next(e); }
};

// ── REGISTROS MANO DE OBRA ───────────────────────────────────────────────────
exports.getRegistrosMO = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const r = await db.query(
      `SELECT rmo.id, rmo.fase, rmo.horas, rmo.costo_calculado, rmo.observaciones,
              rmo.created_at, tmo.nombre AS tipo_nombre, tmo.costo_hora,
              u.nombre_completo AS usuario_nombre
       FROM registros_mano_obra rmo
       JOIN tipos_mano_obra tmo ON tmo.id = rmo.tipo_mo_id
       LEFT JOIN usuarios u ON u.id = rmo.usuario_id
       WHERE rmo.masa_id = $1
       ORDER BY rmo.created_at`,
      [masaId]
    );
    const total = r.rows.reduce((s, x) => s + parseFloat(x.costo_calculado), 0);
    res.json({ success: true, data: { registros: r.rows, total_mo: total } });
  } catch (e) { next(e); }
};

exports.createRegistroMO = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const { fase, tipo_mo_id, horas, observaciones } = req.body;
    if (!fase || !tipo_mo_id || !horas)
      return res.status(400).json({ success: false, message: 'fase, tipo_mo_id y horas son requeridos' });

    const tipoR = await db.query(
      `SELECT costo_hora FROM tipos_mano_obra WHERE id = $1 AND activo = true`, [tipo_mo_id]
    );
    if (!tipoR.rows.length)
      return res.status(404).json({ success: false, message: 'Tipo de MO no encontrado' });

    const costo = parseFloat(tipoR.rows[0].costo_hora) * parseFloat(horas);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `INSERT INTO registros_mano_obra (masa_id, fase, tipo_mo_id, horas, costo_calculado, observaciones, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [masaId, fase.toUpperCase(), tipo_mo_id, horas, costo, observaciones || null, req.user.id]
      );
      await client.query(
        `UPDATE masas_produccion
         SET costo_mo_total = COALESCE(costo_mo_total, 0) + $2
         WHERE id = $1`,
        [masaId, costo]
      );
      await client.query('COMMIT');
      res.status(201).json({ success: true, data: r.rows[0], costo_calculado: costo });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (e) { next(e); }
};

exports.deleteRegistroMO = async (req, res, next) => {
  try {
    const { masaId, registroId } = req.params;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `DELETE FROM registros_mano_obra WHERE id = $1 AND masa_id = $2 RETURNING costo_calculado`,
        [registroId, masaId]
      );
      if (!r.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'No encontrado' });
      }
      await client.query(
        `UPDATE masas_produccion SET costo_mo_total = GREATEST(0, COALESCE(costo_mo_total, 0) - $2) WHERE id = $1`,
        [masaId, r.rows[0].costo_calculado]
      );
      await client.query('COMMIT');
      res.json({ success: true, message: 'Registro eliminado' });
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (e) { next(e); }
};

// ── CONFIGURACIÓN ETIQUETAS ──────────────────────────────────────────────────
exports.getEtiquetas = async (req, res, next) => {
  try {
    const r = await db.query(`SELECT * FROM configuracion_etiqueta ORDER BY nombre_producto`);
    res.json({ success: true, data: r.rows });
  } catch (e) { next(e); }
};

exports.upsertEtiqueta = async (req, res, next) => {
  try {
    const {
      sap_item_code, nombre_producto, ingredientes_txt,
      alergenos_txt, condiciones_txt, registro_invima,
      peso_neto_txt, fabricante_txt
    } = req.body;
    if (!sap_item_code || !nombre_producto)
      return res.status(400).json({ success: false, message: 'sap_item_code y nombre_producto son requeridos' });
    const r = await db.query(
      `INSERT INTO configuracion_etiqueta
         (sap_item_code, nombre_producto, ingredientes_txt, alergenos_txt,
          condiciones_txt, registro_invima, peso_neto_txt, fabricante_txt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (sap_item_code) DO UPDATE SET
         nombre_producto  = EXCLUDED.nombre_producto,
         ingredientes_txt = EXCLUDED.ingredientes_txt,
         alergenos_txt    = EXCLUDED.alergenos_txt,
         condiciones_txt  = EXCLUDED.condiciones_txt,
         registro_invima  = EXCLUDED.registro_invima,
         peso_neto_txt    = EXCLUDED.peso_neto_txt,
         fabricante_txt   = EXCLUDED.fabricante_txt,
         updated_at       = NOW()
       RETURNING *`,
      [sap_item_code, nombre_producto, ingredientes_txt, alergenos_txt,
       condiciones_txt, registro_invima, peso_neto_txt, fabricante_txt]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
};

// ── SYNC PRECIOS EMPAQUE DESDE SAP ───────────────────────────────────────────
exports.syncPreciosEmpaque = async (req, res, next) => {
  try {
    const itemsR = await db.query(
      `SELECT DISTINCT item_code_comp FROM sap_bom_componentes WHERE es_empaque = true`
    );
    const items = itemsR.rows.map(r => r.item_code_comp);
    if (!items.length)
      return res.json({ success: true, message: 'No hay items de empaque en BOM', actualizados: 0 });

    const sapService = require('../services/sap.service');
    await sapService.ensureSession();

    let actualizados = 0;
    const errores = [];

    for (const itemCode of items) {
      try {
        const resp = await sapService.client.get(
          `/Items('${itemCode}')?$select=ItemCode,ItemName,ItemsGroupCode,ItemWarehouseInfoCollection`
        );
        const item = resp.data;
        const warehouseInfo = (item.ItemWarehouseInfoCollection || [])
          .find(w => w.WarehouseCode === 'ALEMP') ||
          (item.ItemWarehouseInfoCollection || [])
          .find(w => w.WarehouseCode === 'ALMP');
        const precio = parseFloat(warehouseInfo?.StandardAveragePrice || 0);
        const stock  = parseFloat(warehouseInfo?.InStock || 0);

        await db.query(
          `INSERT INTO sap_inventario_mp (item_code, item_name, manage_batch_numbers, stock_almp, costo_unitario, ultimo_sync)
           VALUES ($1, $2, false, $3, $4, NOW())
           ON CONFLICT (item_code) DO UPDATE SET
             item_name      = EXCLUDED.item_name,
             stock_almp     = $3,
             costo_unitario = $4,
             ultimo_sync    = NOW()`,
          [itemCode, item.ItemName, stock, precio]
        );
        actualizados++;
      } catch (err) {
        errores.push({ itemCode, error: err.message });
        logger.warn(`syncPreciosEmpaque: error en ${itemCode}: ${err.message}`);
      }
    }

    logger.info(`syncPreciosEmpaque: ${actualizados}/${items.length} items actualizados`);
    res.json({
      success: true,
      message: `${actualizados} items de empaque sincronizados desde SAP`,
      actualizados,
      errores: errores.length ? errores : undefined,
    });
  } catch (e) { next(e); }
};

exports.getCatalogoTiposMasa = async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, codigo_sap, tipo_masa, nombre_masa,
              unidades_pan_por_paquete, dias_vida_util, activo
       FROM catalogo_tipos_masa
       WHERE activo = true
       ORDER BY tipo_masa, nombre_masa`
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    logger.error('Error getCatalogoTiposMasa:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateCatalogoTiposMasa = async (req, res) => {
  try {
    const { id } = req.params;
    const { unidades_pan_por_paquete, dias_vida_util } = req.body;

    if (unidades_pan_por_paquete !== undefined && Number(unidades_pan_por_paquete) < 1)
      return res.status(400).json({ success: false, message: 'unidades_pan_por_paquete debe ser >= 1' });
    if (dias_vida_util !== undefined && Number(dias_vida_util) < 1)
      return res.status(400).json({ success: false, message: 'dias_vida_util debe ser >= 1' });

    const r = await db.query(
      `UPDATE catalogo_tipos_masa
       SET unidades_pan_por_paquete = COALESCE($2, unidades_pan_por_paquete),
           dias_vida_util           = COALESCE($3, dias_vida_util),
           fecha_actualizacion      = NOW()
       WHERE id = $1
       RETURNING id, codigo_sap, tipo_masa, nombre_masa,
                 unidades_pan_por_paquete, dias_vida_util`,
      [id, unidades_pan_por_paquete ?? null, dias_vida_util ?? null]
    );

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Tipo de masa no encontrado' });

    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    logger.error('Error updateCatalogoTiposMasa:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};
