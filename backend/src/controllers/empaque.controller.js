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
                pf_e.estado AS estado_empaque,
                re.sap_doc_entry_entrada
         FROM masas_produccion mp
         LEFT JOIN progreso_fases pf_h ON pf_h.masa_id = mp.id AND pf_h.fase = 'HORNEADO'
         LEFT JOIN progreso_fases pf_e ON pf_e.masa_id = mp.id AND pf_e.fase = 'EMPAQUE'
         LEFT JOIN registros_empaque re ON re.masa_id = mp.id
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
              mp.estado, mp.fase_actual, mp.lote_produccion, mp.fecha_produccion,
              rh.fecha_vencimiento_sugerida,
              pf_e.estado AS estado_empaque,
              pf_e.datos_fase AS empaque_datos_fase
       FROM masas_produccion mp
       LEFT JOIN registros_horneado rh ON rh.masa_id = mp.id
       LEFT JOIN progreso_fases pf_e ON pf_e.masa_id = mp.id AND pf_e.fase = 'EMPAQUE'
       WHERE mp.id = $1
       ORDER BY rh.fecha_registro DESC
       LIMIT 1`,
      [masaId]
    );
    if (!masaR.rows.length)
      return res.status(404).json({ success: false, message: 'Masa no encontrada' });

    const productosR = await db.query(
      `SELECT id, sap_item_code, producto_codigo, producto_nombre, presentacion,
              gramaje_unitario, unidades_pedidas,
              COALESCE(unidades_ajustadas, unidades_programadas) AS unidades_ajustadas,
              COALESCE(unidades_producidas, 0) AS unidades_producidas,
              COALESCE(cantidad_divisiones, 0) AS cantidad_divisiones,
              COALESCE(unidades_excedente, 0) AS unidades_excedente,
              division_completada,
              sap_doc_entry, sap_doc_num,
              COALESCE(unidades_por_paquete, 1) AS unidades_por_paquete,
              COALESCE(unidades_pan_por_paquete, 1) AS unidades_pan_por_paquete,
              costo_mp_total_prod, costo_unitario_final, costo_pan_unitario
       FROM productos_por_masa WHERE masa_id = $1 ORDER BY producto_nombre`,
      [masaId]
    );

    // Heredar sap_doc_num del padre si es sub-masa y productos sin OV
    const masaInfo = masaR.rows[0];
    let productos = productosR.rows;
    const masaPadreR = await db.query(
      `SELECT masa_padre_id, es_subdivision FROM masas_produccion WHERE id = $1`, [masaId]
    );
    const { masa_padre_id, es_subdivision } = masaPadreR.rows[0] || {};
    if (es_subdivision && masa_padre_id) {
      const padreProdsR = await db.query(
        `SELECT sap_item_code, sap_doc_num, sap_doc_entry
         FROM productos_por_masa WHERE masa_id = $1`, [masa_padre_id]
      );
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

    // Leer unidades horneadas por producto directamente del registro — dato ingresado por el usuario
    const horneadoConProd = await db.query(
      `SELECT unidades_terminadas, unidades_terminadas_por_producto
       FROM registros_horneado WHERE masa_id = $1
       ORDER BY fecha_registro DESC LIMIT 1`,
      [masaId]
    );
    const unidades_terminadas_total = horneadoConProd.rows[0]?.unidades_terminadas || null;
    const udsTerminadasPorProd = horneadoConProd.rows[0]?.unidades_terminadas_por_producto || {};
    productos = productos.map(p => ({
      ...p,
      unidades_terminadas_horneado: udsTerminadasPorProd[String(p.id)] ?? null,
    }));

    const registroR = await db.query(
      `SELECT id, fecha_vencimiento, estado,
              sap_doc_entry_entrada, sap_doc_num_entrada, sap_error_entrada,
              sap_doc_entry_salida, sap_doc_num_salida, sap_error_salida
       FROM registros_empaque WHERE masa_id = $1 LIMIT 1`,
      [masaId]
    );

    // Materiales de alistamiento (BOM empaque)
    const itemCodesProd = [...new Set(productos.map(p => p.sap_item_code).filter(Boolean))];
    let materiales_alistamiento = [];
    if (itemCodesProd.length) {
      const matR = await db.query(
        `SELECT sbc.item_code_comp AS item_code, sbc.item_code_padre,
                sbc.item_name_comp AS nombre,
                sbc.uom, sbc.cantidad AS cantidad_por_unidad,
                COALESCE(sim.costo_unitario, 0) AS precio_unitario,
                COALESCE(sim.stock_almp, 0) AS stock_disponible
         FROM sap_bom_componentes sbc
         LEFT JOIN sap_inventario_mp sim ON sim.item_code = sbc.item_code_comp
         WHERE sbc.item_code_padre = ANY($1) AND sbc.es_empaque = true
         ORDER BY sbc.item_name_comp`,
        [itemCodesProd]
      );
      // Consolidar por material y calcular cantidad total
      const mapa = {};
      for (const mat of matR.rows) {
        const prod = productos.find(p => p.sap_item_code === mat.item_code_padre);
        const unidades = parseInt(
          String(prod?.unidades_ajustadas || prod?.unidades_programadas || 0)
        );
        if (!mapa[mat.item_code]) {
          mapa[mat.item_code] = {
            item_code:        mat.item_code,
            nombre:           mat.nombre,
            uom:              mat.uom,
            cantidad_total:   0,
            precio_unitario:  parseFloat(mat.precio_unitario),
            stock_disponible: parseFloat(mat.stock_disponible),
          };
        }
        mapa[mat.item_code].cantidad_total +=
          parseFloat(mat.cantidad_por_unidad) * unidades;
      }
      materiales_alistamiento = Object.values(mapa);

      // BOM desglosado por producto_masa_id para cálculo de consumo real en frontend
      for (const mat of matR.rows) {
        const prod = productos.find(p => p.sap_item_code === mat.item_code_padre);
        if (!prod) continue;
        if (!mapa[mat.item_code]) continue;
        if (!mapa[mat.item_code].por_producto) mapa[mat.item_code].por_producto = {};
        mapa[mat.item_code].por_producto[prod.id] = parseFloat(mat.cantidad_por_unidad);
      }
      materiales_alistamiento = Object.values(mapa);
    }

    res.json({ success: true, data: {
      masa: masaInfo,
      productos,
      registro_empaque: registroR.rows[0] || null,
      unidades_terminadas_total,
      materiales_alistamiento,
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

    // Crear detalles por producto — uno por OV para trazabilidad
    // Si no hay OVs en productos_por_masa_ov (masas antiguas), crear uno genérico por producto
    const prodsR = await client.query(
      `SELECT id FROM productos_por_masa WHERE masa_id = $1`, [masaId]
    );
    for (const p of prodsR.rows) {
      // Verificar si hay OVs registradas para este producto
      const ovsR = await client.query(
        `SELECT id FROM productos_por_masa_ov WHERE producto_masa_id = $1`,
        [p.id]
      );
      if (ovsR.rows.length > 0) {
        // Crear un detalle de empaque por OV — el operario empaca OV por OV
        for (const ov of ovsR.rows) {
          await client.query(
            `INSERT INTO empaque_detalles (empaque_id, producto_masa_id, sub_masa_id, unidades_empacadas, unidades_merma, ppm_ov_id)
             VALUES ($1, $2, $3, 0, 0, $4) ON CONFLICT DO NOTHING`,
            [empaqueId, p.id, masaId, ov.id]
          );
        }
      } else {
        // Masa sin OVs registradas (anterior al nuevo modelo) — detalle genérico
        await client.query(
          `INSERT INTO empaque_detalles (empaque_id, producto_masa_id, sub_masa_id, unidades_empacadas, unidades_merma)
           VALUES ($1, $2, $3, 0, 0) ON CONFLICT DO NOTHING`,
          [empaqueId, p.id, masaId]
        );
      }
    }

    await client.query(
      `UPDATE progreso_fases SET estado = 'EN_PROGRESO', updated_at = NOW()
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

    // unidades_empacadas llega en PAQUETES (lo que teclea el operario de empaque).
    // productos_por_masa.unidades_producidas se usa en toda la app (incl. Planificación
    // dinámica) con semántica de PANES — hay que convertir antes de guardar, si no,
    // la ventana de Planificación mostraría un número equivocado tras empacar.
    if (unidades_empacadas !== undefined) {
      const ppmR = await db.query(
        `SELECT unidades_por_paquete FROM productos_por_masa WHERE id = $1`,
        [productoId]
      );
      const panesPorPaquete = parseFloat(ppmR.rows[0]?.unidades_por_paquete) > 0
        ? parseFloat(ppmR.rows[0].unidades_por_paquete)
        : 1;
      const panesEquivalentes = Math.round(unidades_empacadas * panesPorPaquete);
      await db.query(
        `UPDATE productos_por_masa SET unidades_producidas = $1 WHERE id = $2`,
        [panesEquivalentes, productoId]
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
    const { observaciones, fecha_local } = req.body;

    await client.query('BEGIN');

    const empR = await client.query(
      `SELECT id, sap_doc_entry_entrada, sap_doc_num_entrada,
              sap_doc_entry_salida, sap_doc_num_salida
       FROM registros_empaque WHERE masa_id = $1 AND estado = 'EN_PROGRESO'`, [masaId]
    );
    if (!empR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No hay empaque en progreso' });
    }
    const empaqueId = empR.rows[0].id;
    const yaEntrada = empR.rows[0].sap_doc_entry_entrada;
    const yaSalida  = empR.rows[0].sap_doc_entry_salida;

    // ── GUARDIA IDEMPOTENCIA ──────────────────────────────────────────────────
    // Si AMBOS documentos SAP ya existen → no hay nada más que hacer
    if (yaEntrada && yaSalida) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        already_sent: true,
        sap_doc_entry_entrada: yaEntrada,
        sap_doc_num_entrada: empR.rows[0].sap_doc_num_entrada,
        sap_doc_entry_salida: yaSalida,
        sap_doc_num_salida: empR.rows[0].sap_doc_num_salida,
        message: `Empaque ya registrado completamente en SAP (Entrada DocNum ${empR.rows[0].sap_doc_num_entrada}, Salida DocNum ${empR.rows[0].sap_doc_num_salida}). No se puede enviar de nuevo.`,
      });
    }

    // 1. Productos y unidades empacadas
    const prodsR = await client.query(
      `SELECT ppm.id, ppm.sap_item_code, ppm.gramaje_unitario,
              COALESCE(ppm.unidades_pan_por_paquete, 1) AS unidades_pan_por_paquete,
              COALESCE(ed.unidades_empacadas, 0) AS uds_empacadas,
              ppm.kilos_programados, ppm.costo_mp_total_prod
       FROM productos_por_masa ppm
       LEFT JOIN empaque_detalles ed ON ed.empaque_id = $2 AND ed.producto_masa_id = ppm.id
       WHERE ppm.masa_id = $1`,
      [masaId, empaqueId]
    );

    // 1b. Lote de producción, fecha de vencimiento y codigo_masa para U_JZ_NumMasa
    const masaDatosR = await client.query(
      `SELECT mp.lote_produccion, mp.codigo_masa,
              re.fecha_vencimiento,
              rh.fecha_vencimiento_sugerida
       FROM masas_produccion mp
       LEFT JOIN registros_empaque re ON re.masa_id = mp.id
       LEFT JOIN registros_horneado rh ON rh.masa_id = mp.id
       WHERE mp.id = $1
       ORDER BY rh.fecha_registro DESC
       LIMIT 1`,
      [masaId]
    );
    const loteProduccion   = masaDatosR.rows[0]?.lote_produccion || `LOTE-${masaId}`;
    const codigoMasa       = masaDatosR.rows[0]?.codigo_masa     || String(masaId);
    const fechaVencimiento = masaDatosR.rows[0]?.fecha_vencimiento
      || masaDatosR.rows[0]?.fecha_vencimiento_sugerida
      || null;

    // 2. Kg producidos reales + total panes individuales
    const totalUdsProducidas = prodsR.rows.reduce((s, p) => s + parseInt(p.uds_empacadas), 0);
    const totalKgProducidos = prodsR.rows.reduce(
      (s, p) => s + (parseInt(p.uds_empacadas) * parseFloat(p.gramaje_unitario) / 1000), 0
    );
    // Total panes individuales para calcular costo real por unidad de pan
    const totalPanesProducidos = prodsR.rows.reduce(
      (s, p) => s + (parseInt(p.uds_empacadas) * parseFloat(p.unidades_pan_por_paquete || 1)), 0
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

    // 5. Costo empaque: BOM × precio SAP × unidades empacadas — calculado POR PRODUCTO
    // Construye también el mapa de materiales por producto para SAP (paso 10)
    let costoEmpaqueTotal = 0;
    // materialesPorProducto: { producto_masa_id → [{ item_code, nombre, cantidad, uom, precio }] }
    const materialesPorProducto = {};
    for (const prod of prodsR.rows) {
      if (!prod.sap_item_code || !parseInt(prod.uds_empacadas)) continue;
      const matsR = await client.query(
        `SELECT sbc.item_code_comp, sbc.item_name_comp, sbc.cantidad, sbc.uom,
                COALESCE(sim.costo_unitario, 0) AS precio
         FROM sap_bom_componentes sbc
         LEFT JOIN sap_inventario_mp sim ON sim.item_code = sbc.item_code_comp
         WHERE sbc.item_code_padre = $1 AND sbc.es_empaque = true`,
        [prod.sap_item_code]
      );
      let costoEmpaqueProd = 0;
      materialesPorProducto[prod.id] = [];
      for (const mat of matsR.rows) {
        const cantTotal = parseFloat(mat.cantidad) * parseInt(prod.uds_empacadas);
        const costoMat  = cantTotal * parseFloat(mat.precio);
        costoEmpaqueProd += costoMat;
        materialesPorProducto[prod.id].push({
          item_code:   mat.item_code_comp,
          nombre:      mat.item_name_comp,
          cantidad:    cantTotal,
          uom:         mat.uom,
          precio:      parseFloat(mat.precio),
          costo_total: costoMat,
        });
      }
      prod._costo_empaque = costoEmpaqueProd;
      costoEmpaqueTotal += costoEmpaqueProd;
    }

    // 6. Costo indirecto
    const costoIndPorKg = await getCfg('costo_indirecto_por_kg');
    const costoDepPorKg = await getCfg('costo_depreciacion_por_kg');
    const costoIndirectoTotal = (costoIndPorKg + costoDepPorKg) * totalKgProducidos;

    // 7. Totales masa
    const costoTotalFinal = costoMPTotal + costoMOTotal + costoEmpaqueTotal + costoIndirectoTotal;
    const costoUnitarioFinal = totalUdsProducidas > 0
      ? costoTotalFinal / totalUdsProducidas : 0;
    const costoPanUnitario = totalPanesProducidos > 0
      ? costoTotalFinal / totalPanesProducidos : 0;

    // 8. Actualizar costos finales — empaque REAL por producto, MO/indirecto por kilos
    const totalKilosPPM = prodsR.rows.reduce(
      (s, p) => s + parseFloat(p.kilos_programados || 0), 0
    );
    for (const prod of prodsR.rows) {
      const ratio         = totalKilosPPM > 0
        ? parseFloat(prod.kilos_programados || 0) / totalKilosPPM
        : 1 / prodsR.rows.length;
      const moProd        = costoMOTotal        * ratio;
      const indirectoProd = costoIndirectoTotal * ratio;
      const empaqueProd   = prod._costo_empaque || 0;   // ← costo real de su BOM
      const mpProd        = parseFloat(prod.costo_mp_total_prod || 0);
      const totalProd     = mpProd + moProd + empaqueProd + indirectoProd;
      const udsEmpacadas  = parseInt(prod.uds_empacadas || 0);
      const panesUd       = parseInt(prod.unidades_pan_por_paquete || 1);
      const unitarioProd  = udsEmpacadas > 0 ? totalProd / udsEmpacadas : 0;
      const panUnitProd   = (udsEmpacadas * panesUd) > 0
        ? totalProd / (udsEmpacadas * panesUd) : 0;

      await client.query(
        `UPDATE productos_por_masa SET
           costo_mo_total        = $1,
           costo_empaque_total   = $2,
           costo_empaque_real    = $2,
           costo_indirecto_total = $3,
           costo_total_final     = $4,
           costo_unitario_final  = $5,
           costo_pan_unitario    = $6
         WHERE id = $7`,
        [moProd, empaqueProd, indirectoProd,
         totalProd, unitarioProd, panUnitProd, prod.id]
      );
    }

    // 9. Marcar empaque y fase completados — SE EJECUTA DESPUÉS de SAP (ver paso 9b más abajo)
    // No se marca COMPLETADA aquí para evitar estado inconsistente si SAP falla

    // 10. Entrada de mercancía SAP (InventoryGenEntries) — PRIMERO. Si esto falla,
    // no se toca la salida de materiales, evitando descuentos duplicados en ALEMP.
    let sapEntradaResult = null;
    if (yaEntrada) {
      sapEntradaResult = { doc_entry: yaEntrada, lineas: null, ya_existia: true };
    } else {
      try {
        const sapServiceEntrada = require('../services/sap.service');
        await sapServiceEntrada.ensureSession();

        const entradaLines = [];
        for (const prod of prodsR.rows) {
          if (!prod.sap_item_code || !prod.uds_empacadas || parseInt(prod.uds_empacadas) <= 0) continue;
          const mpProdEntrada      = parseFloat(prod.costo_mp_total_prod || 0);
          const empaqueProdEntrada = prod._costo_empaque || 0;
          const totalKilosPPMEnt   = prodsR.rows.reduce((s, p) => s + parseFloat(p.kilos_programados || 0), 0);
          const ratioEnt           = totalKilosPPMEnt > 0
            ? parseFloat(prod.kilos_programados || 0) / totalKilosPPMEnt
            : 1 / prodsR.rows.length;
          const moProdEntrada      = costoMOTotal        * ratioEnt;
          const indProdEntrada     = costoIndirectoTotal * ratioEnt;
          const totalProdEntrada   = mpProdEntrada + moProdEntrada + empaqueProdEntrada + indProdEntrada;
          const udsEnt             = parseInt(prod.uds_empacadas);
          const costoUnitarioProd  = udsEnt > 0 ? totalProdEntrada / udsEnt : 0;

          const linea = {
            ItemCode:      prod.sap_item_code,
            Quantity:      udsEnt,
            UnitPrice:     parseFloat(costoUnitarioProd.toFixed(2)),
            WarehouseCode: 'PROTERMI',
            AccountCode:   '14100501',
            BatchNumbers: [{
              BatchNumber:       loteProduccion,
              Quantity:          udsEnt,
              ExpiryDate:        fechaVencimiento
                ? new Date(fechaVencimiento).toISOString().split('T')[0]
                : null,
              ManufacturingDate: fecha_local || new Date().toISOString().split('T')[0],
            }],
            // Bodega PROTERMI exige ubicación en toda transacción (entrada Y salida)
            DocumentLinesBinAllocations: [{
              BinAbsEntry: 1,
              Quantity: udsEnt,
              SerialAndBatchNumbersBaseLine: 0,
            }],
          };
          entradaLines.push(linea);
        }

        if (entradaLines.length) {
          const sapRespEntrada = await sapServiceEntrada.client.post('/InventoryGenEntries', {
            DocDate:       fecha_local || new Date().toISOString().split('T')[0],
            Comments:      `Producción terminada masa ${masaId} - Lote ${loteProduccion}`,
            U_JZ_NumMasa:  String(masaId),
            DocumentLines: entradaLines,
          });
          sapEntradaResult = { doc_entry: sapRespEntrada.data.DocEntry, lineas: entradaLines.length };
          logger.info(`InventoryGenEntries masa ${masaId}: DocEntry ${sapRespEntrada.data.DocEntry}`);
          await client.query(
            `UPDATE registros_empaque
               SET sap_doc_entry_entrada = $1, sap_doc_num_entrada = $2, sap_error_entrada = NULL
             WHERE masa_id = $3`,
            [sapRespEntrada.data.DocEntry, String(sapRespEntrada.data.DocNum || ''), masaId]
          );

          await client.query(`
            UPDATE costos_masa SET
              costo_mo_total      = $2,
              costo_cif_total     = $3,
              costo_total_masa    = $4,
              costo_por_kilo      = $5,
              fecha_calculo_final = NOW(),
              updated_at          = NOW()
            WHERE masa_id = $1
          `, [
            masaId,
            costoMOTotal,
            costoIndirectoTotal,
            costoTotalFinal,
            totalKgProducidos > 0 ? costoTotalFinal / totalKgProducidos : 0,
          ]);
        }
      } catch (sapErr) {
        const sapErrDetail = sapErr.response?.data?.error?.message?.value
          || sapErr.response?.data?.error?.message
          || sapErr.message;
        logger.error(`Error InventoryGenEntries masa ${masaId}: ${sapErrDetail}`);
        await client.query(
          `UPDATE registros_empaque SET sap_error_entrada = $1 WHERE masa_id = $2`,
          [sapErrDetail, masaId]
        );
        await client.query('COMMIT');
        return res.status(502).json({
          success: false,
          sap_entrada_error: sapErrDetail,
          message: `No se pudo registrar la entrada de producto terminado en SAP. La salida de materiales de empaque NO fue creada — sin descuento duplicado. Corrige el problema en SAP e intenta de nuevo. Detalle: ${sapErrDetail}`,
        });
      }
    }

    // 11. Salida de materiales de empaque SAP (InventoryGenExits) — SOLO si la entrada
    // fue exitosa (ahora o en un intento anterior). UNA LÍNEA POR PRODUCTO.
    let sapResult = null;
    if (yaSalida) {
      sapResult = { doc_entry: yaSalida, lineas: null, ya_existia: true };
    } else {
      const docLines = [];
      try {
        const sapService = require('../services/sap.service');
        await sapService.ensureSession();

        for (const prod of prodsR.rows) {
          if (!prod.sap_item_code || !parseInt(prod.uds_empacadas)) continue;
          const mats = materialesPorProducto[prod.id] || [];
          for (const mat of mats) {
            if (mat.cantidad <= 0) continue;
            docLines.push({
              ItemCode:      mat.item_code,
              Quantity:      mat.cantidad,
              WarehouseCode: 'ALEMP',
              AccountCode:   '14100501',
            });
          }
        }

        if (docLines.length) {
          const sapResp = await sapService.client.post('/InventoryGenExits', {
            DocDate:       fecha_local || new Date().toISOString().split('T')[0],
            Comments:      `Consumo empaque masa ${masaId}`,
            U_JZ_NumMasa:  String(masaId),
            DocumentLines: docLines,
          });
          sapResult = { doc_entry: sapResp.data.DocEntry, lineas: docLines.length };
          logger.info(`GoodsIssues empaque masa ${masaId}: DocEntry ${sapResp.data.DocEntry} (${docLines.length} líneas)`);
          await client.query(
            `UPDATE registros_empaque
               SET sap_doc_entry_salida = $1, sap_doc_num_salida = $2, sap_error_salida = NULL
             WHERE masa_id = $3`,
            [sapResp.data.DocEntry, String(sapResp.data.DocNum || ''), masaId]
          );

          let lineaIdx = 0;
          for (const prod of prodsR.rows) {
            if (!prod.sap_item_code || !parseInt(prod.uds_empacadas)) continue;
            const mats = materialesPorProducto[prod.id] || [];
            for (const mat of mats) {
              if (mat.cantidad <= 0) continue;
              await client.query(
                `INSERT INTO empaque_consumo_materiales
                   (masa_id, producto_masa_id, item_code_comp, item_name_comp,
                    cantidad_consumida, uom, costo_unitario_mat, costo_total_mat,
                    sap_doc_entry_salida, sap_doc_num_salida)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 ON CONFLICT DO NOTHING`,
                [masaId, prod.id, mat.item_code, mat.nombre,
                 mat.cantidad, mat.uom, mat.precio, mat.costo_total,
                 sapResp.data.DocEntry, String(sapResp.data.DocNum || '')]
              );
              lineaIdx++;
            }
          }
        }
      } catch (sapErr) {
        const sapErrDetail = sapErr.response?.data?.error?.message?.value
          || sapErr.response?.data?.error?.message
          || sapErr.message;
        logger.warn(`SAP HTTP Error: Bad Request`);
        logger.error(`Error GoodsIssues empaque masa ${masaId}: ${sapErrDetail}`);

        let itemSinStock = null;
        const matchLinea = sapErrDetail?.match(/\[line:\s*(\d+)\]/i);
        if (matchLinea) {
          const lineaIdx = parseInt(matchLinea[1]) - 1;
          if (docLines[lineaIdx]) {
            const itemCode = docLines[lineaIdx].ItemCode;
            const itemR = await db.query(
              `SELECT item_name FROM sap_inventario_mp WHERE item_code = $1`,
              [itemCode]
            );
            const nombre = itemR.rows[0]?.item_name || itemCode;
            itemSinStock = { codigo: itemCode, nombre };
          }
        }

        const mensajeUsuario = itemSinStock
          ? `La entrada de producto terminado YA fue registrada en SAP. No hay suficiente stock de "${itemSinStock.nombre}" (${itemSinStock.codigo}) en SAP — almacén ALEMP. Informa a compras para que verifiquen el saldo antes de reintentar la salida.`
          : `La entrada de producto terminado YA fue registrada en SAP. No se pudo registrar la salida de materiales de empaque. Verifica los saldos en ALEMP e intenta de nuevo.`;

        await client.query(
          `UPDATE registros_empaque SET sap_error_salida = $1 WHERE masa_id = $2`,
          [sapErrDetail, masaId]
        );
        await client.query('COMMIT');
        return res.status(502).json({
          success: false,
          sap_salida_error: sapErrDetail,
          item_sin_stock: itemSinStock,
          message: mensajeUsuario,
        });
      }
    }


    // 9b. Marcar COMPLETADA solo si ambos SAP respondieron OK
    const sapAdvertencias = [];
    if (sapEntradaResult?.error) {
      sapAdvertencias.push(`Entrada de mercancía SAP falló: ${sapEntradaResult.error}`);
    }
    if (sapResult?.error) {
      sapAdvertencias.push(`Salida de materiales de empaque SAP falló: ${sapResult.error}`);
    }

    if (sapAdvertencias.length === 0) {
      // SAP OK → marcar empaque y fase completados
      await client.query(
        `UPDATE registros_empaque SET estado = 'COMPLETADO', fecha_completado = NOW(),
           observaciones = COALESCE($2, observaciones)
         WHERE id = $1`,
        [empaqueId, observaciones || null]
      );
      await client.query(
        `UPDATE progreso_fases SET estado = 'COMPLETADA', porcentaje_completado = 100,
           updated_at = NOW()
         WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
        [masaId]
      );
      await client.query(
        `UPDATE masas_produccion SET estado = 'COMPLETADA', fase_actual = 'EMPAQUE'
         WHERE id = $1`,
        [masaId]
      );
    }
    // Si SAP falló: la fase queda EN_PROGRESO, el usuario debe reintentar tras corregir SAP

    await client.query('COMMIT');

    res.json({
      success: true,
      sap_advertencias: sapAdvertencias,
      message: sapAdvertencias.length > 0
        ? `Empaque completado con advertencias SAP. Revisar: ${sapAdvertencias.join(' | ')}`
        : 'Empaque completado. Producción finalizada.',
      data: {
        costos: {
          mp: costoMPTotal,
          mo: costoMOTotal,
          empaque: costoEmpaqueTotal,
          indirecto: costoIndirectoTotal,
          total: costoTotalFinal,
          unitario: costoUnitarioFinal,
        },
        sap_salida: sapResult,
        sap_entrada: sapEntradaResult,
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
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
    const masasR = await db.query(`
      SELECT mp.id, mp.codigo_masa, mp.nombre_masa, mp.tipo_masa,
             mp.total_kilos_con_merma, mp.fecha_produccion,
             COALESCE((
               SELECT SUM(im.peso_real)
               FROM ingredientes_masa im
               WHERE im.masa_id = mp.id
                 AND im.es_empaque = false
                 AND im.es_decoracion = false
                 AND im.pesado = true
             ), 0) / 1000 AS total_kilos_pesado_real,
             mp.es_subdivision, mp.masa_padre_id,
             mp.lote_produccion,
             mp.es_repeticion, mp.es_adicional,
             pf_e.estado AS estado_empaque,
             COALESCE(pf_h.estado, 'BLOQUEADA') AS estado_horneado
      FROM masas_produccion mp
      JOIN progreso_fases pf_e ON pf_e.masa_id = mp.id AND pf_e.fase = 'EMPAQUE'
      LEFT JOIN progreso_fases pf_h ON pf_h.masa_id = mp.id AND pf_h.fase = 'HORNEADO'
      WHERE (
        pf_e.estado IN ('PENDIENTE', 'EN_PROGRESO')
        OR (
          pf_e.estado = 'COMPLETADA'
          AND EXISTS (
            SELECT 1 FROM registros_empaque re
            WHERE re.masa_id = mp.id
              AND (re.sap_error_entrada IS NOT NULL OR re.sap_error_salida IS NOT NULL)
          )
        )
      )
        AND mp.estado NOT IN ('SUBDIVIDIDA', 'CANCELADA', 'PLANIFICACION')
        AND mp.fecha_produccion = $1
      ORDER BY mp.id DESC
    `, [fecha]);

    if (!masasR.rows.length)
      return res.json({ success: true, data: [] });

    const resultado = [];

    for (const masa of masasR.rows) {
      const prodsR = await db.query(`
        SELECT ppm.id, ppm.sap_item_code, ppm.producto_nombre, ppm.presentacion,
               ppm.gramaje_unitario,
               ppm.unidades_pedidas,
               ppm.unidades_programadas,
               CASE
                 WHEN ppm.division_completada = true AND COALESCE(ppm.cantidad_divisiones, 0) > 0
                 THEN ppm.cantidad_divisiones
                 ELSE GREATEST(COALESCE(ppm.unidades_ajustadas, 0), COALESCE(ppm.unidades_programadas, 0))
               END AS unidades_referencia,
               COALESCE(ppm.division_completada, false) AS division_completada,
               COALESCE(ppm.unidades_producidas, 0) AS unidades_producidas,
               ppm.sap_doc_num, ppm.sap_doc_entry,
               ppm.unidades_por_paquete
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
        SELECT id, estado, fecha_vencimiento,
               sap_error_entrada, sap_error_salida,
               sap_doc_entry_entrada, sap_doc_entry_salida
        FROM registros_empaque WHERE masa_id = $1 LIMIT 1
      `, [masa.id]);

      // Materiales de empaque del BOM para alistamiento anticipado
      const itemCodes = [...new Set(productos.map(p => p.sap_item_code).filter(Boolean))];
      let materialesAlistamiento = [];
      if (itemCodes.length) {
        const matR = await db.query(
          `SELECT sbc.item_code_padre, sbc.item_code_comp, sbc.item_name_comp,
                  sbc.cantidad AS cantidad_por_unidad, sbc.uom,
                  COALESCE(sim.costo_unitario, 0) AS precio_unitario,
                  COALESCE(sim.stock_almp, 0) AS stock_disponible
           FROM sap_bom_componentes sbc
           LEFT JOIN sap_inventario_mp sim ON sim.item_code = sbc.item_code_comp
           WHERE sbc.item_code_padre = ANY($1) AND sbc.es_empaque = true
           ORDER BY sbc.item_name_comp`,
          [itemCodes]
        );
        const mapaMateriales = {};
        for (const mat of matR.rows) {
          const prod = productos.find(p => p.sap_item_code === mat.item_code_padre);
          // unidades_referencia viene en PANES solo cuando division_completada=true (viene de
          // cantidad_divisiones). Si aún no hay división, unidades_referencia ya es PAQUETES
          // (viene de unidades_ajustadas/unidades_programadas) y NO debe dividirse — dividir
          // en ese caso subestima el material 6x (bug detectado 2026-07-28 en BRIOCHE OV617).
          const refValor = parseFloat(prod?.unidades_referencia || prod?.unidades_programadas || 0);
          const panesPorPaqueteRef = parseFloat(prod?.unidades_por_paquete) > 0
            ? parseFloat(prod.unidades_por_paquete)
            : 1;
          const unidades = prod?.division_completada
            ? refValor / panesPorPaqueteRef
            : refValor;
          const key = mat.item_code_comp;
          if (!mapaMateriales[key]) {
            mapaMateriales[key] = {
              item_code:        mat.item_code_comp,
              nombre:           mat.item_name_comp,
              uom:              mat.uom,
              cantidad_total:   0,
              precio_unitario:  parseFloat(mat.precio_unitario),
              stock_disponible: parseFloat(mat.stock_disponible),
            };
          }
          mapaMateriales[key].cantidad_total += parseFloat(mat.cantidad_por_unidad) * unidades;
        }
        materialesAlistamiento = Object.values(mapaMateriales);
      }

      resultado.push({
        id:                      masa.id,
        codigo_masa:             masa.codigo_masa,
        nombre_masa:             masa.nombre_masa,
        tipo_masa:               masa.tipo_masa,
        total_kilos_con_merma:   parseFloat(masa.total_kilos_con_merma || 0),
        total_kilos_pesado_real: parseFloat(masa.total_kilos_pesado_real || 0),
        fecha_produccion:        masa.fecha_produccion,
        es_subdivision:          masa.es_subdivision,
        estado_empaque:          masa.estado_empaque,
        estado_horneado:         masa.estado_horneado,
        horneado_completo:       masa.estado_horneado === 'COMPLETADA',
        lote_produccion:         masa.lote_produccion || null,
        empaque_iniciado:        empR.rows.length > 0,
        empaque_id:              empR.rows[0]?.id || null,
        fecha_vencimiento:       empR.rows[0]?.fecha_vencimiento || null,
        sap_error_entrada:       empR.rows[0]?.sap_error_entrada || null,
        sap_error_salida:        empR.rows[0]?.sap_error_salida || null,
        sap_doc_entry_entrada:   empR.rows[0]?.sap_doc_entry_entrada || null,
        sap_doc_entry_salida:    empR.rows[0]?.sap_doc_entry_salida || null,
        materiales_alistamiento: materialesAlistamiento,
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
// ── GET /api/empaque/resumen-variedad?fecha=YYYY-MM-DD ───────────────────────
// Resumen consolidado de unidades por SKU para bodega / alistamiento de empaque
exports.getResumenVariedad = async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

    // 1. Unidades programadas agrupadas por SKU, de todas las masas con EMPAQUE activo
    const productosR = await db.query(
      `SELECT
         ppm.sap_item_code,
         ppm.producto_nombre,
         ppm.gramaje_unitario,
         ppm.unidades_por_paquete,
         ppm.unidades_pan_por_paquete,
         SUM(ppm.unidades_programadas)  AS total_unidades,
         SUM(ppm.cantidad_paquetes)     AS total_paquetes,
         COUNT(DISTINCT mp.id)          AS cant_masas,
         STRING_AGG(DISTINCT mp.tipo_masa, ', ' ORDER BY mp.tipo_masa) AS tipos_masa,
         pf.estado                      AS empaque_estado
       FROM productos_por_masa ppm
       JOIN masas_produccion mp ON mp.id = ppm.masa_id
       JOIN progreso_fases pf  ON pf.masa_id = mp.id AND pf.fase = 'EMPAQUE'
       WHERE mp.fecha_produccion = $1
         AND pf.estado IN ('PENDIENTE', 'EN_PROGRESO')
         AND mp.estado != 'CANCELADA'
         AND ppm.unidades_programadas > 0
       GROUP BY
         ppm.sap_item_code,
         ppm.producto_nombre,
         ppm.gramaje_unitario,
         ppm.unidades_por_paquete,
         ppm.unidades_pan_por_paquete,
         pf.estado
       ORDER BY ppm.producto_nombre`,
      [fecha]
    );

    // 2. Materiales de empaque (BOM grupo 182) para cada SKU encontrado
    const itemCodes = [...new Set(productosR.rows.map(r => r.sap_item_code).filter(Boolean))];
    let materialesMap = {};

    if (itemCodes.length > 0) {
      const matsR = await db.query(
        `SELECT
           sbc.item_code_padre,
           sbc.item_code_comp,
           sbc.item_name_comp,
           sbc.cantidad      AS cantidad_por_unidad,
           sbc.uom
         FROM sap_bom_componentes sbc
         WHERE sbc.item_code_padre = ANY($1)
           AND sbc.es_empaque = true
         ORDER BY sbc.item_code_padre, sbc.visual_order`,
        [itemCodes]
      );
      for (const mat of matsR.rows) {
        if (!materialesMap[mat.item_code_padre]) materialesMap[mat.item_code_padre] = [];
        materialesMap[mat.item_code_padre].push({
          item_code:           mat.item_code_comp,
          nombre:              mat.item_name_comp,
          cantidad_por_unidad: parseFloat(mat.cantidad_por_unidad),
          uom:                 mat.uom,
        });
      }
    }

    // 3. Consolidar: agrupar filas del mismo SKU que tengan distinto estado
    //    (puede haber masas PENDIENTE y EN_PROGRESO del mismo SKU)
    const consolidado = {};
    for (const row of productosR.rows) {
      const key = row.sap_item_code || row.producto_nombre;
      if (!consolidado[key]) {
        consolidado[key] = {
          sap_item_code:            row.sap_item_code,
          producto_nombre:          row.producto_nombre,
          gramaje_unitario:         parseFloat(row.gramaje_unitario || 0),
          unidades_por_paquete:     parseFloat(row.unidades_por_paquete || 1),
          unidades_pan_por_paquete: parseFloat(row.unidades_pan_por_paquete || 1),
          total_unidades:           0,
          total_paquetes:           0,
          cant_masas:               0,
          tipos_masa:               new Set(),
          tiene_pendiente:          false,
          tiene_en_progreso:        false,
          materiales:               materialesMap[row.sap_item_code] || [],
        };
      }
      const item = consolidado[key];
      item.total_unidades  += parseInt(row.total_unidades || 0);
      item.total_paquetes  += parseFloat(row.total_paquetes || 0);
      item.cant_masas      += parseInt(row.cant_masas || 0);
      row.tipos_masa?.split(', ').forEach(t => item.tipos_masa.add(t));
      if (row.empaque_estado === 'PENDIENTE')   item.tiene_pendiente   = true;
      if (row.empaque_estado === 'EN_PROGRESO') item.tiene_en_progreso = true;
    }

    const resultado = Object.values(consolidado).map(item => ({
      ...item,
      tipos_masa: [...item.tipos_masa].join(', '),
      materiales: item.materiales.map(m => ({
        ...m,
        cantidad_total: Math.ceil(m.cantidad_por_unidad * item.total_unidades),
      })),
    })).sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre));

    return res.json({
      success: true,
      data: {
        fecha,
        total_skus:     resultado.length,
        total_unidades: resultado.reduce((s, r) => s + r.total_unidades, 0),
        total_paquetes: resultado.reduce((s, r) => s + r.total_paquetes, 0),
        productos:      resultado,
      },
    });

  } catch (err) {
    logger.error('getResumenVariedad error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEtiqueta = async (req, res) => {
  try {
    const { masaId, productoId } = req.params;

    const prodR = await db.query(
      `SELECT ppm.*, re.fecha_vencimiento, mp.lote_produccion
       FROM productos_por_masa ppm
       LEFT JOIN registros_empaque re ON re.masa_id = ppm.masa_id
       LEFT JOIN masas_produccion mp ON mp.id = ppm.masa_id
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
        lote:                 prod.lote_produccion || prod.sap_doc_num || prod.codigo_masa || '',
        costo_unitario_final: prod.costo_unitario_final,
        costo_pan_unitario:   prod.costo_pan_unitario,
      },
    });
  } catch (error) {
    logger.error('Error getEtiqueta:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
