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
 *
 * CAMBIOS v4 (2026-02-27):
 *  - La subdivisión de masas se mueve al confirmarPesaje (pesaje.controller.js)
 *  - Al completar PLANIFICACION solo se consolidan BOM e ingredientes,
 *    pero NO se subdivide. La subdivisión ocurre después del pesaje para que
 *    las sub-masas hereden los pesos reales registrados por el operario.
 *  - Se exporta ejecutarSubdivision() para uso desde pesaje.controller.js
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
  if (grupoSap === GRUPO_SAP_EMPAQUE) return 'empaque';

  if (!uom) {
    return 'peso';
  }

  const uomNorm = uom.toLowerCase().trim();

  if (UOM_CON_PESO.includes(uomNorm))  return 'peso';
  if (UOM_LIQUIDO.includes(uomNorm))   return 'liquido';
  if (UOM_SIN_PESO.includes(uomNorm))  return 'empaque';

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
 */
function calcularNTandas(totalKg, limiteKg) {
  return Math.ceil(totalKg / limiteKg);
}

/**
 * Genera las letras de tanda: A, B, C... Z, AA, AB...
 */
function generarLetrasTanda(n) {
  return Array.from({ length: n }, (_, i) => {
    if (i < 26) return String.fromCharCode(65 + i);
    const first  = String.fromCharCode(65 + Math.floor(i / 26) - 1);
    const second = String.fromCharCode(65 + (i % 26));
    return first + second;
  });
}

/**
 * Inicializa las fases de una masa recién creada.
 * PLANIFICACION → COMPLETADA, PESAJE → EN_PROGRESO, resto → BLOQUEADA.
 */
async function inicializarFasesMasa(masaId, userId, qr = db) {
  const fases = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO', 'EMPAQUE'];

  for (const fase of fases) {
    const estado      = fase === 'PLANIFICACION' ? 'COMPLETADA'
                      : fase === 'PESAJE'        ? 'EN_PROGRESO'
                      : 'BLOQUEADA';
    const porcentaje  = fase === 'PLANIFICACION' ? 100 : 0;
    const fechaInicio = (estado === 'EN_PROGRESO' || estado === 'COMPLETADA') ? new Date() : null;
    const fechaFin    = estado === 'COMPLETADA' ? new Date() : null;

    await qr.query(`
      INSERT INTO progreso_fases
        (masa_id, fase, estado, porcentaje_completado, usuario_responsable,
         fecha_inicio, fecha_completado)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (masa_id, fase) DO NOTHING
    `, [masaId, fase, estado, porcentaje, userId, fechaInicio, fechaFin]);
  }
}

/**
 * Inicializa las fases de una sub-masa que ya tiene el pesaje completo.
 * PLANIFICACION → COMPLETADA, PESAJE → COMPLETADA, AMASADO → EN_PROGRESO, resto → BLOQUEADA.
 */
