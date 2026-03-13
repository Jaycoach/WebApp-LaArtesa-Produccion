/**
 * empaque.controller.js — ARTESA
 * Módulo de empaque con:
 * - Vista consolidada por OV (todas las sub-masas juntas)
 * - Costeo final completo (MP + MO + empaque + indirecto)
 * - Salida SAP de materiales de empaque (GoodsIssues)
 * - Datos para etiqueta INVIMA
 */
const db = require('../database/connection');
const logger = require('../utils/logger');

// ── helper: obtener config ───────────────────────────────────────────────────
const getCfg = async (clave) => {
  const r = await db.query(`SELECT valor FROM configuracion_sistema WHERE clave = $1`, [clave]);
  return parseFloat(r.rows[0]?.valor || '0');
};

// ── GET /api/empaque/ov/:docNum ──────────────────────────────────────────────
// Vista consolidada por número de OV SAP
exports.getEmpaqueByOV = async (req, res) => {
  try {
    const { docNum } = req.params;

    // 1. Encontrar masas padre que tengan productos de esta OV
    const masaR = await db.query(
      `SELECT DISTINCT mp.id, mp.codigo_masa, mp.tipo_masa, mp.nombre_masa,
              mp.estado, mp.fase_actual, mp.fue_subdividida,
              mp.fecha_produccion, mp.total_kilos_con_merma
       FROM masas_produccion mp
       JOIN productos_por_masa ppm ON ppm.masa_id = mp.id
       WHERE ppm.sap_doc_num = $1
         AND (mp.fue_subdividida = true OR mp.es_subdivision = false)
       ORDER BY mp.id`,
      [docNum]
    );

    if (!masaR.rows.length)
      return res.status(404).json({ success: false, message: `OV ${docNum} no encontrada` });

    const resultadoOVs = [];

    for (const masaPadre of masaR.rows) {
      // 2. Obtener sub-masas (o la masa misma si no fue subdividida)
      const subMasasR = await db.query(
        `SELECT mp.id, mp.codigo_masa, mp.tipo_masa, mp.total_kilos_con_merma,
                mp.costo_mo_total,
                pf_h.estado AS estado_horneado,
                pf_e.estado AS estado_empaque
         FROM masas_produccion mp
         LEFT JOIN progreso_fases pf_h ON pf_h.masa_id = mp.id AND pf_h.fase = 'HORNEADO'
         LEFT JOIN progreso_fases pf_e ON pf_e.masa_id = mp.id AND pf_e.fase = 'EMPAQUE'
         WHERE (mp.id = $1 OR mp.masa_padre_id = $1)
           AND mp.estado != 'SUBDIVIDIDA'
         ORDER BY mp.codigo_masa`,
        [masaPadre.id]
      );

      const subMasas = subMasasR.rows;
      const todasHorneadas = subMasas.every(s => s.estado_horneado === 'COMPLETADA');
      const totalKg = subMasas.reduce((s, m) => s + parseFloat(m.total_kilos_con_merma || 0), 0);

      // 3. Productos de esta OV
      const productosR = await db.query(
        `SELECT ppm.id, ppm.masa_id, ppm.sap_item_code, ppm.producto_nombre,
                ppm.presentacion, ppm.gramaje_unitario,
                ppm.unidades_pedidas, ppm.unidades_programadas,
                COALESCE(ppm.unidades_ajustadas, ppm.unidades_programadas) AS unidades_ajustadas,
                COALESCE(ppm.unidades_producidas, 0) AS unidades_producidas,
                COALESCE(ppm.unidades_faltantes, 0) AS unidades_faltantes,
                ppm.costo_mp_total_prod,
                ppm.costo_mo_total, ppm.costo_empaque_total,
                ppm.costo_indirecto_total, ppm.costo_total_final, ppm.costo_unitario_final,
                ppm.sap_doc_num,
                ed.id AS detalle_id, ed.unidades_empacadas, ed.unidades_merma,
                re.id AS empaque_id, re.estado AS empaque_estado, re.fecha_vencimiento
         FROM productos_por_masa ppm
         LEFT JOIN registros_empaque re ON re.masa_id = ppm.masa_id
         LEFT JOIN empaque_detalles ed ON ed.empaque_id = re.id AND ed.producto_masa_id = ppm.id
         WHERE ppm.sap_doc_num = $1
           AND (ppm.masa_id = $2 OR ppm.masa_id IN (
             SELECT id FROM masas_produccion WHERE masa_padre_id = $2 AND estado != 'SUBDIVIDIDA'
           ))
         ORDER BY ppm.masa_id, ppm.producto_nombre`,
        [docNum, masaPadre.id]
      );

      // 4. Materiales de empaque del BOM
      const itemCodes = [...new Set(productosR.rows.map(p => p.sap_item_code).filter(Boolean))];
      let materialesEmpaque = [];
      if (itemCodes.length) {
        const matR = await db.query(
          `SELECT sbc.item_code_padre, sbc.item_code_comp, sbc.item_name_comp,
                  sbc.cantidad AS cantidad_por_unidad, sbc.uom,
                  COALESCE(sim.costo_unitario, 0) AS precio_unitario,
                  COALESCE(sim.stock_almp, 0) AS stock_disponible
           FROM sap_bom_componentes sbc
           LEFT JOIN sap_inventario_mp sim ON sim.item_code = sbc.item_code_comp
           WHERE sbc.item_code_padre = ANY($1) AND sbc.es_empaque = true
           ORDER BY sbc.item_code_padre, sbc.item_code_comp`,
          [itemCodes]
        );
        materialesEmpaque = matR.rows;
      }

      // 5. Costo MO total de todas las sub-masas
      const moR = await db.query(
        `SELECT COALESCE(SUM(costo_calculado),0) AS total
         FROM registros_mano_obra
         WHERE masa_id = ANY($1)`,
        [subMasas.map(s => s.id)]
      );
      const costoMOTotal = parseFloat(moR.rows[0].total);

      // 6. Calcular costo empaque estimado
      let costoEmpaqueEstimado = 0;
      for (const prod of productosR.rows) {
        const mats = materialesEmpaque.filter(m => m.item_code_padre === prod.sap_item_code);
        for (const mat of mats) {
          costoEmpaqueEstimado +=
            parseFloat(mat.cantidad_por_unidad) *
            parseFloat(mat.precio_unitario) *
            parseInt(prod.unidades_ajustadas || 0);
        }
      }

      // 7. Costo indirecto estimado
      const costoIndPorKg = await getCfg('costo_indirecto_por_kg');
      const costoDepPorKg = await getCfg('costo_depreciacion_por_kg');
      const costoIndirectoEstimado = (costoIndPorKg + costoDepPorKg) * totalKg;

      // 8. Costo MP total consolidado
      const costoMPTotal = productosR.rows.reduce(
        (s, p) => s + parseFloat(p.costo_mp_total_prod || 0), 0
      );

      resultadoOVs.push({
        masa_padre: {
          id: masaPadre.id,
          codigo: masaPadre.codigo_masa,
          tipo: masaPadre.tipo_masa,
          fecha_produccion: masaPadre.fecha_produccion,
          total_kg: totalKg,
        },
        sub_masas: subMasas,
        todas_horneadas: todasHorneadas,
        productos: productosR.rows,
        materiales_empaque: materialesEmpaque,
        resumen_costos: {
          costo_mp:        costoMPTotal,
          costo_mo:        costoMOTotal,
          costo_empaque:   costoEmpaqueEstimado,
          costo_indirecto: costoIndirectoEstimado,
          costo_total:     costoMPTotal + costoMOTotal + costoEmpaqueEstimado + costoIndirectoEstimado,
        },
      });
    }

    res.json({ success: true, data: resultadoOVs, doc_num: docNum });
  } catch (error) {
    logger.error('Error getEmpaqueByOV:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/empaque/:masaId ─────────────────────────────────────────────────
// Compatibilidad con flujo anterior
exports.getEmpaqueInfo = async (req, res) => {
  try {
    const { masaId } = req.params;
    const masaR = await db.query(
      `SELECT mp.id, mp.uuid, mp.codigo_masa, mp.tipo_masa, mp.nombre_masa,
              mp.estado, mp.fase_actual, mp.lote_produccion, mp.fecha_produccion
       FROM masas_produccion mp WHERE mp.id = $1`,
      [masaId]
    );
    if (!masaR.rows.length)
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });

    const productosR = await db.query(
      `SELECT id, sap_item_code, producto_codigo, producto_nombre, presentacion,
              gramaje_unitario, unidades_pedidas,
              COALESCE(unidades_ajustadas, unidades_programadas) AS unidades_ajustadas,
              COALESCE(unidades_producidas, 0) AS unidades_producidas,
              COALESCE(unidades_excedente, 0) AS unidades_excedente,
              sap_doc_entry, sap_doc_num,
              COALESCE(unidades_por_paquete, 1) AS unidades_por_paquete,
              costo_mp_total_prod, costo_unitario_final
       FROM productos_por_masa WHERE masa_id = $1 ORDER BY producto_nombre`,
      [masaId]
    );

    const registroR = await db.query(
      `SELECT id, fecha_vencimiento, estado FROM registros_empaque WHERE masa_id = $1 LIMIT 1`,
      [masaId]
    );

    res.json({ success: true, data: {
      masa: masaR.rows[0],
      productos: productosR.rows,
      registro_empaque: registroR.rows[0] || null,
    }});
  } catch (error) {
    logger.error('Error getEmpaqueInfo:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/empaque/:masaId/iniciar ────────────────────────────────────────
exports.iniciarEmpaque = async (req, res) => {
  const client = await db.getClient();
  try {
    const { masaId } = req.params;
    const { fecha_vencimiento, observaciones } = req.body;

    if (!fecha_vencimiento)
      return res.status(400).json({ success: false, message: 'Fecha de vencimiento requerida' });

    await client.query('BEGIN');

    // Verificar HORNEADO completado
    const faseR = await client.query(
      `SELECT estado FROM progreso_fases WHERE masa_id = $1 AND fase = 'HORNEADO'`, [masaId]
    );
    if (!faseR.rows.length || faseR.rows[0].estado !== 'COMPLETADA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Debe completar HORNEADO antes de iniciar EMPAQUE' });
    }

    // No duplicar
    const existeR = await client.query(
      `SELECT id FROM registros_empaque WHERE masa_id = $1`, [masaId]
    );
    if (existeR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Ya existe un registro de empaque' });
    }

    const empR = await client.query(
      `INSERT INTO registros_empaque (masa_id, fecha_vencimiento, estado, usuario_id, usuario_nombre, observaciones)
       VALUES ($1, $2, 'EN_PROGRESO', $3, $4, $5) RETURNING *`,
      [masaId, fecha_vencimiento, req.user.id, req.user.nombre_completo, observaciones || null]
    );
    const empaqueId = empR.rows[0].id;

    // Crear detalles por producto
    const prodsR = await client.query(
      `SELECT id FROM productos_por_masa WHERE masa_id = $1`, [masaId]
    );
    for (const p of prodsR.rows) {
      await client.query(
        `INSERT INTO empaque_detalles (empaque_id, producto_masa_id, sub_masa_id, unidades_empacadas, unidades_merma)
         VALUES ($1, $2, $3, 0, 0) ON CONFLICT DO NOTHING`,
        [empaqueId, p.id, masaId]
      );
    }

    await client.query(
      `UPDATE progreso_fases SET estado = 'EN_PROGRESO', fecha_actualizacion = NOW()
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [masaId]
    );
    await client.query(
      `UPDATE masas_produccion SET fase_actual = 'EMPAQUE' WHERE id = $1`, [masaId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Empaque iniciado', data: empR.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error iniciarEmpaque:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally { client.release(); }
};

// ── PATCH /api/empaque/:masaId/detalle/:productoId ───────────────────────────
exports.actualizarDetalle = async (req, res) => {
  try {
    const { masaId, productoId } = req.params;
    const { unidades_empacadas, unidades_merma } = req.body;

    const empR = await db.query(
      `SELECT id FROM registros_empaque WHERE masa_id = $1 AND estado = 'EN_PROGRESO'`, [masaId]
    );
    if (!empR.rows.length)
      return res.status(400).json({ success: false, message: 'No hay empaque en progreso' });

    const r = await db.query(
      `UPDATE empaque_detalles
       SET unidades_empacadas = COALESCE($3, unidades_empacadas),
           unidades_merma     = COALESCE($4, unidades_merma),
           fecha_actualizacion = NOW()
       WHERE empaque_id = $1 AND producto_masa_id = $2
       RETURNING *`,
      [empR.rows[0].id, productoId,
       unidades_empacadas ?? null, unidades_merma ?? null]
    );

    // Actualizar unidades_producidas en productos_por_masa
    if (unidades_empacadas !== undefined) {
      await db.query(
        `UPDATE productos_por_masa SET unidades_producidas = $1 WHERE id = $2`,
        [unidades_empacadas, productoId]
      );
    }

    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    logger.error('Error actualizarDetalle:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── POST /api/empaque/:masaId/completar ──────────────────────────────────────
exports.completarEmpaque = async (req, res) => {
  const client = await db.getClient();
  try {
    const { masaId } = req.params;
    const { observaciones } = req.body;

    await client.query('BEGIN');

    const empR = await client.query(
      `SELECT id FROM registros_empaque WHERE masa_id = $1 AND estado = 'EN_PROGRESO'`, [masaId]
    );
    if (!empR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No hay empaque en progreso' });
    }
    const empaqueId = empR.rows[0].id;

    // 1. Productos y unidades empacadas
    const prodsR = await client.query(
      `SELECT ppm.id, ppm.sap_item_code, ppm.gramaje_unitario,
              COALESCE(ed.unidades_empacadas, 0) AS uds_empacadas
       FROM productos_por_masa ppm
       LEFT JOIN empaque_detalles ed ON ed.empaque_id = $2 AND ed.producto_masa_id = ppm.id
       WHERE ppm.masa_id = $1`,
      [masaId, empaqueId]
    );

    // 2. Kg producidos reales
    const totalUdsProducidas = prodsR.rows.reduce((s, p) => s + parseInt(p.uds_empacadas), 0);
    const totalKgProducidos = prodsR.rows.reduce(
      (s, p) => s + (parseInt(p.uds_empacadas) * parseFloat(p.gramaje_unitario) / 1000), 0
    );

    // 3. Costo MO total (esta masa + sub-masas)
    const masaInfoR = await client.query(
      `SELECT id FROM masas_produccion WHERE id = $1 OR masa_padre_id = $1`, [masaId]
    );
    const masaIds = masaInfoR.rows.map(r => r.id);
    const moR = await client.query(
      `SELECT COALESCE(SUM(costo_calculado),0) AS total
       FROM registros_mano_obra WHERE masa_id = ANY($1)`,
      [masaIds]
    );
    const costoMOTotal = parseFloat(moR.rows[0].total);

    // 4. Costo MP total
    const mpR = await client.query(
      `SELECT COALESCE(SUM(costo_mp_total_prod),0) AS total
       FROM productos_por_masa WHERE masa_id = ANY($1)`,
      [masaIds]
    );
    const costoMPTotal = parseFloat(mpR.rows[0].total);

    // 5. Costo empaque: BOM × precio SAP × unidades empacadas
    let costoEmpaqueTotal = 0;
    for (const prod of prodsR.rows) {
      if (!prod.sap_item_code || !prod.uds_empacadas) continue;
      const matsR = await client.query(
        `SELECT sbc.cantidad, COALESCE(sim.costo_unitario, 0) AS precio
         FROM sap_bom_componentes sbc
         LEFT JOIN sap_inventario_mp sim ON sim.item_code = sbc.item_code_comp
         WHERE sbc.item_code_padre = $1 AND sbc.es_empaque = true`,
        [prod.sap_item_code]
      );
      for (const mat of matsR.rows) {
        costoEmpaqueTotal +=
          parseFloat(mat.cantidad) * parseFloat(mat.precio) * parseInt(prod.uds_empacadas);
      }
    }

    // 6. Costo indirecto
    const costoIndPorKg = await getCfg('costo_indirecto_por_kg');
    const costoDepPorKg = await getCfg('costo_depreciacion_por_kg');
    const costoIndirectoTotal = (costoIndPorKg + costoDepPorKg) * totalKgProducidos;

    // 7. Totales
    const costoTotalFinal = costoMPTotal + costoMOTotal + costoEmpaqueTotal + costoIndirectoTotal;
    const costoUnitarioFinal = totalUdsProducidas > 0
      ? costoTotalFinal / totalUdsProducidas : 0;

    // 8. Actualizar costos finales en productos_por_masa
    await client.query(
      `UPDATE productos_por_masa SET
         costo_mo_total        = $2,
         costo_empaque_total   = $3,
         costo_indirecto_total = $4,
         costo_total_final     = $5,
         costo_unitario_final  = $6
       WHERE masa_id = $1`,
      [masaId, costoMOTotal, costoEmpaqueTotal, costoIndirectoTotal,
       costoTotalFinal, costoUnitarioFinal]
    );

    // 9. Marcar empaque y fase completados
    await client.query(
      `UPDATE registros_empaque SET estado = 'COMPLETADO', fecha_completado = NOW(),
         observaciones = COALESCE($2, observaciones)
       WHERE id = $1`,
      [empaqueId, observaciones || null]
    );
    await client.query(
      `UPDATE progreso_fases SET estado = 'COMPLETADA', porcentaje_completado = 100,
         fecha_actualizacion = NOW()
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [masaId]
    );
    await client.query(
      `UPDATE masas_produccion SET estado = 'COMPLETADA', fase_actual = 'EMPAQUE'
       WHERE id = $1`,
      [masaId]
    );

    // 10. GoodsIssues SAP para materiales de empaque
    let sapResult = null;
    try {
      const sapService = require('../services/sap.service');
      await sapService.ensureSession();

      const docLines = [];
      for (const prod of prodsR.rows) {
        if (!prod.sap_item_code || !prod.uds_empacadas) continue;
        const matsR = await client.query(
          `SELECT sbc.item_code_comp, sbc.cantidad, sbc.uom
           FROM sap_bom_componentes sbc
           WHERE sbc.item_code_padre = $1 AND sbc.es_empaque = true`,
          [prod.sap_item_code]
        );
        for (const mat of matsR.rows) {
          const qty = parseFloat(mat.cantidad) * parseInt(prod.uds_empacadas);
          const existing = docLines.find(l => l.ItemCode === mat.item_code_comp);
          if (existing) { existing.Quantity += qty; }
          else {
            docLines.push({
              ItemCode:      mat.item_code_comp,
              Quantity:      qty,
              WarehouseCode: 'ALMP',
              AccountCode:   '14050501',
            });
          }
        }
      }

      if (docLines.length) {
        const sapResp = await sapService.client.post('/InventoryGenExits', {
          DocDate:       new Date().toISOString().split('T')[0],
          Comments:      `Consumo empaque masa ${masaId}`,
          DocumentLines: docLines,
        });
        sapResult = { doc_entry: sapResp.data.DocEntry, lineas: docLines.length };
        logger.info(`GoodsIssues empaque masa ${masaId}: DocEntry ${sapResp.data.DocEntry}`);
      }
    } catch (sapErr) {
      // SAP falla → loguear pero no revertir (el empaque ya está guardado)
      logger.error(`Error GoodsIssues empaque masa ${masaId}: ${sapErr.message}`);
      sapResult = { error: sapErr.message };
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Empaque completado. Producción finalizada.',
      data: {
        costos: {
          mp: costoMPTotal,
          mo: costoMOTotal,
          empaque: costoEmpaqueTotal,
          indirecto: costoIndirectoTotal,
          total: costoTotalFinal,
          unitario: costoUnitarioFinal,
        },
        sap: sapResult,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error completarEmpaque:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally { client.release(); }
};

// ── GET /api/empaque/pendientes ──────────────────────────────────────────────
// Lista todas las masas con HORNEADO completado y EMPAQUE no completado.
// Para sub-masas, hereda sap_doc_num/sap_doc_entry del producto equivalente
// en la masa padre (mismo sap_item_code).
exports.getMasasPendientesEmpaque = async (req, res) => {
  try {
    const masasR = await db.query(`
      SELECT mp.id, mp.codigo_masa, mp.nombre_masa, mp.tipo_masa,
             mp.total_kilos_con_merma, mp.fecha_produccion,
             mp.es_subdivision, mp.masa_padre_id,
             pf_e.estado AS estado_empaque
      FROM masas_produccion mp
      JOIN progreso_fases pf_h ON pf_h.masa_id = mp.id AND pf_h.fase = 'HORNEADO'
      JOIN progreso_fases pf_e ON pf_e.masa_id = mp.id AND pf_e.fase = 'EMPAQUE'
      WHERE pf_h.estado = 'COMPLETADA'
        AND pf_e.estado != 'COMPLETADA'
        AND mp.estado != 'SUBDIVIDIDA'
        AND mp.estado != 'CANCELADA'
      ORDER BY mp.fecha_produccion DESC, mp.id DESC
    `);

    if (!masasR.rows.length)
      return res.json({ success: true, data: [] });

    const resultado = [];

    for (const masa of masasR.rows) {
      const prodsR = await db.query(`
        SELECT ppm.id, ppm.sap_item_code, ppm.producto_nombre, ppm.presentacion,
               ppm.gramaje_unitario, ppm.unidades_pedidas,
               GREATEST(COALESCE(ppm.unidades_ajustadas, 0), COALESCE(ppm.unidades_programadas, 0)) AS unidades_ajustadas,
               COALESCE(ppm.unidades_producidas, 0) AS unidades_producidas,
               ppm.sap_doc_num, ppm.sap_doc_entry
        FROM productos_por_masa ppm
        WHERE ppm.masa_id = $1
        ORDER BY ppm.sap_doc_num, ppm.producto_nombre
      `, [masa.id]);

      let productos = prodsR.rows;

      // Para sub-masas: heredar sap_doc_num del padre por sap_item_code
      if (masa.es_subdivision && masa.masa_padre_id) {
        const padreProdsR = await db.query(`
          SELECT sap_item_code, sap_doc_num, sap_doc_entry
          FROM productos_por_masa
          WHERE masa_id = $1
        `, [masa.masa_padre_id]);

        const mapaDoc = {};
        for (const pp of padreProdsR.rows) {
          if (pp.sap_item_code) mapaDoc[pp.sap_item_code] = {
            sap_doc_num: pp.sap_doc_num,
            sap_doc_entry: pp.sap_doc_entry,
          };
        }

        productos = productos.map(p => ({
          ...p,
          sap_doc_num:   p.sap_doc_num   || mapaDoc[p.sap_item_code]?.sap_doc_num   || null,
          sap_doc_entry: p.sap_doc_entry || mapaDoc[p.sap_item_code]?.sap_doc_entry || null,
        }));
      }

      // Agrupar productos por OV
      const porOV = {};
      for (const p of productos) {
        const ov = p.sap_doc_num || 'SIN_OV';
        if (!porOV[ov]) porOV[ov] = [];
        porOV[ov].push(p);
      }

      const empR = await db.query(`
        SELECT id, estado, fecha_vencimiento
        FROM registros_empaque WHERE masa_id = $1 LIMIT 1
      `, [masa.id]);

      resultado.push({
        id:                    masa.id,
        codigo_masa:           masa.codigo_masa,
        nombre_masa:           masa.nombre_masa,
        tipo_masa:             masa.tipo_masa,
        total_kilos_con_merma: parseFloat(masa.total_kilos_con_merma || 0),
        fecha_produccion:      masa.fecha_produccion,
        es_subdivision:        masa.es_subdivision,
        estado_empaque:        masa.estado_empaque,
        empaque_iniciado:      empR.rows.length > 0,
        empaque_id:            empR.rows[0]?.id || null,
        fecha_vencimiento:     empR.rows[0]?.fecha_vencimiento || null,
        ovs: Object.entries(porOV).map(([doc_num, prods]) => ({
          doc_num,
          productos: prods,
        })),
      });
    }

    res.json({ success: true, data: resultado });
  } catch (error) {
    logger.error('Error getMasasPendientesEmpaque:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/empaque/:masaId/etiqueta/:productoId ────────────────────────────
exports.getEtiqueta = async (req, res) => {
  try {
    const { masaId, productoId } = req.params;

    const prodR = await db.query(
      `SELECT ppm.*, re.fecha_vencimiento
       FROM productos_por_masa ppm
       LEFT JOIN registros_empaque re ON re.masa_id = ppm.masa_id
       WHERE ppm.id = $1 AND ppm.masa_id = $2`,
      [productoId, masaId]
    );
    if (!prodR.rows.length)
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });

    const prod = prodR.rows[0];

    const etqR = await db.query(
      `SELECT * FROM configuracion_etiqueta WHERE sap_item_code = $1`,
      [prod.sap_item_code]
    );
    const etq = etqR.rows[0] || {};

    res.json({
      success: true,
      data: {
        sap_item_code:    prod.sap_item_code,
        nombre_producto:  etq.nombre_producto || prod.producto_nombre,
        presentacion:     prod.presentacion,
        gramaje_unitario: prod.gramaje_unitario,
        peso_neto_txt:    etq.peso_neto_txt || `${prod.gramaje_unitario}g`,
        ingredientes_txt: etq.ingredientes_txt || '',
        alergenos_txt:    etq.alergenos_txt || '',
        condiciones_txt:  etq.condiciones_txt || 'Mantener en lugar fresco y seco',
        registro_invima:  etq.registro_invima || '',
        fabricante_txt:   etq.fabricante_txt || 'La Artesa SAS – Bogotá, Colombia',
        fecha_vencimiento: prod.fecha_vencimiento,
        lote:             prod.sap_doc_num || '',
        costo_unitario_final: prod.costo_unitario_final,
      },
    });
  } catch (error) {
    logger.error('Error getEtiqueta:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
