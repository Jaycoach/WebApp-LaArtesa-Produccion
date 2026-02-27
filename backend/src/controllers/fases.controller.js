/**
 * Controlador para gestión de fases de producción
 *
 * CAMBIOS v3 (2026-02-26):
 *  - Clasificación de componentes BOM por UoM e ItemsGroupCode:
 *      Kg / null(PRODPROC) → ingrediente de masa, suma al límite de amasadora
 *      L                   → líquido (agua): 1L = 1Kg para el límite
 *      Und / R / grupo 182 → empaque, va a tabla empaque_por_masa, NO suma al límite
 *  - Al consolidar PLANIFICACION se insertan ingredientes en ingredientes_masa
 *    y materiales de empaque en empaque_por_masa (tabla separada)
 *  - totalKgIngredientes solo suma componentes con peso real
 */

const fasesModel = require('../models/fases.model');
const logger     = require('../utils/logger');
const db         = require('../database/connection');

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const LIMITE_KG_TOSCANO  = 130;
const LIMITE_KG_DEFAULT  = 90;
const GRUPO_SAP_EMPAQUE  = 182;   // ItemsGroupCode de materiales de empaque en SAP

// UoM que tienen peso real y deben sumarse al límite de amasadora
const UOM_CON_PESO = ['kg', 'kgs', 'kilogramo', 'kilogramos'];
// UoM de líquidos: se convierten 1:1 a kg (solo agua tiene densidad ≈ 1)
const UOM_LIQUIDO  = ['l', 'lt', 'litro', 'litros', 'ltr'];
// UoM sin peso: empaque y unidades contables
const UOM_SIN_PESO = ['und', 'unidad', 'unidades', 'r', 'rollo', 'rollos', 'paq', 'paquete'];

/**
 * Clasifica un componente BOM según su UoM y grupo SAP.
 * Retorna: 'peso' | 'liquido' | 'empaque'
 */
function clasificarComponente(uom, grupoSap) {
  // Grupo SAP 182 = empaque, sin importar UoM
  if (grupoSap === GRUPO_SAP_EMPAQUE) return 'empaque';

  if (!uom) {
    // Sin UoM → generalmente prefermento (PRODPROC), tratamos como peso
    return 'peso';
  }

  const uomNorm = uom.toLowerCase().trim();

  if (UOM_CON_PESO.includes(uomNorm))  return 'peso';
  if (UOM_LIQUIDO.includes(uomNorm))   return 'liquido';
  if (UOM_SIN_PESO.includes(uomNorm))  return 'empaque';

  // Por defecto: si no reconocemos la UoM y no es empaque, tratamos como peso
  // y logueamos para revisión
  logger.warn(`clasificarComponente: UoM desconocida "${uom}" para grupo ${grupoSap}. Tratando como peso.`);
  return 'peso';
}

/**
 * Devuelve el límite en kg según el tipo de masa.
 */
function getLimiteKg(tipo_masa) {
  if (!tipo_masa) return LIMITE_KG_DEFAULT;
  return tipo_masa.toUpperCase() === 'TOSCANO' ? LIMITE_KG_TOSCANO : LIMITE_KG_DEFAULT;
}

/**
 * Calcula el número mínimo de tandas para no superar el límite.
 * Ejemplo: 250 kg / 90 kg → CEIL(2.77) = 3 tandas de ~83.3 kg cada una.
 */
function calcularNTandas(totalKg, limiteKg) {
  return Math.ceil(totalKg / limiteKg);
}

/**
 * Inicializa las fases de una masa recién creada.
 * PLANIFICACION → COMPLETADA, PESAJE → EN_PROGRESO, resto → BLOQUEADA.
 *
 * FIX v2: fechas como parámetros $6/$7 independientes — elimina CASE WHEN con $3
 * que causaba "inconsistent types deduced for parameter $3" en PostgreSQL.
 */