async function inicializarFasesMasaConPesaje(masaId, userId, qr = db) {
  const fases = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO', 'EMPAQUE'];

  for (const fase of fases) {
    const estado = fase === 'PLANIFICACION' ? 'COMPLETADA'
                 : fase === 'PESAJE'        ? 'COMPLETADA'
                 : fase === 'AMASADO'       ? 'EN_PROGRESO'
                 : 'BLOQUEADA';
    const porcentaje  = (estado === 'COMPLETADA') ? 100 : 0;
    const fechaInicio = (estado === 'EN_PROGRESO' || estado === 'COMPLETADA') ? new Date() : null;
    const fechaFin    = estado === 'COMPLETADA' ? new Date() : null;

    await qr.query(`
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
 * Copia los datos de pesaje real (peso_real, lote, fecha_vencimiento, disponible, verificado, pesado).
 * La última tanda absorbe el sobrante de redondeo.
 *
 * @param {Array}    ingredientes     - Filas de ingredientes_masa de la masa original
 * @param {number[]} subMasaIds       - IDs de las sub-masas [A, B, C, ...]
 * @param {boolean}  copiarPesaje     - Si true copia los campos de pesaje real proporcionalmente
 */
async function distribuirIngredientes(ingredientes, subMasaIds, copiarPesaje = false, qr = db) {
  const n = subMasaIds.length;

  for (const ing of ingredientes) {
    const kgTotal = parseFloat(ing.cantidad_kilos);
    const gTotal  = parseFloat(ing.cantidad_gramos);
    const kgBase  = parseFloat((kgTotal / n).toFixed(3));
    const gBase   = parseFloat((gTotal  / n).toFixed(2));

    // Si hay peso real registrado, distribuirlo también
    const pesoRealTotal = ing.peso_real != null ? parseFloat(ing.peso_real) : null;
    const pesoRealBase  = pesoRealTotal != null
      ? parseFloat((pesoRealTotal / n).toFixed(3))
      : null;

    let kgAcum       = 0;
    let gAcum        = 0;
    let pesoRealAcum = 0;

    for (let i = 0; i < n; i++) {
      let kgTanda, gTanda, pesoRealTanda;

      if (i === n - 1) {
        kgTanda = parseFloat((kgTotal - kgAcum).toFixed(3));
        gTanda  = parseFloat((gTotal  - gAcum).toFixed(2));
        pesoRealTanda = pesoRealTotal != null
          ? parseFloat((pesoRealTotal - pesoRealAcum).toFixed(3))
          : null;
      } else {
        kgTanda = kgBase;
        gTanda  = gBase;
        pesoRealTanda = pesoRealBase;
      }

      kgAcum       = parseFloat((kgAcum + kgTanda).toFixed(3));
      gAcum        = parseFloat((gAcum  + gTanda).toFixed(2));
      if (pesoRealTanda != null) {
        pesoRealAcum = parseFloat((pesoRealAcum + pesoRealTanda).toFixed(3));
      }

      // Si copiamos pesaje: los campos de checklist se marcan completos
      const disponible = copiarPesaje ? (ing.disponible || false) : false;
      const verificado = copiarPesaje ? (ing.verificado || false) : false;
      const pesado     = copiarPesaje ? (ing.pesado     || false) : false;
      const pesoFinal  = copiarPesaje ? pesoRealTanda : null;
      const lote       = copiarPesaje ? (ing.lote       || null) : null;
      const fechaVenc  = copiarPesaje ? (ing.fecha_vencimiento || null) : null;

      await qr.query(`
        INSERT INTO ingredientes_masa
          (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
           porcentaje_panadero, es_harina, es_agua, es_prefermento,
           uom, es_empaque,
           cantidad_gramos, cantidad_kilos,
           disponible, verificado, pesado,
           peso_real, lote, fecha_vencimiento)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `, [
        subMasaIds[i],
        ing.ingrediente_sap_code,
        ing.ingrediente_nombre,
        ing.orden_visualizacion,
        ing.porcentaje_panadero,
        ing.es_harina,
        ing.es_agua,
        ing.es_prefermento,
        ing.uom         || null,
        ing.es_empaque  || false,
        gTanda,
        kgTanda,
        disponible,
        verificado,
        pesado,
        pesoFinal,
        lote,
        fechaVenc,
      ]);
    }
  }
}

/**
 * Distribuye materiales de empaque en N copias iguales (una por sub-masa).
 */
async function distribuirEmpaque(empaques, subMasaIds, qr = db) {
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

      await qr.query(insertSQL, [
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
 * Distribuye productos entre N sub-masas proporcionalmente.
 * Cada sub-masa recibe 1/N de cada producto (distribución uniforme por tanda).
 * La última tanda absorbe los residuos de redondeo.
 */
async function distribuirProductos(productos, limiteKg, subMasaIds, qr = db) {
  const n = subMasaIds.length;
  for (const prod of productos) {
    const totalUnidadesProg = parseInt(prod.unidades_programadas);
    const totalUnidadesPed  = parseInt(prod.unidades_pedidas);
    const totalKgPed        = parseFloat(prod.kilos_pedidos);
    const totalKgProg       = parseFloat(prod.kilos_programados);

    let unidadesProgRestantes = totalUnidadesProg;
    let unidadesPedRestantes  = totalUnidadesPed;
    let kgPedRestantes        = totalKgPed;
    let kgProgRestantes       = totalKgProg;

    // Unidades base por tanda (piso) — la última absorbe el residuo
    const unidadesProgBase = Math.floor(totalUnidadesProg / n);
    const unidadesPedBase  = Math.floor(totalUnidadesPed  / n);

    for (let i = 0; i < n; i++) {
      const esUltima = (i === n - 1);

      const unidadesProg = esUltima ? unidadesProgRestantes : unidadesProgBase;
      const unidadesPed  = esUltima ? unidadesPedRestantes  : unidadesPedBase;

      // Kg proporcional a las unidades de esta tanda
      const frac = unidadesProg / totalUnidadesProg;
      const kgPed  = esUltima
        ? parseFloat(kgPedRestantes.toFixed(3))
        : parseFloat((totalKgPed  * frac).toFixed(3));
      const kgProg = esUltima
        ? parseFloat(kgProgRestantes.toFixed(3))
        : parseFloat((totalKgProg * frac).toFixed(3));

      // Solo insertar si hay al menos 1 unidad para esta tanda
      if (unidadesProg > 0) {
        await insertarProductoEnMasa(
          subMasaIds[i], prod,
          unidadesProg, unidadesPed,
          kgPed, kgProg,
          qr
        );
      }

      unidadesProgRestantes -= unidadesProg;
      unidadesPedRestantes  -= unidadesPed;
      kgPedRestantes         = parseFloat((kgPedRestantes  - kgPed).toFixed(3));
      kgProgRestantes        = parseFloat((kgProgRestantes - kgProg).toFixed(3));
    }
  }
}

/**
 * Inserta un producto en una sub-masa con las cantidades indicadas.
 */
async function insertarProductoEnMasa(masaId, prod, unidadesProg, unidadesPedidas, kgPedidos, kgProgramados, qr = db) {
  const upq = (prod.unidades_por_paquete && parseFloat(prod.unidades_por_paquete) > 1)
    ? parseFloat(prod.unidades_por_paquete)
    : (() => { const m = (prod.producto_nombre || '').match(/ X ?(\d+)/i); return m ? parseInt(m[1]) : 1; })();
  const cantPaquetes = unidadesProg;

  await qr.query(`
    INSERT INTO productos_por_masa
      (masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
       unidades_pedidas, unidades_programadas, unidades_producidas,
       kilos_pedidos, kilos_programados, kilos_producidos,
       sap_item_code, unidades_por_paquete, cantidad_paquetes, delta_ajuste)
    VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,0,$10,$11,$12,$13)
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
    upq,
    cantPaquetes,
    unidadesProg > unidadesPedidas ? unidadesProg - unidadesPedidas : 0,
  ]);
}

