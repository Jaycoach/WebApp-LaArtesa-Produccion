/**
 * Controlador para gestión de fases de producción
 */

const fasesModel = require('../models/fases.model');
const logger = require('../utils/logger');
const db = require('../database/connection');

// ─────────────────────────────────────────────
// CONSTANTES DE LÍMITES POR TIPO DE MASA
// ─────────────────────────────────────────────
const LIMITE_KG_TOSCANO = 130;
const LIMITE_KG_DEFAULT  = 90;

/**
 * Devuelve el límite en kg según el tipo de masa.
 */
function getLimiteKg(tipo_masa) {
  if (!tipo_masa) return LIMITE_KG_DEFAULT;
  return tipo_masa.toUpperCase() === 'TOSCANO' ? LIMITE_KG_TOSCANO : LIMITE_KG_DEFAULT;
}

/**
 * Inicializa las fases de una masa recién creada.
 * PLANIFICACION → COMPLETADA, PESAJE → EN_PROGRESO, resto BLOQUEADA.
 */
async function inicializarFasesMasa(masaId, userId) {
  const fases = ['PLANIFICACION','PESAJE','AMASADO','DIVISION','FORMADO','FERMENTACION','HORNEADO'];
  for (const fase of fases) {
    const estado = fase === 'PLANIFICACION' ? 'COMPLETADA'
                 : fase === 'PESAJE'        ? 'EN_PROGRESO'
                 : 'BLOQUEADA';
    const porcentaje = fase === 'PLANIFICACION' ? 100 : 0;
    await db.query(`
      INSERT INTO progreso_fases
        (masa_id, fase, estado, porcentaje_completado, usuario_responsable,
         fecha_inicio, fecha_completado)
      VALUES ($1, $2, $3, $4, $5,
        CASE WHEN $3 IN ('EN_PROGRESO','COMPLETADA') THEN NOW() ELSE NULL END,
        CASE WHEN $3 = 'COMPLETADA' THEN NOW() ELSE NULL END)
      ON CONFLICT (masa_id, fase) DO NOTHING
    `, [masaId, fase, estado, porcentaje, userId]);
  }
}

/**
 * Distribuye productos entre dos sub-masas según las reglas de negocio.
 * Se llena la sub-masa A hasta el límite de capacidad; el resto va a B.
 *
 * @param {Array}  productos  - Filas de productos_por_masa de la masa original
 * @param {number} limiteKg   - Límite máximo de kg por tanda
 * @param {number} masaAId    - ID de la sub-masa A
 * @param {number} masaBId    - ID de la sub-masa B
 */
async function distribuirProductos(productos, limiteKg, masaAId, masaBId) {
  let kgUsadosA = 0;

  for (const prod of productos) {
    const unidadesProgramadas = parseInt(prod.unidades_programadas);
    const gramaje             = parseFloat(prod.gramaje_unitario);
    const unidadesPedidas     = parseInt(prod.unidades_pedidas);
    const kilosPedidos        = parseFloat(prod.kilos_pedidos);
    const kilosProgramados    = parseFloat(prod.kilos_programados);

    const kgPorUnidad    = gramaje / 1000;
    const kgDisponibleA  = limiteKg - kgUsadosA;
    const unidadesMaxA   = kgPorUnidad > 0
      ? Math.floor(kgDisponibleA / kgPorUnidad)
      : unidadesProgramadas;

    if (unidadesMaxA >= unidadesProgramadas) {
      // Todo cabe en A
      await insertarProductoEnMasa(masaAId, prod, unidadesProgramadas, unidadesPedidas, kilosPedidos, kilosProgramados);
      kgUsadosA += kilosProgramados;
    } else if (unidadesMaxA <= 0) {
      // Nada cabe en A → todo a B
      await insertarProductoEnMasa(masaBId, prod, unidadesProgramadas, unidadesPedidas, kilosPedidos, kilosProgramados);
    } else {
      // Dividir: unidadesMaxA van a A, el resto a B
      const unidadesA = unidadesMaxA;
      const unidadesB = unidadesProgramadas - unidadesA;

      const fracA = unidadesA / unidadesProgramadas;
      const fracB = unidadesB / unidadesProgramadas;

      const kgPedidosA     = parseFloat((kilosPedidos * fracA).toFixed(3));
      const kgProgramadosA = parseFloat((kilosProgramados * fracA).toFixed(3));
      const kgPedidosB     = parseFloat((kilosPedidos - kgPedidosA).toFixed(3));
      const kgProgramadosB = parseFloat((kilosProgramados - kgProgramadosA).toFixed(3));

      const unidadesPedidasA = Math.round(unidadesPedidas * fracA);
      const unidadesPedidasB = unidadesPedidas - unidadesPedidasA;

      await insertarProductoEnMasa(masaAId, prod, unidadesA, unidadesPedidasA, kgPedidosA, kgProgramadosA);
      await insertarProductoEnMasa(masaBId, prod, unidadesB, unidadesPedidasB, kgPedidosB, kgProgramadosB);

      kgUsadosA += kgProgramadosA;
    }
  }
}