async function inicializarFasesMasa(masaId, userId) {
  const fases = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];

  for (const fase of fases) {
    const estado      = fase === 'PLANIFICACION' ? 'COMPLETADA'
                      : fase === 'PESAJE'        ? 'EN_PROGRESO'
                      : 'BLOQUEADA';
    const porcentaje  = fase === 'PLANIFICACION' ? 100 : 0;
    const fechaInicio = (estado === 'EN_PROGRESO' || estado === 'COMPLETADA') ? new Date() : null;
    const fechaFin    = estado === 'COMPLETADA' ? new Date() : null;

    await db.query(`
      INSERT INTO progreso_fases
        (masa_id, fase, estado, porcentaje_completado, usuario_responsable,
         fecha_inicio, fecha_completado)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (masa_id, fase) DO NOTHING
    `, [masaId, fase, estado, porcentaje, userId, fechaInicio, fechaFin]);
  }
}

/**
 * Distribuye ingredientes en N partes iguales entre las sub-masas.
 * La última tanda absorbe el sobrante de redondeo.
 *
 * @param {Array}    ingredientes - Filas de ingredientes_masa de la masa original
 * @param {number[]} subMasaIds   - IDs de las sub-masas [A, B, C, ...]
 */
async function distribuirIngredientes(ingredientes, subMasaIds) {
  const n = subMasaIds.length;

  const insertSQL = `
    INSERT INTO ingredientes_masa
      (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
       porcentaje_panadero, es_harina, es_agua, es_prefermento,
       uom, es_empaque,
       cantidad_gramos, cantidad_kilos,
       disponible, verificado, pesado)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,false,false)
  `;

  for (const ing of ingredientes) {
    const kgTotal = parseFloat(ing.cantidad_kilos);
    const gTotal  = parseFloat(ing.cantidad_gramos);
    const kgBase  = parseFloat((kgTotal / n).toFixed(3));
    const gBase   = parseFloat((gTotal  / n).toFixed(2));

    let kgAcum = 0;
    let gAcum  = 0;

    for (let i = 0; i < n; i++) {
      let kgTanda, gTanda;

      if (i === n - 1) {
        kgTanda = parseFloat((kgTotal - kgAcum).toFixed(3));
        gTanda  = parseFloat((gTotal  - gAcum).toFixed(2));
      } else {
        kgTanda = kgBase;
        gTanda  = gBase;
      }

      kgAcum = parseFloat((kgAcum + kgTanda).toFixed(3));
      gAcum  = parseFloat((gAcum  + gTanda).toFixed(2));

      await db.query(insertSQL, [
        subMasaIds[i],
        ing.ingrediente_sap_code,
        ing.ingrediente_nombre,
        ing.orden_visualizacion,
        ing.porcentaje_panadero,
        ing.es_harina,
        ing.es_agua,
        ing.es_prefermento,
        ing.uom     || null,
        ing.es_empaque || false,
        gTanda,
        kgTanda,
      ]);
    }
  }
}

/**
 * Distribuye materiales de empaque en N copias iguales (una por sub-masa).
 * La cantidad de unidades se divide proporcionalmente entre las tandas.
 *
 * @param {Array}    empaques    - Filas de empaque_por_masa de la masa original
 * @param {number[]} subMasaIds  - IDs de las sub-masas [A, B, C, ...]
 */
async function distribuirEmpaque(empaques, subMasaIds) {
  const n = subMasaIds.length;

  const insertSQL = `
    INSERT INTO empaque_por_masa
      (masa_id, ingrediente_sap_code, ingrediente_nombre, uom,
       cantidad, orden_visualizacion, disponible, verificado)
    VALUES ($1,$2,$3,$4,$5,$6,false,false)
    ON CONFLICT (masa_id, ingrediente_sap_code) DO UPDATE SET
      cantidad = EXCLUDED.cantidad
  `;

  for (const emp of empaques) {
    const cantTotal = parseFloat(emp.cantidad);
    const cantBase  = parseFloat((cantTotal / n).toFixed(4));

    let acum = 0;
    for (let i = 0; i < n; i++) {
      let cantTanda;
      if (i === n - 1) {
        cantTanda = parseFloat((cantTotal - acum).toFixed(4));
      } else {
        cantTanda = cantBase;
      }
      acum = parseFloat((acum + cantTanda).toFixed(4));

      await db.query(insertSQL, [
        subMasaIds[i],
        emp.ingrediente_sap_code,
        emp.ingrediente_nombre,
        emp.uom,
        cantTanda,
        emp.orden_visualizacion,
      ]);
    }
  }
}

