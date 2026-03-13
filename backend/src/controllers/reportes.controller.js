/**
 * reportes.controller.js — ARTESA
 * Reporte detallado de costos de producción por fecha
 */
const db = require('../database/connection');
const logger = require('../utils/logger');

exports.getReporteCostos = async (req, res) => {
  try {
    const { fecha_desde, fecha_hasta, masa_id } = req.query;

    let whereClause = `WHERE mp.estado = 'COMPLETADA'`;
    const params = [];
    let pIdx = 1;

    if (fecha_desde) {
      whereClause += ` AND mp.fecha_produccion >= $${pIdx++}`;
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      whereClause += ` AND mp.fecha_produccion <= $${pIdx++}`;
      params.push(fecha_hasta);
    }
    if (masa_id) {
      whereClause += ` AND mp.id = $${pIdx++}`;
      params.push(masa_id);
    }

    const masasR = await db.query(`
      SELECT
        mp.id, mp.codigo_masa, mp.nombre_masa, mp.tipo_masa,
        mp.fecha_produccion, mp.total_kilos_con_merma,
        mp.es_subdivision, mp.masa_padre_id,
        cm.costo_mp_total, cm.costo_mo_total, cm.costo_cif_total,
        cm.costo_total_masa, cm.costo_por_kilo,
        cm.fecha_calculo_final
      FROM masas_produccion mp
      LEFT JOIN costos_masa cm ON cm.masa_id = mp.id
      ${whereClause}
      ORDER BY mp.fecha_produccion DESC, mp.id DESC
    `, params);

    if (!masasR.rows.length) return res.json({ success: true, data: [] });

    const resultado = [];

    for (const masa of masasR.rows) {
      const prodsR = await db.query(`
        SELECT
          ppm.id, ppm.sap_item_code, ppm.producto_nombre, ppm.presentacion,
          ppm.gramaje_unitario,
          ppm.unidades_pedidas, ppm.unidades_producidas,
          ppm.costo_mp_unitario, ppm.costo_mp_total_prod,
          ppm.costo_mo_total, ppm.costo_empaque_total,
          ppm.costo_indirecto_total, ppm.costo_total_final,
          ppm.costo_unitario_final,
          ppm.sap_doc_num, ppm.sap_doc_entry
        FROM productos_por_masa ppm
        WHERE ppm.masa_id = $1
        ORDER BY ppm.sap_doc_num, ppm.producto_nombre
      `, [masa.id]);

      let productos = prodsR.rows;
      if (masa.es_subdivision && masa.masa_padre_id) {
        const padreR = await db.query(`
          SELECT sap_item_code, sap_doc_num, sap_doc_entry
          FROM productos_por_masa WHERE masa_id = $1
        `, [masa.masa_padre_id]);
        const mapaDoc = {};
        for (const pp of padreR.rows) {
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

      const moR = await db.query(`
        SELECT rmo.fase, tmo.nombre AS tipo_nombre,
               rmo.horas, rmo.costo_calculado, rmo.observaciones
        FROM registros_mano_obra rmo
        JOIN tipos_mano_obra tmo ON tmo.id = rmo.tipo_mo_id
        WHERE rmo.masa_id = $1
        ORDER BY rmo.fase, rmo.id
      `, [masa.id]);

      const empR = await db.query(`
        SELECT estado, fecha_completado, fecha_vencimiento
        FROM registros_empaque WHERE masa_id = $1 LIMIT 1
      `, [masa.id]);

      resultado.push({
        id:               masa.id,
        codigo_masa:      masa.codigo_masa,
        nombre_masa:      masa.nombre_masa,
        tipo_masa:        masa.tipo_masa,
        fecha_produccion: masa.fecha_produccion,
        total_kilos:      parseFloat(masa.total_kilos_con_merma || 0),
        es_subdivision:   masa.es_subdivision,
        costos_resumen: {
          costo_mp:       parseFloat(masa.costo_mp_total  || 0),
          costo_mo:       parseFloat(masa.costo_mo_total  || 0),
          costo_cif:      parseFloat(masa.costo_cif_total || 0),
          costo_total:    parseFloat(masa.costo_total_masa || 0),
          costo_por_kilo: parseFloat(masa.costo_por_kilo  || 0),
        },
        mano_obra_detalle: moR.rows,
        empaque: empR.rows[0] || null,
        productos: productos.map(p => ({
          id:                  p.id,
          sap_item_code:       p.sap_item_code,
          producto_nombre:     p.producto_nombre,
          presentacion:        p.presentacion,
          gramaje_unitario:    p.gramaje_unitario,
          unidades_pedidas:    p.unidades_pedidas,
          unidades_producidas: p.unidades_producidas,
          sap_doc_num:         p.sap_doc_num,
          costos: {
            mp_unitario:     parseFloat(p.costo_mp_unitario     || 0),
            mp_total:        parseFloat(p.costo_mp_total_prod   || 0),
            mo_total:        parseFloat(p.costo_mo_total        || 0),
            empaque_total:   parseFloat(p.costo_empaque_total   || 0),
            indirecto_total: parseFloat(p.costo_indirecto_total || 0),
            total_final:     parseFloat(p.costo_total_final     || 0),
            unitario_final:  parseFloat(p.costo_unitario_final  || 0),
          },
        })),
      });
    }

    res.json({ success: true, data: resultado });
  } catch (error) {
    logger.error('Error getReporteCostos:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