/**
 * Ejecuta la subdivisión de una masa en N tandas.
 * Llamado desde pesaje.controller.js al confirmar el pesaje si la masa supera el límite.
 *
 * @param {number}  masaId    - ID de la masa original
 * @param {object}  userId    - ID del usuario autenticado
 * @param {boolean} conPesaje - Si true, las sub-masas heredan el pesaje completo
 * @returns {object|null}     - Información de la subdivisión, o null si no aplica
 */
async function ejecutarSubdivision(masaId, userId, conPesaje = false) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const resultado = await _ejecutarSubdivisionTx(client, masaId, userId, conPesaje);
    // Siempre cerrar la transacción — COMMIT si hubo subdivisión, ROLLBACK si no aplica
    if (resultado) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`ejecutarSubdivision ROLLBACK masa ${masaId}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function _ejecutarSubdivisionTx(client, masaId, userId, conPesaje = false) {
  const masaResult = await client.query(
    `SELECT id, codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
            total_kilos_base, total_kilos_con_merma, porcentaje_merma,
            factor_absorcion_usado, created_by,
            fue_subdividida, es_subdivision,
            aprobado_por, aprobado_en
     FROM masas_produccion WHERE id = $1`,
    [masaId]
  );

  if (masaResult.rows.length === 0) {
    throw new Error(`Masa ${masaId} no encontrada`);
  }
  const masa = masaResult.rows[0];

  if (masa.fue_subdividida) {
    logger.warn(`Masa ${masaId} ya fue subdividida, omitiendo.`);
    return null;
  }

  // Calcular total kg de ingredientes — excluir empaque (Und/R no tienen peso real)
  const ingResult = await client.query(
    `SELECT SUM(cantidad_kilos) AS total_kg FROM ingredientes_masa WHERE masa_id = $1 AND es_empaque = false`,
    [masaId]
  );
  const totalKgIngredientes = parseFloat(ingResult.rows[0].total_kg || 0);
  const limiteKg = getLimiteKg(masa.tipo_masa);

  if (totalKgIngredientes <= limiteKg) {
    logger.info(`Masa ${masaId}: ${totalKgIngredientes.toFixed(2)} kg ≤ ${limiteKg} kg, sin subdivisión.`);
    return null;
  }

  const nTandas      = calcularNTandas(totalKgIngredientes, limiteKg);
  const LETRAS_TANDA = generarLetrasTanda(nTandas);

  logger.info(`Masa ${masaId} supera el límite (${totalKgIngredientes.toFixed(2)} kg > ${limiteKg} kg). Subdividiendo en ${nTandas} tandas.`);

  // Marcar masa original como subdividida
  await client.query(`
    UPDATE masas_produccion
    SET fue_subdividida = TRUE, estado = 'SUBDIVIDIDA', updated_at = NOW()
    WHERE id = $1
  `, [masaId]);

  const kgPorTanda     = parseFloat((totalKgIngredientes / nTandas).toFixed(3));
  const baseKilosBase  = parseFloat((parseFloat(masa.total_kilos_base)      / nTandas).toFixed(3));
  const baseKilosMerma = parseFloat((parseFloat(masa.total_kilos_con_merma) / nTandas).toFixed(3));
  const fechaStr       = masa.fecha_produccion instanceof Date
    ? masa.fecha_produccion.toISOString().split('T')[0]
    : masa.fecha_produccion;

  // El estado de la sub-masa depende de si ya viene con pesaje.
  // Cuando conPesaje=true: PESAJE ya está completado, la sub-masa arranca en AMASADO.
  // Valores válidos según constraint check_estado_masa de la BD.
  const estadoSubMasa     = conPesaje ? 'AMASADO'      : 'PLANIFICACION';
  const faseActualSubMasa = conPesaje ? 'AMASADO'      : 'PLANIFICACION';

  // Crear sub-masas
  const subMasas   = [];
  const subMasaIds = [];

  for (let i = 0; i < nTandas; i++) {
    const letra  = LETRAS_TANDA[i];
    const result = await client.query(`
      INSERT INTO masas_produccion
        (codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
         total_kilos_base, total_kilos_con_merma, porcentaje_merma,
         factor_absorcion_usado, estado, fase_actual,
         masa_padre_id, es_subdivision, subdivision_letra, created_by,
         aprobado_por, aprobado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14,$15)
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
      estadoSubMasa,
      faseActualSubMasa,
      masaId,
      letra,
      masa.created_by,
      masa.aprobado_por || null,
      masa.aprobado_en  || null,
    ]);

    const subMasa = result.rows[0];
    subMasas.push(subMasa);
    subMasaIds.push(subMasa.id);
    logger.info(`Sub-masa creada: ${subMasa.codigo_masa} (id=${subMasa.id})`);
  }

  // Inicializar fases de las sub-masas
  for (const subMasa of subMasas) {
    if (conPesaje) {
      await inicializarFasesMasaConPesaje(subMasa.id, userId, client);
    } else {
      await inicializarFasesMasa(subMasa.id, userId, client);
    }
  }

  // Distribuir ingredientes MP (excluir empaque — no se divide en fracciones)
  const ingredientesResult = await client.query(
    `SELECT * FROM ingredientes_masa WHERE masa_id = $1 AND es_empaque = false ORDER BY orden_visualizacion`,
    [masaId]
  );
  await distribuirIngredientes(ingredientesResult.rows, subMasaIds, conPesaje, client);

  // Distribuir productos primero — necesario para que productos_por_masa de sub-masas exista
  const todosProductos = await client.query(
    `SELECT * FROM productos_por_masa WHERE masa_id = $1`,
    [masaId]
  );
  await distribuirProductos(todosProductos.rows, limiteKg, subMasaIds, client);

  // Distribuir empaque proporcional a unidades_programadas de cada sub-masa
  // Cada sub-masa puede tener distinto número de paquetes (ej: 151/151/150/150)
  // El empaque BOM está en cantidad/paquete → multiplicar por unidades_programadas de la sub-masa
  const empaqueBase = await client.query(
    `SELECT ingrediente_sap_code, ingrediente_nombre, cantidad_kilos, cantidad_gramos, uom, orden_visualizacion
     FROM ingredientes_masa
     WHERE masa_id = $1 AND es_empaque = true
     ORDER BY orden_visualizacion`,
    [masaId]
  );
  // Usar unidades_pedidas como base BOM (el BOM SAP se calculó sobre pedidos, no sobre programados)
  const prodMadreResult = await client.query(
    `SELECT COALESCE(SUM(unidades_pedidas), 0) AS total_paq FROM productos_por_masa WHERE masa_id = $1`,
    [masaId]
  );
  const totalPaqMadre = parseFloat(prodMadreResult.rows[0].total_paq) || 1;
  // Calcular cantidad BOM por paquete (cantidad_kilos de la madre / total paquetes madre)
  // Esto nos da la cantidad de cada material de empaque por paquete producido
  for (const subMasaId of subMasaIds) {
    const prodSubResult = await client.query(
      `SELECT COALESCE(SUM(unidades_programadas), 0) AS paq FROM productos_por_masa WHERE masa_id = $1`,
      [subMasaId]
    );
    const paqSubMasa = parseFloat(prodSubResult.rows[0].paq) || 0;

    for (const emp of empaqueBase.rows) {
      // cantidad_BOM_por_paquete = cantidad total madre / total paquetes madre
      const cantPorPaquete = emp.cantidad_kilos / totalPaqMadre;
      const gramPorPaquete = emp.cantidad_gramos / totalPaqMadre;
      // cantidad sub-masa = cantidad por paquete × paquetes de esta sub-masa
      const cantSubMasa = parseFloat((cantPorPaquete * paqSubMasa).toFixed(3));
      const gramSubMasa = parseFloat((gramPorPaquete * paqSubMasa).toFixed(2));
      await client.query(`
        INSERT INTO ingredientes_masa
          (masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
           porcentaje_panadero, es_harina, es_agua, es_prefermento,
           uom, es_empaque, cantidad_gramos, cantidad_kilos,
           disponible, verificado, pesado)
        VALUES ($1,$2,$3,$4,0,false,false,false,$5,true,$6,$7,false,false,false)
      `, [
        subMasaId,
        emp.ingrediente_sap_code,
        emp.ingrediente_nombre,
        emp.orden_visualizacion,
        emp.uom,
        gramSubMasa,
        cantSubMasa,
      ]);
    }
  }

  // empaque_por_masa: mantener compatibilidad con flujo alternativo
  const empaqueResult = await client.query(
    `SELECT * FROM empaque_por_masa WHERE masa_id = $1 ORDER BY orden_visualizacion`,
    [masaId]
  );
  await distribuirEmpaque(empaqueResult.rows, subMasaIds, client);

  // Copiar relaciones orden-masa
  const ordenesResult = await client.query(
    `SELECT orden_sap_docentry, orden_sap_docnum FROM orden_masa_relacion WHERE masa_id = $1`,
    [masaId]
  );
  for (const orden of ordenesResult.rows) {
    for (const subMasaId of subMasaIds) {
      await client.query(
        `INSERT INTO orden_masa_relacion (masa_id, orden_sap_docentry, orden_sap_docnum)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [subMasaId, orden.orden_sap_docentry, orden.orden_sap_docnum]
      );
    }
  }

  logger.info(`Subdivisión completada (conPesaje=${conPesaje}): Masa ${masaId} → ${subMasas.map(s => s.codigo_masa).join(', ')}`);

  await client.query('COMMIT');

  return {
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

    const fasesValidas    = ['PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO', 'EMPAQUE'];
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
 *   1. Consolida BOM → clasifica cada componente por UoM y grupo SAP
 *   2. Calcula totalKgIngredientes
 *   3. Si supera límite → la subdivisión YA NO ocurre aquí.
 *      Solo se generan los ingredientes. La subdivisión ocurre al confirmar el PESAJE.
 */
const completarFase = async (req, res, next) => {
  try {
    const { masaId, fase } = req.params;
    const datos = req.body;

    let acumuladoPeso    = {};
    let acumuladoEmpaque = {};

    // ── Caso especial: PLANIFICACION ───────────────────────────────
    if (fase.toUpperCase() === 'PLANIFICACION') {

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

      // Guarda: no re-subdividir
      if (masa.fue_subdividida) {
        return res.status(409).json({
          success: false,
          message: `La masa ${masa.codigo_masa} ya fue subdividida. No se puede procesar de nuevo.`,
          codigo: 'MASA_YA_SUBDIVIDIDA',
        });
      }

      // Guarda: sub-masas flujo directo (ya vienen con pesaje, van directo a completar planificación)
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

      // Obtener productos con sap_item_code
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

      // Consolidar BOM clasificando por UoM
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
          const cantTotal = parseFloat(comp.cantidad) * parseFloat(prod.unidades_programadas);
          const tipo      = clasificarComponente(comp.uom, comp.grupo_sap);

          if (tipo === 'empaque') {
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
            const kgEquivalente = cantTotal;
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

      // Limpiar e insertar ingredientes consolidados
      const componentesPeso    = Object.entries(acumuladoPeso);
      const componentesEmpaque = Object.entries(acumuladoEmpaque);

      await db.query(`DELETE FROM ingredientes_masa WHERE masa_id = $1`, [masaId]);
      await db.query(`DELETE FROM empaque_por_masa  WHERE masa_id = $1`, [masaId]);

      for (const [itemCode, comp] of componentesPeso) {
        const nombreLower    = comp.nombre.toLowerCase();
        const esHarina       = nombreLower.includes('harina');
        const esAgua         = comp.esLiquido || nombreLower.includes('agua');
        const esPrefermento  = comp.warehouse === 'PRODPROC';
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

      const totalKgIngredientes = componentesPeso.reduce((sum, [, comp]) => sum + comp.cantidad, 0);
      const limiteKg = getLimiteKg(masa.tipo_masa);

      logger.info(`Masa ${masaId} (${masa.tipo_masa}): ${totalKgIngredientes.toFixed(2)} kg de masa | Límite: ${limiteKg} kg`);

      // ── CAMBIO v4: Ya NO subdividimos aquí. Solo informamos que habrá subdivisión al confirmar pesaje.
      const necesitaSubdivision = totalKgIngredientes > limiteKg;
      const nTandas = necesitaSubdivision ? calcularNTandas(totalKgIngredientes, limiteKg) : 0;

      // Completar fase PLANIFICACION y desbloquear PESAJE
      const faseActualizada = await fasesModel.updateEstadoFase(
        masaId, 'PLANIFICACION', 'COMPLETADA', 100, req.user.id, datos
      );
      await fasesModel.desbloquearSiguienteFase(masaId, 'PLANIFICACION');

      return res.json({
        success: true,
        data: faseActualizada,
        message: necesitaSubdivision
          ? `Planificación completada. La masa supera ${limiteKg} kg (${totalKgIngredientes.toFixed(2)} kg). Se dividirá en ${nTandas} tandas al confirmar el pesaje.`
          : 'Planificación completada exitosamente.',
        subdivision: null,
        necesita_subdivision: necesitaSubdivision,
        n_tandas_previstas: nTandas,
        ingredientes_generados: componentesPeso.length,
        empaque_separado:       componentesEmpaque.length,
      });
    }

    // ── Caso especial: DIVISION ────────────────────────────────
    if (fase.toUpperCase() === 'DIVISION') {
      const { cantidades_divididas, ...restosDatos } = datos.datos || datos;

      // 1. Obtener productos de la masa con ajuste de múltiplo
      const productosResult = await db.query(
        `SELECT id, producto_nombre, presentacion,
                unidades_pedidas, unidades_programadas, unidades_por_paquete,
                unidades_ajustadas, unidades_excedente,
                multiplo_divisor
         FROM productos_por_masa
         WHERE masa_id = $1
         ORDER BY producto_nombre`,
        [masaId]
      );

      if (productosResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'La masa no tiene productos para dividir.',
        });
      }

      // 2. Validar cantidades_divididas si vienen en el payload
      if (cantidades_divididas && Object.keys(cantidades_divididas).length > 0) {
        const errores = [];

        for (const prod of productosResult.rows) {
          const cantidad  = Number(cantidades_divididas[prod.id] || 0);
          const divisor   = parseInt(prod.multiplo_divisor || 0);
          // Validar contra unidades_ajustadas (que ya es el múltiplo correcto)
          const requerido = parseInt(prod.unidades_ajustadas || prod.unidades_programadas);
          const nombre    = `${prod.producto_nombre}${prod.presentacion ? ' ' + prod.presentacion : ''}`;

          // Validar cantidad mínima
          if (cantidad <= 0) {
            errores.push(`"${nombre}": la cantidad debe ser mayor a 0.`);
            continue;
          }

          // Validar múltiplo divisor si aplica
          if (divisor > 0 && cantidad % divisor !== 0) {
            const inferior = Math.floor(cantidad / divisor) * divisor;
            const superior = inferior + divisor;
            errores.push(
              `"${nombre}": ${cantidad} no es múltiplo de ${divisor}. ` +
              `Valores válidos cercanos: ${inferior} o ${superior}.`
            );
          }
        }

        if (errores.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Cantidades de división inválidas:',
            errores,
          });
        }

        // 3. Guardar cantidades_divididas en productos_por_masa
        //    unidades_excedente_real = cantidad - unidades_pedidas (excedente real cortado)
        for (const prod of productosResult.rows) {
          const cantidad = Number(cantidades_divididas[prod.id] || 0);
          if (cantidad > 0) {
            const requeridoFinal = parseInt(prod.unidades_ajustadas || prod.unidades_programadas);
            const upqDiv = (prod.unidades_por_paquete && parseFloat(prod.unidades_por_paquete) > 1)
              ? parseFloat(prod.unidades_por_paquete)
              : (() => { const m = (prod.producto_nombre || '').match(/ X ?(\d+)/i); return m ? parseInt(m[1]) : 1; })();
            const panesSugeridos  = parseInt(prod.unidades_pedidas) * upqDiv;
            const excedenteReal   = Math.max(0, cantidad - panesSugeridos);
            const faltante        = Math.max(0, requeridoFinal - cantidad);
            const esParcial       = faltante > 0;

            await db.query(
              `UPDATE productos_por_masa
               SET cantidad_divisiones  = $1,
                   division_completada  = TRUE,
                   unidades_excedente   = $2,
                   unidades_faltantes   = $3,
                   division_parcial     = $4,
                   unidades_producidas  = $5,
                   updated_at           = NOW()
               WHERE id = $6`,
              [cantidad, excedenteReal, faltante, esParcial, cantidad, prod.id]
            );
          }
        }

        logger.info(
          `División masa ${masaId}: cantidades guardadas para ${productosResult.rows.length} productos`
        );
      }

      // 4. Completar fase y desbloquear siguiente
      const faseActualizada = await fasesModel.updateEstadoFase(
        masaId, 'DIVISION', 'COMPLETADA', 100, req.user.id,
        { ...(restosDatos || {}), cantidades_divididas }
      );
      const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'DIVISION');

      const hayFaltantes = productosResult.rows.some(p => {
        const cant = Number(cantidades_divididas?.[p.id] || 0);
        const req  = parseInt(p.unidades_ajustadas || p.unidades_programadas);
        return cant < req;
      });

      return res.json({
        success: true,
        data: faseActualizada,
        siguiente_fase: siguienteFase,
        message: hayFaltantes
          ? 'División completada con faltantes. Los pendientes quedan registrados.'
          : 'División completada exitosamente',
        subdivision: null,
      });
    }

    // ── Caso especial: AMASADO ─────────────────────────────────────
    if (fase.toUpperCase() === 'AMASADO') {
      const datosAmasado = datos.datos || datos;
      const {
        amasadora_id,
        velocidad_1_minutos,
        velocidad_2_minutos,
        temperatura_masa_final,
        temperatura_agua,
        observaciones,
      } = datosAmasado;

      await db.query(`
        INSERT INTO registros_amasado
          (masa_id, amasadora_id, amasadora_nombre,
           velocidad_1_minutos, velocidad_2_minutos,
           temperatura_masa_final, temperatura_agua,
           usuario_id, observaciones)
        VALUES (
          $1, $2, (SELECT nombre FROM amasadoras WHERE id = $2),
          $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (masa_id) DO UPDATE SET
          amasadora_id           = EXCLUDED.amasadora_id,
          amasadora_nombre       = EXCLUDED.amasadora_nombre,
          velocidad_1_minutos    = EXCLUDED.velocidad_1_minutos,
          velocidad_2_minutos    = EXCLUDED.velocidad_2_minutos,
          temperatura_masa_final = EXCLUDED.temperatura_masa_final,
          temperatura_agua       = EXCLUDED.temperatura_agua,
          usuario_id             = EXCLUDED.usuario_id,
          observaciones          = EXCLUDED.observaciones,
          updated_at              = NOW()
      `, [
        masaId,
        amasadora_id ? Number(amasadora_id) : null,
        velocidad_1_minutos ? Number(velocidad_1_minutos) : null,
        velocidad_2_minutos ? Number(velocidad_2_minutos) : null,
        temperatura_masa_final ? Number(temperatura_masa_final) : null,
        temperatura_agua ? Number(temperatura_agua) : null,
        req.user.id,
        observaciones || null,
      ]);

      logger.info(`Masa ${masaId}: registro de amasado guardado (amasadora_id=${amasadora_id})`);

      const faseActualizada = await fasesModel.updateEstadoFase(
        masaId, 'AMASADO', 'COMPLETADA', 100, req.user.id, datos
      );
      const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'AMASADO');

      return res.json({
        success: true,
        data: faseActualizada,
        siguiente_fase: siguienteFase,
        message: 'Amasado completado exitosamente',
        subdivision: null,
      });
    }

    // ── Flujo estándar (otras fases) ───────────────────────────────
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
  // Exportado para uso en pesaje.controller.js
  ejecutarSubdivision,
  getLimiteKg,
};