/**
 * Inserta un producto en una sub-masa con las cantidades indicadas.
 */
async function insertarProductoEnMasa(masaId, prod, unidadesProg, unidadesPedidas, kgPedidos, kgProgramados) {
  await db.query(`
    INSERT INTO productos_por_masa
      (masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
       unidades_pedidas, unidades_programadas, unidades_producidas,
       kilos_pedidos, kilos_programados, kilos_producidos,
       sap_item_code)
    VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,0,$10)
  `, [
    masaId,
    prod.producto_codigo,
    prod.producto_nombre,
    prod.presentacion,
    prod.gramaje_unitario,
    unidadesPedidas,
    unidadesProg,
    kgPedidos,
    kgProgramados,
    prod.sap_item_code || null,
  ]);
}

/**
 * Distribuye ingredientes 50/50 entre dos sub-masas.
 * El sobrante de redondeo se absorbe en la sub-masa A.
 *
 * @param {Array}  ingredientes - Filas de ingredientes_masa de la masa original
 * @param {number} masaAId
 * @param {number} masaBId
 */
async function distribuirIngredientes(ingredientes, masaAId, masaBId) {
  const insertSQL = `
    INSERT INTO ingredientes_masa
      (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
       porcentaje_panadero, es_harina, es_agua, es_prefermento,
       cantidad_gramos, cantidad_kilos,
       disponible, verificado, pesado)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,false,false)
  `;

  for (const ing of ingredientes) {
    const kgTotal = parseFloat(ing.cantidad_kilos);
    const gTotal  = parseFloat(ing.cantidad_gramos);

    // Mitad B redondeada (a 3 decimales en kg, 2 en gramos)
    const kgB = parseFloat((kgTotal / 2).toFixed(3));
    const gB  = parseFloat((gTotal  / 2).toFixed(2));

    // Mitad A = total − B (absorbe la diferencia de redondeo)
    const kgA = parseFloat((kgTotal - kgB).toFixed(3));
    const gA  = parseFloat((gTotal  - gB).toFixed(2));

    await db.query(insertSQL, [
      masaAId,
      ing.ingrediente_sap_code,
      ing.ingrediente_nombre,
      ing.orden_visualizacion,
      ing.porcentaje_panadero,
      ing.es_harina,
      ing.es_agua,
      ing.es_prefermento,
      gA,
      kgA,
    ]);

    await db.query(insertSQL, [
      masaBId,
      ing.ingrediente_sap_code,
      ing.ingrediente_nombre,
      ing.orden_visualizacion,
      ing.porcentaje_panadero,
      ing.es_harina,
      ing.es_agua,
      ing.es_prefermento,
      gB,
      kgB,
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLADORES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Obtener progreso de fases de una masa
 * @route   GET /api/fases/:masaId
 * @access  Private
 */
const getProgresoFases = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const progreso = await fasesModel.getProgresoFases(masaId);
    res.json({ success: true, data: progreso });
  } catch (error) {
    logger.error('Error al obtener progreso de fases:', error);
    next(error);
  }
};

/**
 * @desc    Actualizar progreso de una fase
 * @route   PUT /api/fases/:masaId/progreso
 * @access  Private
 */
const updateProgreso = async (req, res, next) => {
  try {
    const { masaId } = req.params;
    const { fase, accion, datos } = req.body;

    if (!fase || !accion) {
      return res.status(400).json({ success: false, message: 'Fase y acción son requeridas' });
    }

    const fasesValidas = ['PLANIFICACION','PESAJE','AMASADO','DIVISION','FORMADO','FERMENTACION','HORNEADO'];
    if (!fasesValidas.includes(fase.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Fase inválida' });
    }

    const accionesValidas = ['iniciar','actualizar','completar'];
    if (!accionesValidas.includes(accion.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Acción inválida' });
    }

    let estado, porcentaje;
    switch (accion.toLowerCase()) {
      case 'iniciar':    estado = 'EN_PROGRESO'; porcentaje = 0;   break;
      case 'actualizar': estado = 'EN_PROGRESO'; porcentaje = datos?.porcentaje || 50; break;
      case 'completar':  estado = 'COMPLETADA';  porcentaje = 100; break;
    }

    const faseActualizada = await fasesModel.updateEstadoFase(
      masaId, fase.toUpperCase(), estado, porcentaje, req.user.id, datos
    );

    if (accion.toLowerCase() === 'completar') {
      await fasesModel.desbloquearSiguienteFase(masaId, fase.toUpperCase());
    }

    res.json({ success: true, data: faseActualizada, message: `Fase ${accion} exitosamente` });
  } catch (error) {
    logger.error('Error al actualizar progreso:', error);
    next(error);
  }
};

/**
 * @desc    Completar una fase específica
 * @route   PUT /api/fases/:masaId/:fase/completar
 * @access  Private
 *
 * Cuando fase = PLANIFICACION:
 *   1. Consolida BOM de todos los productos → ingredientes_masa
 *   2. Calcula peso total de ingredientes
 *   3. Si supera el límite por tipo de masa → divide en 2 sub-masas
 *      - Sub-masa A y B con ingredientes 50/50
 *      - Productos distribuidos por capacidad disponible
 *      - La masa original queda en estado CANCELADA
 *      - Respuesta especial incluye info de subdivisión
 */
const completarFase = async (req, res, next) => {
  try {
    const { masaId, fase } = req.params;
    const datos = req.body;

    let acumulado = {};
    let subdivision = null;

    // ── Caso especial: PLANIFICACION → consolidar BOM ──────────────
    if (fase.toUpperCase() === 'PLANIFICACION') {

      // 1. Obtener datos completos de la masa
      const masaResult = await db.query(
        `SELECT id, codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
                total_kilos_base, total_kilos_con_merma, porcentaje_merma,
                factor_absorcion_usado, created_by
         FROM masas_produccion WHERE id = $1`,
        [masaId]
      );

      if (masaResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Masa no encontrada' });
      }
      const masa = masaResult.rows[0];

      // 2. Obtener productos con sap_item_code
      const productosResult = await db.query(
        `SELECT sap_item_code, producto_nombre, unidades_programadas,
                producto_codigo, presentacion, gramaje_unitario,
                unidades_pedidas, kilos_pedidos, kilos_programados
         FROM productos_por_masa
         WHERE masa_id = $1 AND sap_item_code IS NOT NULL AND sap_item_code <> ''`,
        [masaId]
      );

      if (productosResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'La masa no tiene productos con ItemCode SAP. Verifique la sincronización de OV.',
        });
      }

      // 3. Consolidar BOM de todos los productos
      for (const prod of productosResult.rows) {
        const bomResult = await db.query(
          `SELECT item_code_comp, item_name_comp, cantidad, warehouse, issue_method, visual_order
           FROM sap_bom_componentes
           WHERE item_code_padre = $1
           ORDER BY visual_order`,
          [prod.sap_item_code]
        );

        if (bomResult.rows.length === 0) {
          logger.warn(`Sin BOM local para ${prod.sap_item_code} (${prod.producto_nombre}). ¿Se ejecutó sincronizar-bom?`);
          continue;
        }

        for (const comp of bomResult.rows) {
          const cantidadTotal = parseFloat(comp.cantidad) * parseFloat(prod.unidades_programadas);
          if (acumulado[comp.item_code_comp]) {
            acumulado[comp.item_code_comp].cantidad += cantidadTotal;
          } else {
            acumulado[comp.item_code_comp] = {
              nombre:      comp.item_name_comp,
              cantidad:    cantidadTotal,
              warehouse:   comp.warehouse,
              issueMethod: comp.issue_method,
              visualOrder: comp.visual_order,
            };
          }
        }
      }

      // 4. Limpiar e insertar ingredientes consolidados en la masa original
      const componentesConsolidados = Object.entries(acumulado);

      if (componentesConsolidados.length > 0) {
        await db.query(`DELETE FROM ingredientes_masa WHERE masa_id = $1`, [masaId]);

        for (const [itemCode, comp] of componentesConsolidados) {
          const nombreLower   = comp.nombre.toLowerCase();
          const esHarina      = nombreLower.includes('harina');
          const esAgua        = nombreLower.includes('agua');
          const esPrefermento = comp.warehouse === 'PRODPROC';
          const cantidadKilos  = comp.cantidad;
          const cantidadGramos = cantidadKilos * 1000;

          await db.query(`
            INSERT INTO ingredientes_masa
              (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
               es_harina, es_agua, es_prefermento,
               porcentaje_panadero, cantidad_gramos, cantidad_kilos,
               disponible, verificado, pesado)
            VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,false,false,false)
          `, [
            masaId, itemCode, comp.nombre, comp.visualOrder,
            esHarina, esAgua, esPrefermento,
            cantidadGramos, cantidadKilos,
          ]);
        }

        logger.info(`Masa ${masaId}: ${componentesConsolidados.length} ingredientes consolidados desde BOM`);
      } else {
        logger.warn(`Masa ${masaId}: No se encontró BOM local para ningún producto. Ejecute sincronizar-bom primero.`);
      }

      // ── 5. VALIDACIÓN DE LÍMITE DE AMASADORA ─────────────────────
      const totalKgIngredientes = componentesConsolidados.reduce(
        (sum, [, comp]) => sum + comp.cantidad, 0
      );
      const limiteKg = getLimiteKg(masa.tipo_masa);

      logger.info(`Masa ${masaId} (${masa.tipo_masa}): ${totalKgIngredientes.toFixed(2)} kg | Límite: ${limiteKg} kg`);

      if (totalKgIngredientes > limiteKg) {
        logger.info(`Masa ${masaId} supera el límite. Iniciando subdivisión automática en 2 tandas.`);

        // ── 5a. Marcar la masa original como subdividida y cancelada ─
        await db.query(`
          UPDATE masas_produccion
          SET fue_subdividida = TRUE, estado = 'CANCELADA', updated_at = NOW()
          WHERE id = $1
        `, [masaId]);

        // Completar PLANIFICACION de la masa original
        await fasesModel.updateEstadoFase(masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, datos);

        const kgPorTanda     = parseFloat((totalKgIngredientes / 2).toFixed(3));
        const baseKilosBase  = parseFloat((parseFloat(masa.total_kilos_base) / 2).toFixed(3));
        const baseKilosMerma = parseFloat((parseFloat(masa.total_kilos_con_merma) / 2).toFixed(3));
        const fechaStr = masa.fecha_produccion instanceof Date
          ? masa.fecha_produccion.toISOString().split('T')[0]
          : masa.fecha_produccion;

        // ── 5b. Crear sub-masa A ──────────────────────────────────────
        const masaAResult = await db.query(`
          INSERT INTO masas_produccion
            (codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
             total_kilos_base, total_kilos_con_merma, porcentaje_merma,
             factor_absorcion_usado, estado, fase_actual,
             masa_padre_id, es_subdivision, subdivision_letra,
             created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PLANIFICACION','PLANIFICACION',$9,TRUE,'A',$10)
          RETURNING *
        `, [
          `${masa.codigo_masa}-A`,
          masa.tipo_masa,
          `${masa.nombre_masa} (Tanda A)`,
          fechaStr,
          baseKilosBase,
          baseKilosMerma,
          masa.porcentaje_merma,
          masa.factor_absorcion_usado,
          masaId,
          masa.created_by,
        ]);
        const masaA = masaAResult.rows[0];

        // ── 5c. Crear sub-masa B ──────────────────────────────────────
        const masaBResult = await db.query(`
          INSERT INTO masas_produccion
            (codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
             total_kilos_base, total_kilos_con_merma, porcentaje_merma,
             factor_absorcion_usado, estado, fase_actual,
             masa_padre_id, es_subdivision, subdivision_letra,
             created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PLANIFICACION','PLANIFICACION',$9,TRUE,'B',$10)
          RETURNING *
        `, [
          `${masa.codigo_masa}-B`,
          masa.tipo_masa,
          `${masa.nombre_masa} (Tanda B)`,
          fechaStr,
          baseKilosBase,
          baseKilosMerma,
          masa.porcentaje_merma,
          masa.factor_absorcion_usado,
          masaId,
          masa.created_by,
        ]);
        const masaB = masaBResult.rows[0];

        // ── 5d. Inicializar fases de A y B ────────────────────────────
        await inicializarFasesMasa(masaA.id, req.user.id);
        await inicializarFasesMasa(masaB.id, req.user.id);

        // ── 5e. Distribuir ingredientes 50/50 ─────────────────────────
        const ingredientesResult = await db.query(
          `SELECT * FROM ingredientes_masa WHERE masa_id = $1 ORDER BY orden_visualizacion`,
          [masaId]
        );
        await distribuirIngredientes(ingredientesResult.rows, masaA.id, masaB.id);

        // ── 5f. Distribuir productos según reglas de negocio ──────────
        const todosProductos = await db.query(
          `SELECT * FROM productos_por_masa WHERE masa_id = $1`,
          [masaId]
        );
        await distribuirProductos(todosProductos.rows, limiteKg, masaA.id, masaB.id);

        // ── 5g. Copiar relación orden-masa a las sub-masas ────────────
        const ordenesResult = await db.query(
          `SELECT orden_sap_docentry, orden_sap_docnum FROM orden_masa_relacion WHERE masa_id = $1`,
          [masaId]
        );
        for (const orden of ordenesResult.rows) {
          await db.query(
            `INSERT INTO orden_masa_relacion (masa_id, orden_sap_docentry, orden_sap_docnum)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [masaA.id, orden.orden_sap_docentry, orden.orden_sap_docnum]
          );
          await db.query(
            `INSERT INTO orden_masa_relacion (masa_id, orden_sap_docentry, orden_sap_docnum)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [masaB.id, orden.orden_sap_docentry, orden.orden_sap_docnum]
          );
        }

        logger.info(`Subdivisión completada: Masa ${masaId} → ${masaA.codigo_masa} y ${masaB.codigo_masa}`);

        subdivision = {
          realizada:     true,
          motivo:        `Masa supera el límite de ${limiteKg} kg para tipo ${masa.tipo_masa} (total: ${totalKgIngredientes.toFixed(2)} kg)`,
          limite_kg:     limiteKg,
          total_kg:      parseFloat(totalKgIngredientes.toFixed(3)),
          kg_por_tanda:  kgPorTanda,
          masa_padre_id: parseInt(masaId),
          sub_masas: [
            { id: masaA.id, codigo: masaA.codigo_masa, letra: 'A' },
            { id: masaB.id, codigo: masaB.codigo_masa, letra: 'B' },
          ],
        };

        return res.json({
          success: true,
          message: `La masa superaba el límite de ${limiteKg} kg. Se dividió automáticamente en 2 tandas.`,
          subdivision,
          ingredientes_generados: componentesConsolidados.length,
        });
      }
      // ── Fin validación límite ─────────────────────────────────────
    }

    // ── Flujo estándar (sin subdivisión) ───────────────────────────
    const faseActualizada = await fasesModel.updateEstadoFase(
      masaId, fase.toUpperCase(), 'COMPLETADA', 100, req.user.id, datos
    );

    const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, fase.toUpperCase());

    res.json({
      success: true,
      data: faseActualizada,
      siguiente_fase: siguienteFase,
      message: 'Fase completada exitosamente',
      subdivision: null,
      ingredientes_generados: fase.toUpperCase() === 'PLANIFICACION'
        ? Object.keys(acumulado).length
        : undefined,
    });

  } catch (error) {
    logger.error('Error al completar fase:', error);
    next(error);
  }
};

module.exports = {
  getProgresoFases,
  updateProgreso,
  completarFase,
};