/**
 * Distribuye productos entre N sub-masas.
 * Se llena cada tanda hasta el límite en orden A→B→C...
 *
 * @param {Array}    productos   - Filas de productos_por_masa de la masa original
 * @param {number}   limiteKg    - Límite máximo de kg por tanda
 * @param {number[]} subMasaIds  - IDs de las sub-masas [A, B, C, ...]
 */
async function distribuirProductos(productos, limiteKg, subMasaIds) {
  const n        = subMasaIds.length;
  const kgUsados = new Array(n).fill(0);

  for (const prod of productos) {
    let unidadesRestantes    = parseInt(prod.unidades_programadas);
    let unidadesPedRestantes = parseInt(prod.unidades_pedidas);
    let kgPedRestantes       = parseFloat(prod.kilos_pedidos);
    let kgProgRestantes      = parseFloat(prod.kilos_programados);

    const gramaje     = parseFloat(prod.gramaje_unitario);
    const kgPorUnidad = gramaje / 1000;

    for (let i = 0; i < n && unidadesRestantes > 0; i++) {
      const kgDisponible  = limiteKg - kgUsados[i];
      const unidadesMax   = kgPorUnidad > 0
        ? Math.floor(kgDisponible / kgPorUnidad)
        : unidadesRestantes;
      const unidadesTanda = Math.min(unidadesMax, unidadesRestantes);

      if (unidadesTanda <= 0) continue;

      const esUltimo = (unidadesTanda === unidadesRestantes);
      const frac     = unidadesTanda / parseInt(prod.unidades_programadas);

      const kgPedTanda  = esUltimo
        ? parseFloat(kgPedRestantes.toFixed(3))
        : parseFloat((parseFloat(prod.kilos_pedidos) * frac).toFixed(3));
      const kgProgTanda = esUltimo
        ? parseFloat(kgProgRestantes.toFixed(3))
        : parseFloat((parseFloat(prod.kilos_programados) * frac).toFixed(3));
      const unidadesPedTanda = esUltimo
        ? unidadesPedRestantes
        : Math.round(parseInt(prod.unidades_pedidas) * frac);

      await insertarProductoEnMasa(
        subMasaIds[i], prod,
        unidadesTanda, unidadesPedTanda,
        kgPedTanda, kgProgTanda
      );

      kgUsados[i]          = parseFloat((kgUsados[i] + kgProgTanda).toFixed(3));
      unidadesRestantes    -= unidadesTanda;
      unidadesPedRestantes -= unidadesPedTanda;
      kgPedRestantes        = parseFloat((kgPedRestantes  - kgPedTanda).toFixed(3));
      kgProgRestantes       = parseFloat((kgProgRestantes - kgProgTanda).toFixed(3));
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
    const progreso   = await fasesModel.getProgresoFases(masaId);
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

    const fasesValidas   = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'];
    const accionesValidas = ['iniciar', 'actualizar', 'completar'];

    if (!fasesValidas.includes(fase.toUpperCase()))
      return res.status(400).json({ success: false, message: 'Fase inválida' });
    if (!accionesValidas.includes(accion.toLowerCase()))
      return res.status(400).json({ success: false, message: 'Acción inválida' });

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
 *   1. Guarda anti-doble-ejecución (fue_subdividida / es_subdivision)
 *   2. Consolida BOM → clasifica cada componente por UoM y grupo SAP:
 *        - Kg / null(prefermento) → ingredientes_masa, suma al total amasadora
 *        - L (litros)             → ingredientes_masa, 1L = 1Kg para el límite
 *        - Und/R/grupo 182        → empaque_por_masa, NO suma al límite
 *   3. Calcula totalKgIngredientes (solo componentes con peso)
 *   4. Si supera límite → divide en CEIL(total/límite) tandas iguales
 */
const completarFase = async (req, res, next) => {
  try {
    const { masaId, fase } = req.params;
    const datos = req.body;

    let acumuladoPeso   = {};   // componentes que pesan → ingredientes_masa
    let acumuladoEmpaque = {};  // componentes sin peso  → empaque_por_masa
    let subdivision      = null;

    // ── Caso especial: PLANIFICACION ───────────────────────────────
    if (fase.toUpperCase() === 'PLANIFICACION') {

      // 1. Obtener datos de la masa
      const masaResult = await db.query(
        `SELECT id, codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
                total_kilos_base, total_kilos_con_merma, porcentaje_merma,
                factor_absorcion_usado, created_by,
                fue_subdividida, es_subdivision
         FROM masas_produccion WHERE id = $1`,
        [masaId]
      );

      if (masaResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Masa no encontrada' });
      }
      const masa = masaResult.rows[0];

      // ── GUARDA: no re-subdividir ───────────────────────────────────
      if (masa.fue_subdividida) {
        return res.status(409).json({
          success: false,
          message: `La masa ${masa.codigo_masa} ya fue subdividida. No se puede procesar de nuevo.`,
          codigo: 'MASA_YA_SUBDIVIDIDA',
        });
      }

      // ── GUARDA: sub-masas flujo directo ───────────────────────────
      if (masa.es_subdivision) {
        const faseActualizada = await fasesModel.updateEstadoFase(
          masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, datos
        );
        await fasesModel.desbloquearSiguienteFase(masaId, 'PLANIFICACION');
        return res.json({
          success: true,
          data: faseActualizada,
          message: 'Fase completada exitosamente',
          subdivision: null,
        });
      }

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

      // 3. Consolidar BOM clasificando por UoM
      for (const prod of productosResult.rows) {
        const bomResult = await db.query(
          `SELECT item_code_comp, item_name_comp, cantidad,
                  warehouse, issue_method, visual_order,
                  uom, grupo_sap, es_empaque
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
          const cantTotal  = parseFloat(comp.cantidad) * parseFloat(prod.unidades_programadas);
          const tipo       = clasificarComponente(comp.uom, comp.grupo_sap);

          if (tipo === 'empaque') {
            // Acumular en empaque
            if (acumuladoEmpaque[comp.item_code_comp]) {
              acumuladoEmpaque[comp.item_code_comp].cantidad += cantTotal;
            } else {
              acumuladoEmpaque[comp.item_code_comp] = {
                nombre:      comp.item_name_comp,
                cantidad:    cantTotal,
                uom:         comp.uom,
                visualOrder: comp.visual_order,
              };
            }
          } else {
            // tipo 'peso' o 'liquido' → acumular en ingredientes de masa
            // Para líquidos (agua): 1L = 1Kg
            const kgEquivalente = cantTotal; // cantidad ya viene en kg o L (1:1 para agua)

            if (acumuladoPeso[comp.item_code_comp]) {
              acumuladoPeso[comp.item_code_comp].cantidad += kgEquivalente;
            } else {
              acumuladoPeso[comp.item_code_comp] = {
                nombre:      comp.item_name_comp,
                cantidad:    kgEquivalente,
                warehouse:   comp.warehouse,
                issueMethod: comp.issue_method,
                visualOrder: comp.visual_order,
                uom:         comp.uom,
                esLiquido:   tipo === 'liquido',
              };
            }
          }
        }
      }

      // 4. Limpiar e insertar ingredientes consolidados (solo los que pesan)
      const componentesPeso   = Object.entries(acumuladoPeso);
      const componentesEmpaque = Object.entries(acumuladoEmpaque);

      // Limpiar tablas previas
      await db.query(`DELETE FROM ingredientes_masa WHERE masa_id = $1`, [masaId]);
      await db.query(`DELETE FROM empaque_por_masa  WHERE masa_id = $1`, [masaId]);

      // Insertar ingredientes de masa
      for (const [itemCode, comp] of componentesPeso) {
        const nombreLower   = comp.nombre.toLowerCase();
        const esHarina      = nombreLower.includes('harina');
        const esAgua        = comp.esLiquido || nombreLower.includes('agua');
        const esPrefermento = comp.warehouse === 'PRODPROC';
        const cantidadKilos  = comp.cantidad;
        const cantidadGramos = cantidadKilos * 1000;

        await db.query(`
          INSERT INTO ingredientes_masa
            (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
             es_harina, es_agua, es_prefermento,
             uom, es_empaque,
             porcentaje_panadero, cantidad_gramos, cantidad_kilos,
             disponible, verificado, pesado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,0,$9,$10,false,false,false)
        `, [
          masaId, itemCode, comp.nombre, comp.visualOrder,
          esHarina, esAgua, esPrefermento,
          comp.uom,
          cantidadGramos, cantidadKilos,
        ]);
      }

      // Insertar materiales de empaque
      for (const [itemCode, emp] of componentesEmpaque) {
        await db.query(`
          INSERT INTO empaque_por_masa
            (masa_id, ingrediente_sap_code, ingrediente_nombre,
             uom, cantidad, orden_visualizacion, disponible, verificado)
          VALUES ($1,$2,$3,$4,$5,$6,false,false)
          ON CONFLICT (masa_id, ingrediente_sap_code) DO UPDATE SET
            cantidad = EXCLUDED.cantidad
        `, [
          masaId, itemCode, emp.nombre,
          emp.uom, emp.cantidad, emp.visualOrder,
        ]);
      }

      logger.info(`Masa ${masaId}: ${componentesPeso.length} ingredientes de masa + ${componentesEmpaque.length} materiales de empaque consolidados`);

      // ── 5. VALIDACIÓN DE LÍMITE (solo ingredientes con peso) ──────
      const totalKgIngredientes = componentesPeso.reduce(
        (sum, [, comp]) => sum + comp.cantidad, 0
      );
      const limiteKg = getLimiteKg(masa.tipo_masa);

      logger.info(`Masa ${masaId} (${masa.tipo_masa}): ${totalKgIngredientes.toFixed(2)} kg de masa | Límite: ${limiteKg} kg`);

      if (totalKgIngredientes > limiteKg) {
        const nTandas = calcularNTandas(totalKgIngredientes, limiteKg);
        logger.info(`Masa ${masaId} supera el límite. Subdividiendo en ${nTandas} tandas.`);

        // Generar letras dinámicamente según las tandas necesarias (A, B, C, ... Z, AA, AB, ...)
        const LETRAS_TANDA = Array.from({ length: nTandas }, (_, i) => {
          if (i < 26) return String.fromCharCode(65 + i); // A-Z
          const first = String.fromCharCode(65 + Math.floor(i / 26) - 1);
          const second = String.fromCharCode(65 + (i % 26));
          return first + second; // AA, AB, AC...
        });

        // 5a. Marcar masa original
        await db.query(`
          UPDATE masas_produccion
          SET fue_subdividida = TRUE, estado = 'SUBDIVIDIDA', updated_at = NOW()
          WHERE id = $1
        `, [masaId]);

        await fasesModel.updateEstadoFase(masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, datos);

        const kgPorTanda     = parseFloat((totalKgIngredientes / nTandas).toFixed(3));
        const baseKilosBase  = parseFloat((parseFloat(masa.total_kilos_base)      / nTandas).toFixed(3));
        const baseKilosMerma = parseFloat((parseFloat(masa.total_kilos_con_merma) / nTandas).toFixed(3));
        const fechaStr       = masa.fecha_produccion instanceof Date
          ? masa.fecha_produccion.toISOString().split('T')[0]
          : masa.fecha_produccion;

        // 5b. Crear N sub-masas
        const subMasas   = [];
        const subMasaIds = [];

        for (let i = 0; i < nTandas; i++) {
          const letra  = LETRAS_TANDA[i];
          const result = await db.query(`
            INSERT INTO masas_produccion
              (codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
               total_kilos_base, total_kilos_con_merma, porcentaje_merma,
               factor_absorcion_usado, estado, fase_actual,
               masa_padre_id, es_subdivision, subdivision_letra, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PLANIFICACION','PLANIFICACION',$9,TRUE,$10,$11)
            RETURNING *
          `, [
            `${masa.codigo_masa}-${letra}`,
            masa.tipo_masa,
            `${masa.nombre_masa} (Tanda ${letra})`,
            fechaStr,
            baseKilosBase,
            baseKilosMerma,
            masa.porcentaje_merma,
            masa.factor_absorcion_usado,
            masaId,
            letra,
            masa.created_by,
          ]);

          const subMasa = result.rows[0];
          subMasas.push(subMasa);
          subMasaIds.push(subMasa.id);
          logger.info(`Sub-masa creada: ${subMasa.codigo_masa} (id=${subMasa.id})`);
        }

        // 5c. Inicializar fases
        for (const subMasa of subMasas) {
          await inicializarFasesMasa(subMasa.id, req.user.id);
        }

        // 5d. Distribuir ingredientes de masa (solo los que pesan)
        const ingredientesResult = await db.query(
          `SELECT * FROM ingredientes_masa WHERE masa_id = $1 ORDER BY orden_visualizacion`,
          [masaId]
        );
        await distribuirIngredientes(ingredientesResult.rows, subMasaIds);

        // 5e. Distribuir empaque proporcionalmente
        const empaqueResult = await db.query(
          `SELECT * FROM empaque_por_masa WHERE masa_id = $1 ORDER BY orden_visualizacion`,
          [masaId]
        );
        await distribuirEmpaque(empaqueResult.rows, subMasaIds);

        // 5f. Distribuir productos
        const todosProductos = await db.query(
          `SELECT * FROM productos_por_masa WHERE masa_id = $1`,
          [masaId]
        );
        await distribuirProductos(todosProductos.rows, limiteKg, subMasaIds);

        // 5g. Copiar relaciones orden-masa
        const ordenesResult = await db.query(
          `SELECT orden_sap_docentry, orden_sap_docnum FROM orden_masa_relacion WHERE masa_id = $1`,
          [masaId]
        );
        for (const orden of ordenesResult.rows) {
          for (const subMasaId of subMasaIds) {
            await db.query(
              `INSERT INTO orden_masa_relacion (masa_id, orden_sap_docentry, orden_sap_docnum)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [subMasaId, orden.orden_sap_docentry, orden.orden_sap_docnum]
            );
          }
        }

        logger.info(`Subdivisión completada: Masa ${masaId} → ${subMasas.map(s => s.codigo_masa).join(', ')}`);

        subdivision = {
          realizada:     true,
          motivo:        `Masa supera el límite de ${limiteKg} kg para tipo ${masa.tipo_masa} (total ingredientes: ${totalKgIngredientes.toFixed(2)} kg)`,
          limite_kg:     limiteKg,
          total_kg:      parseFloat(totalKgIngredientes.toFixed(3)),
          n_tandas:      nTandas,
          kg_por_tanda:  kgPorTanda,
          masa_padre_id: parseInt(masaId),
          sub_masas:     subMasas.map((s, i) => ({
            id:     s.id,
            codigo: s.codigo_masa,
            letra:  LETRAS_TANDA[i],
          })),
        };

        return res.json({
          success: true,
          message: `La masa superaba el límite de ${limiteKg} kg. Se dividió en ${nTandas} tandas de ~${kgPorTanda.toFixed(2)} kg cada una.`,
          subdivision,
          ingredientes_generados: componentesPeso.length,
          empaque_separado:       componentesEmpaque.length,
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
        ? Object.keys(acumuladoPeso).length
        : undefined,
      empaque_separado: fase.toUpperCase() === 'PLANIFICACION'
        ? Object.keys(acumuladoEmpaque).length
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
