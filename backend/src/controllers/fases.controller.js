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
 * Prioridad: catalogo_tipos_masa.peso_maximo_division (configurado por Kevin en SAP)
 * > fallback 130kg si es TOSCANO y aún no está cargado > fallback genérico 90kg.
 */
async function getLimiteKg(queryable, tipo_masa) {
  if (!tipo_masa) return LIMITE_KG_DEFAULT;

  const result = await queryable.query(
    `SELECT peso_maximo_division FROM catalogo_tipos_masa WHERE tipo_masa = $1 AND activo = TRUE LIMIT 1`,
    [tipo_masa]
  );
  const pesoConfigurado = result.rows[0]?.peso_maximo_division;
  if (pesoConfigurado != null) return parseFloat(pesoConfigurado);

  return tipo_masa.toUpperCase() === 'TOSCANO' ? LIMITE_KG_TOSCANO : LIMITE_KG_DEFAULT;
}

/**
 * Recalcula y persiste total_kilos_base/total_kilos_con_merma de una masa
 * desde productos_por_masa (misma fórmula que usa /api/masas/:id/composicion).
 * Pura respecto al estado actual de productos_por_masa/porcentaje_merma —
 * llamarla varias veces sin cambios intermedios no acumula, da el mismo resultado.
 * `client` puede ser el pool (`db`) o un client de transacción activa.
 */
async function recalcularTotalesMasa(masaId, client) {
  const totalesResult = await client.query(
    `SELECT COALESCE(SUM(gramaje_unitario * COALESCE(unidades_ajustadas, unidades_programadas)), 0) / 1000.0 AS total_base
     FROM productos_por_masa WHERE masa_id = $1`,
    [masaId]
  );
  const totalKilosBase = parseFloat(totalesResult.rows[0].total_base) || 0;

  const masaResult = await client.query(
    `SELECT porcentaje_merma FROM masas_produccion WHERE id = $1`,
    [masaId]
  );
  const porcentajeMerma = parseFloat(masaResult.rows[0]?.porcentaje_merma) || 0;
  const totalKilosConMerma = totalKilosBase * (1 + porcentajeMerma / 100);

  await client.query(
    `UPDATE masas_produccion
     SET total_kilos_base = $1, total_kilos_con_merma = $2, updated_at = NOW()
     WHERE id = $3`,
    [totalKilosBase, totalKilosConMerma, masaId]
  );

  return { total_kilos_base: totalKilosBase, total_kilos_con_merma: totalKilosConMerma };
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
async function distribuirIngredientes(ingredientes, subMasaIds, fraccionesTanda, copiarPesaje = false, qr = db) {
  const n = subMasaIds.length;

  for (const ing of ingredientes) {
    const kgTotal = parseFloat(ing.cantidad_kilos);
    const gTotal  = parseFloat(ing.cantidad_gramos);
    const pesoRealTotal = ing.peso_real != null ? parseFloat(ing.peso_real) : null;

    let kgAcum       = 0;
    let gAcum        = 0;
    let pesoRealAcum = 0;

    for (let i = 0; i < n; i++) {
      const frac = fraccionesTanda[i];
      let kgTanda, gTanda, pesoRealTanda;

      if (i === n - 1) {
        kgTanda = parseFloat((kgTotal - kgAcum).toFixed(3));
        gTanda  = parseFloat((gTotal  - gAcum).toFixed(2));
        pesoRealTanda = pesoRealTotal != null
          ? parseFloat((pesoRealTotal - pesoRealAcum).toFixed(3))
          : null;
      } else {
        kgTanda = parseFloat((kgTotal * frac).toFixed(3));
        gTanda  = parseFloat((gTotal  * frac).toFixed(2));
        pesoRealTanda = pesoRealTotal != null
          ? parseFloat((pesoRealTotal * frac).toFixed(3))
          : null;
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
 * Clave de agrupación de un producto para el empaquetado por tandas.
 * Jerárquico: tipo_masa → +forma → +tamaño (cada nivel exige el anterior),
 * siempre cerrando con +multiplo_divisor (Fase 4, 12-ago-2026) — dentro de
 * cada nivel de tipo/forma/tamaño, productos con distinto multiplo_divisor
 * van en subgrupos distintos, para que simularAjusteDivisorPorGrupo nunca
 * mezcle divisores distintos en el mismo cálculo de múltiplo.
 * SAP o fallback por nombre resuelven tamaño/forma indistintamente.
 */
function clasificarClaveAgrupacion(producto, tipoMasa) {
  let tamanio = producto.tamanio || null;
  let forma   = producto.forma   || null;
  const nombre = (producto.producto_nombre || '').toUpperCase();

  if (!tamanio) {
    if (/\bGRANDE\b/.test(nombre))             tamanio = 'GRANDE';
    else if (/\bMEDIAN[OA]\b/.test(nombre))    tamanio = 'MEDIANO';
    else if (/\bPEQUE[ÑN]O?A?\b/.test(nombre)) tamanio = 'PEQUEÑO';
    else if (/\bJUNIOR\b|\bJR\b/.test(nombre)) tamanio = 'JUNIOR';
  }

  if (!forma) {
    if (/\bCUADRAD[OA]\b/.test(nombre))       forma = 'CUADRADO';
    else if (/\bREDOND[OA]\b/.test(nombre))   forma = 'REDONDO';
    else if (/\bTRIANGULAR\b/.test(nombre))   forma = 'TRIANGULAR';
    else if (/\bRECTANGULAR\b/.test(nombre))  forma = 'RECTANGULAR';
    else if (/\bOVALAD[OA]\b/.test(nombre))   forma = 'OVALADO';
    else if (/\bALARGAD[OA]\b/.test(nombre))  forma = 'ALARGADO';
  }

  // Jerárquico, de lo general a lo específico: tipo_masa es la base siempre.
  // forma refina dentro del tipo_masa. tamaño solo refina más si YA hay forma
  // (no existe el nivel "tipo_masa + tamaño" sin forma) — un tamaño sin forma
  // conocida no es suficiente para separar el grupo, se queda en el nivel de
  // tipo_masa hasta que se sepa también la forma.
  let clave = `TIPOMASA:${tipoMasa}`;
  if (forma) {
    clave += `|FORMA:${forma}`;
    if (tamanio) {
      clave += `|TAM:${tamanio}`;
    }
  }

  // Fase 4: multiplo_divisor siempre particiona el grupo, sin importar si
  // forma/tamaño se resolvieron — dos productos del mismo tipo_masa con
  // distinto divisor nunca pueden compartir grupo.
  const multiploDivisor = parseInt(producto.multiplo_divisor) || 1;
  clave += `|MULT:${multiploDivisor}`;

  return clave;
}

/**
 * Simula, para los productos de UNA masa, si algún grupo de
 * clasificarClaveAgrupacion (tipo_masa+forma+tamaño+multiplo_divisor) no
 * alcanza el múltiplo mínimo del divisor compartido con las unidades
 * programadas actuales, y calcula cuánto subir unidades_programadas del o
 * los productos necesarios para completarlo. Pura — no escribe en DB, el
 * llamador decide cómo persistir cada ajuste.
 *
 * Itera dentro de cada grupo en un orden FIJO (calculado una sola vez):
 * mayor unidades_por_paquete primero, menor upq al final. Es una
 * restricción MATEMÁTICA, no de negocio — el multiplo_divisor de un grupo
 * no siempre es alcanzable sumando paquetes de un solo producto (si su upq
 * no divide el faltante exacto), así que se recorren los productos del
 * grupo uno por uno, recalculando el resto tras cada paso, hasta cerrar en
 * 0 exacto o agotar el grupo (máximo `productos.length` iteraciones,
 * nunca loop infinito). Dentro de un mismo upq, empate por mayor kg
 * pendiente y luego por id ascendente.
 *
 * LIMITACIÓN CONOCIDA (Fase 4, 12-ago-2026, decisión explícita): opera
 * sobre productos_por_masa agregado, sin visibilidad de OV individual.
 *
 * @param {Array} productos - filas de productos_por_masa de UNA masa (id,
 *   producto_nombre, tamanio, forma, multiplo_divisor, unidades_por_paquete,
 *   unidades_programadas)
 * @param {string} tipoMasa
 * @returns {Array<{ productoId, unidadesProgramadasAnteriores, unidadesProgramadasNuevas, deltaPaquetes, clave }>}
 */
function simularAjusteDivisorPorGrupo(productos, tipoMasa) {
  const upqDe = (p) => (p.unidades_por_paquete && parseFloat(p.unidades_por_paquete) > 1)
    ? parseFloat(p.unidades_por_paquete)
    : (() => { const m = (p.producto_nombre || '').match(/ X ?(\d+)/i); return m ? parseInt(m[1]) : 1; })();

  const grupos = new Map();
  for (const prod of productos) {
    const clave = clasificarClaveAgrupacion(prod, tipoMasa);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(prod);
  }

  const ajustes = [];

  for (const [clave, prods] of grupos) {
    const divisor = parseInt(prods[0].multiplo_divisor) || 1;
    if (divisor <= 1) continue; // sin divisor real, nada que ajustar

    // Estado mutable por producto — permite iterar el ajuste sin perder lo
    // ya acumulado en pasos previos dentro del mismo grupo.
    const estado = prods.map(p => ({
      producto: p,
      upq: upqDe(p),
      unidadesActuales: parseInt(p.unidades_programadas || 0),
      deltaAcumulado: 0,
    }));

    const panesTotalActual = () => estado.reduce((s, e) => s + e.unidadesActuales * e.upq, 0);

    let resto = panesTotalActual() % divisor;
    if (resto === 0) continue; // grupo ya es múltiplo exacto

    const orden = [...estado].sort((a, b) => {
      if (a.upq !== b.upq) return b.upq - a.upq;
      const kgA = a.unidadesActuales * a.upq;
      const kgB = b.unidadesActuales * b.upq;
      if (kgB !== kgA) return kgB - kgA;
      return a.producto.id - b.producto.id;
    });

    const maxIter = orden.length;
    let iter = 0;
    while (resto !== 0 && iter < maxIter) {
      const elegido = orden[iter];
      const panesFaltantes = divisor - resto;
      const paquetesAAgregar = Math.ceil(panesFaltantes / elegido.upq);
      elegido.unidadesActuales += paquetesAAgregar;
      elegido.deltaAcumulado += paquetesAAgregar;
      resto = panesTotalActual() % divisor;
      iter++;
    }

    if (resto !== 0) {
      // Combinación de unidades_por_paquete que matemáticamente no permite
      // cerrar el múltiplo exacto en maxIter pasos (caso de "problema de
      // monedas" genuino) — se omite el ajuste de TODO el grupo (mejor no
      // tocar nada que dejar un ajuste parcial/incorrecto) y se loguea.
      logger.warn(`simularAjusteDivisorPorGrupo: grupo ${clave} no cerró en múltiplo exacto de ${divisor} tras ${maxIter} iteración(es) (resto=${resto}) — se omite el ajuste, revisar unidades_por_paquete de los productos del grupo.`);
      continue;
    }

    for (const e of estado) {
      if (e.deltaAcumulado > 0) {
        ajustes.push({
          productoId: e.producto.id,
          unidadesProgramadasAnteriores: parseInt(e.producto.unidades_programadas),
          unidadesProgramadasNuevas: e.unidadesActuales,
          deltaPaquetes: e.deltaAcumulado,
          clave,
        });
      }
    }
  }

  return ajustes;
}

/**
 * Agrupa productos en tandas respetando limiteKg (kg de PRODUCTO, no de
 * ingrediente). Fase 4 (12-ago-2026): el reparto ya no es proporcional
 * parejo — en cada decisión se elige primero el GRUPO (clasificarClaveAgrupacion)
 * con mayor kg pendiente total, y dentro de ese grupo el PRODUCTO con mayor
 * kg pendiente; ambos niveles se recalculan en cada iteración, ningún
 * remanente de tanda anterior tiene prioridad automática (Puntos 1-2).
 * Cuando un producto no cabe completo, el corte se calcula en múltiplos
 * exactos de su multiplo_divisor — nunca proporción libre de peso. La
 * tanda puede cerrar por debajo de limiteKg si eso exige respetar el
 * múltiplo; nunca se fuerza a llenar exacto rompiéndolo.
 *
 * LIMITACIÓN CONOCIDA (decisión explícita, no accidental): opera sobre
 * productos_por_masa agregado, sin visibilidad de OV individual — no
 * intenta mantener una misma OV dentro de una sola tanda. Ver nota en
 * distribuirProductosPorTandas. Bajar a nivel de productos_por_masa_ov
 * queda como fase aparte si se confirma como necesidad real de negocio.
 */
function agruparProductosEnTandas(productos, limiteKg, tipoMasa) {
  const upqDe = (p) => (p.unidades_por_paquete && parseFloat(p.unidades_por_paquete) > 1)
    ? parseFloat(p.unidades_por_paquete)
    : (() => { const m = (p.producto_nombre || '').match(/ X ?(\d+)/i); return m ? parseInt(m[1]) : 1; })();

  const pendientes = productos.map(prod => {
    const upq = upqDe(prod);
    const kgPorPan = upq > 0 ? (parseFloat(prod.gramaje_unitario || 0) / 1000) / upq : 0;

    // Guardia: un solo pan más pesado que el límite de tanda es un dato
    // imposible (gramaje_unitario o unidades_por_paquete corruptos). No hay
    // forma de respetarlo sin loop infinito — se aborta esta masa.
    if (kgPorPan > limiteKg + 0.0001) {
      throw new Error(
        `agruparProductosEnTandas: producto ${prod.id} (${prod.producto_nombre}) pesa ` +
        `${kgPorPan.toFixed(2)}kg por pieza — supera limiteKg (${limiteKg}kg). ` +
        `Dato imposible (gramaje_unitario/unidades_por_paquete corruptos). Abortando subdivisión de esta masa.`
      );
    }

    const divisor = parseInt(prod.multiplo_divisor) || 1;
    return {
      producto: prod,
      clave: clasificarClaveAgrupacion(prod, tipoMasa),
      upq, kgPorPan, divisor,
      kgPorChunk: kgPorPan * divisor,
      paquetesTotal: parseInt(prod.unidades_programadas || 0),
      panesRestantes: parseInt(prod.unidades_programadas || 0) * upq,
    };
  }).filter(p => p.panesRestantes > 0 && p.kgPorPan > 0);

  const tandas = [{ kg: 0, items: [] }];
  let actual = tandas[0];

  while (pendientes.some(p => p.panesRestantes > 0)) {
    const espacio = limiteKg - actual.kg;

    if (espacio <= 0.0001) {
      tandas.push({ kg: 0, items: [] });
      actual = tandas[tandas.length - 1];
      continue;
    }

    const activos = pendientes.filter(p => p.panesRestantes > 0);

    // Nivel 1 — grupo: kg pendiente TOTAL del grupo, descendente,
    // recalculado en cada iteración (ningún grupo tiene prioridad fija).
    // Empate → menor id de producto dentro del grupo (análogo de "id
    // ascendente" a nivel grupo).
    const gruposInfo = new Map(); // clave -> { kg, minId }
    for (const p of activos) {
      const kg = p.panesRestantes * p.kgPorPan;
      const info = gruposInfo.get(p.clave) || { kg: 0, minId: Infinity };
      info.kg += kg;
      info.minId = Math.min(info.minId, p.producto.id);
      gruposInfo.set(p.clave, info);
    }
    const claveElegida = [...gruposInfo.entries()].sort((a, b) => {
      if (Math.abs(b[1].kg - a[1].kg) > 0.0001) return b[1].kg - a[1].kg;
      return a[1].minId - b[1].minId;
    })[0][0];

    // Nivel 2 — producto dentro del grupo elegido: mismo criterio de kg
    // pendiente descendente, empate por id ascendente.
    const candidato = activos
      .filter(p => p.clave === claveElegida)
      .sort((a, b) => {
        const kgA = a.panesRestantes * a.kgPorPan;
        const kgB = b.panesRestantes * b.kgPorPan;
        if (Math.abs(kgB - kgA) > 0.0001) return kgB - kgA;
        return a.producto.id - b.producto.id;
      })[0];

    const kgPendienteCandidato = candidato.panesRestantes * candidato.kgPorPan;

    let panesAAsignar;
    if (kgPendienteCandidato <= espacio + 0.0001) {
      // Cabe completo — todo lo que le queda a este producto
      panesAAsignar = candidato.panesRestantes;
    } else {
      // No cabe completo — corte en múltiplos exactos de multiplo_divisor
      if (candidato.kgPorChunk > limiteKg + 0.0001) {
        // Dato degenerado: ni un chunk cabría en una tanda vacía. Se
        // ignora el divisor para ESTE producto en vez de loop infinito.
        logger.warn(`agruparProductosEnTandas: producto ${candidato.producto.id} tiene un chunk de multiplo_divisor (${candidato.kgPorChunk.toFixed(2)}kg) que excede limiteKg (${limiteKg}kg) — se ignora el divisor para este producto.`);
        candidato.divisor = 1;
        candidato.kgPorChunk = candidato.kgPorPan;
      }

      const chunksQueCaben   = Math.floor((espacio + 0.0001) / candidato.kgPorChunk);
      const chunksPendientes = Math.floor(candidato.panesRestantes / candidato.divisor);
      const chunks            = Math.min(chunksQueCaben, chunksPendientes);

      if (chunks <= 0) {
        // Ni un chunk completo cabe en el espacio restante — la tanda
        // cierra tal como está (puede quedar por debajo de limiteKg,
        // esperado) y este producto pasa completo a la siguiente.
        tandas.push({ kg: 0, items: [] });
        actual = tandas[tandas.length - 1];
        continue;
      }
      panesAAsignar = chunks * candidato.divisor;
    }

    const kgAAsignar       = panesAAsignar * candidato.kgPorPan;
    const paquetesAAsignar = panesAAsignar / candidato.upq;
    const fraccion         = candidato.paquetesTotal > 0 ? paquetesAAsignar / candidato.paquetesTotal : 0;

    actual.items.push({ producto: candidato.producto, fraccion });
    actual.kg += kgAAsignar;
    candidato.panesRestantes -= panesAAsignar;
  }

  // Consolidar si un mismo producto quedó con más de una fracción en la misma tanda
  for (const tanda of tandas) {
    const consolidado = new Map();
    for (const { producto, fraccion } of tanda.items) {
      const prev = consolidado.get(producto.id) || { producto, fraccion: 0 };
      prev.fraccion += fraccion;
      consolidado.set(producto.id, prev);
    }
    tanda.items = Array.from(consolidado.values());
  }

  return tandas;
}

/**
 * Inserta los productos en cada sub-masa según el plan de tandas del
 * empaquetado. Cuando un producto quedó partido entre dos tandas
 * consecutivas (cluster que no cupo completo), reparte con piso en todas
 * las ocurrencias menos la última, que absorbe el residuo exacto.
 */
async function distribuirProductosPorTandas(tandas, subMasaIds, qr = db) {
  const ocurrenciasPorProducto = new Map();
  tandas.forEach((tanda, tandaIdx) => {
    for (const { producto, fraccion } of tanda.items) {
      if (!ocurrenciasPorProducto.has(producto.id)) ocurrenciasPorProducto.set(producto.id, []);
      ocurrenciasPorProducto.get(producto.id).push({ tandaIdx, fraccion, producto });
    }
  });

  for (const [productoMasaIdOriginal, ocurrencias] of ocurrenciasPorProducto) {
    const prod = ocurrencias[0].producto;
    const totalProg   = parseInt(prod.unidades_programadas);
    const totalPed    = parseInt(prod.unidades_pedidas);
    const totalKgPed  = parseFloat(prod.kilos_pedidos);
    const totalKgProg = parseFloat(prod.kilos_programados);

    let progRestante  = totalProg;
    let pedRestante   = totalPed;
    let kgPedRestante  = totalKgPed;
    let kgProgRestante = totalKgProg;

    // FIX (2026-08-06): las tandas quedaban con "0 OV" porque nunca se copiaban
    // las líneas de productos_por_masa_ov del producto original a cada sub-masa
    // (solo se copiaba a orden_masa_relacion, tabla en desuso desde la migración
    // 039). Se traen una vez por producto y se reparten proporcional a la misma
    // fracción de cada tanda, con el mismo patrón de residuo en la última ocurrencia.
    const ovsOriginalesResult = await qr.query(
      `SELECT sap_doc_entry, sap_doc_num, sap_line_num, sap_item_code, unidades_pedidas, cantidad_abierta_sap
       FROM productos_por_masa_ov
       WHERE producto_masa_id = $1`,
      [productoMasaIdOriginal]
    );
    const ovsRestante = ovsOriginalesResult.rows.map(ov => ({
      ...ov,
      restante: parseInt(ov.unidades_pedidas) || 0,
    }));

    for (let idx = 0; idx < ocurrencias.length; idx++) {
      const oc = ocurrencias[idx];
      const esUltima = idx === ocurrencias.length - 1;

      const prog = esUltima ? progRestante : Math.floor(totalProg * oc.fraccion);
      const ped  = esUltima ? pedRestante  : Math.floor(totalPed  * oc.fraccion);
      const kgPed  = esUltima ? parseFloat(kgPedRestante.toFixed(3))  : parseFloat((totalKgPed  * oc.fraccion).toFixed(3));
      const kgProg = esUltima ? parseFloat(kgProgRestante.toFixed(3)) : parseFloat((totalKgProg * oc.fraccion).toFixed(3));

      progRestante -= prog;
      pedRestante  -= ped;
      kgPedRestante  = parseFloat((kgPedRestante  - kgPed).toFixed(3));
      kgProgRestante = parseFloat((kgProgRestante - kgProg).toFixed(3));

      if (prog > 0) {
        const nuevoProductoMasaId = await insertarProductoEnMasa(subMasaIds[oc.tandaIdx], prod, prog, ped, kgPed, kgProg, qr);

        for (const ov of ovsRestante) {
          // LIMITACIÓN CONOCIDA (Fase 4, 12-ago-2026): esta fracción divide
          // cada OV proporcionalmente sin ningún criterio de cohesión — una
          // misma OV puede terminar partida entre dos tandas aunque hubiera
          // cabido entera en una. agruparProductosEnTandas/Pieza A operan a
          // nivel de productos_por_masa agregado, sin visibilidad de OV
          // individual. Bajar este reparto a nivel de productos_por_masa_ov
          // (empaquetado de OV individual dentro de cada producto) queda
          // como fase aparte, solo si se confirma como necesidad real de
          // negocio tras observar el comportamiento en producción —
          // decisión explícita, no pendiente por descuido.
          const cantidadOv = esUltima ? ov.restante : Math.floor((parseInt(ov.unidades_pedidas) || 0) * oc.fraccion);
          ov.restante -= cantidadOv;
          if (cantidadOv > 0) {
            await qr.query(
              `INSERT INTO productos_por_masa_ov
                 (producto_masa_id, masa_id, sap_doc_entry, sap_doc_num, sap_line_num, sap_item_code, unidades_pedidas, cantidad_abierta_sap)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (masa_id, sap_doc_entry, sap_line_num) DO UPDATE SET
                 unidades_pedidas = productos_por_masa_ov.unidades_pedidas + EXCLUDED.unidades_pedidas,
                 cantidad_abierta_sap = EXCLUDED.cantidad_abierta_sap`,
              [nuevoProductoMasaId, subMasaIds[oc.tandaIdx], ov.sap_doc_entry, ov.sap_doc_num, ov.sap_line_num, ov.sap_item_code, cantidadOv, ov.cantidad_abierta_sap]
            );
          }
        }
      }
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

  // Multiplo_divisor y peso_masa_dividida son atributos del artículo (no cambian al subdividir) —
  // deben copiarse del producto original, no quedarse en NULL/0.
  const multiploDivisor = parseInt(prod.multiplo_divisor || 0);

  // unidades_ajustadas/unidades_excedente sí dependen de la cantidad de ESTA tanda —
  // recalcular con la misma fórmula usada en el sync original (sap.controller.js).
  const unidadesAjustadas = (multiploDivisor > 0 && unidadesProg % multiploDivisor !== 0)
    ? (Math.floor(unidadesProg / multiploDivisor) + 1) * multiploDivisor
    : unidadesProg;
  const unidadesExcedente = unidadesAjustadas - unidadesProg;

  const insertResult = await qr.query(`
    INSERT INTO productos_por_masa
      (masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
       unidades_pedidas, unidades_programadas, unidades_producidas,
       kilos_pedidos, kilos_programados, kilos_producidos,
       sap_item_code, unidades_por_paquete, cantidad_paquetes, delta_ajuste,
       tamanio, forma, multiplo_divisor, unidades_ajustadas, unidades_excedente,
       peso_masa_dividida)
    VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,0,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING id
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
    prod.tamanio || null,
    prod.forma || null,
    multiploDivisor,
    unidadesAjustadas,
    unidadesExcedente,
    prod.peso_masa_dividida || null,
  ]);
  return insertResult.rows[0].id;
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
  await recalcularTotalesMasa(masaId, client);

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
  const limiteKg = await getLimiteKg(client, masa.tipo_masa);

  if (totalKgIngredientes <= limiteKg) {
    logger.info(`Masa ${masaId}: ${totalKgIngredientes.toFixed(2)} kg ≤ ${limiteKg} kg, sin subdivisión.`);
    return null;
  }

  const todosProductosParaAgrupar = await client.query(
    `SELECT * FROM productos_por_masa WHERE masa_id = $1`,
    [masaId]
  );
  const totalKgProductos = todosProductosParaAgrupar.rows.reduce(
    (acc, p) => acc + parseFloat(p.kilos_programados || 0), 0
  );

  const tandas       = agruparProductosEnTandas(todosProductosParaAgrupar.rows, limiteKg, masa.tipo_masa);
  const nTandas       = tandas.length;
  const LETRAS_TANDA  = generarLetrasTanda(nTandas);

  const fraccionesTanda = [];
  let fraccionAcumulada = 0;
  for (let i = 0; i < nTandas; i++) {
    if (i === nTandas - 1) {
      fraccionesTanda.push(parseFloat((1 - fraccionAcumulada).toFixed(6)));
    } else {
      const frac = totalKgProductos > 0 ? tandas[i].kg / totalKgProductos : 1 / nTandas;
      fraccionesTanda.push(parseFloat(frac.toFixed(6)));
      fraccionAcumulada += fraccionesTanda[i];
    }
  }

  logger.info(`Masa ${masaId} supera el límite (${totalKgIngredientes.toFixed(2)} kg > ${limiteKg} kg). Subdividiendo en ${nTandas} tandas agrupadas por tamaño+forma / tipo_masa.`);

  // Marcar masa original como subdividida
  await client.query(`
    UPDATE masas_produccion
    SET fue_subdividida = TRUE, estado = 'SUBDIVIDIDA', updated_at = NOW()
    WHERE id = $1
  `, [masaId]);

  const kgPorTanda     = parseFloat((totalKgIngredientes / nTandas).toFixed(3));
  const totalKilosBaseNum  = parseFloat(masa.total_kilos_base);
  const totalKilosMermaNum = parseFloat(masa.total_kilos_con_merma);
  const baseKilosBaseArr   = [];
  const baseKilosMermaArr  = [];
  let acumBase = 0, acumMerma = 0;
  for (let i = 0; i < nTandas; i++) {
    if (i === nTandas - 1) {
      baseKilosBaseArr.push(parseFloat((totalKilosBaseNum   - acumBase).toFixed(3)));
      baseKilosMermaArr.push(parseFloat((totalKilosMermaNum - acumMerma).toFixed(3)));
    } else {
      const b = parseFloat((totalKilosBaseNum  * fraccionesTanda[i]).toFixed(3));
      const m = parseFloat((totalKilosMermaNum * fraccionesTanda[i]).toFixed(3));
      baseKilosBaseArr.push(b);
      baseKilosMermaArr.push(m);
      acumBase  += b;
      acumMerma += m;
    }
  }
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
      baseKilosBaseArr[i],
      baseKilosMermaArr[i],
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
  await distribuirIngredientes(ingredientesResult.rows, subMasaIds, fraccionesTanda, conPesaje, client);

  await distribuirProductosPorTandas(tandas, subMasaIds, client);

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
  // FIX 2026-08-10: usar unidades_ajustadas como base — es la misma base que ahora
  // usa completarFase() para calcular emp.cantidad_kilos (punto 6 de este mismo
  // fix), asi que hay que usar la misma aqui para que las proporciones cuadren.
  // Fallback a unidades_programadas para masas historicas con el campo en NULL.
  const prodMadreResult = await client.query(
    `SELECT COALESCE(SUM(COALESCE(unidades_ajustadas, unidades_programadas)), 0) AS total_paq FROM productos_por_masa WHERE masa_id = $1`,
    [masaId]
  );
  const totalPaqMadre = parseFloat(prodMadreResult.rows[0].total_paq) || 1;
  // Calcular cantidad BOM por paquete (cantidad_kilos de la madre / total paquetes madre)
  // Esto nos da la cantidad de cada material de empaque por paquete producido
  for (const subMasaId of subMasaIds) {
    const prodSubResult = await client.query(
      `SELECT COALESCE(SUM(COALESCE(unidades_ajustadas, unidades_programadas)), 0) AS paq FROM productos_por_masa WHERE masa_id = $1`,
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
      // FIX 2026-08-10: se agrega unidades_ajustadas — es la cantidad REAL de
      // paquetes que va a salir de Division (redondeada al multiplo_divisor de
      // panes), la receta tiene que alcanzar para eso, no para unidades_programadas.
      const productosResult = await db.query(
        `SELECT sap_item_code, producto_nombre, unidades_programadas, unidades_ajustadas,
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
          // FIX 2026-08-10: usar unidades_ajustadas (con fallback si viniera NULL
          // en datos historicos) en vez de unidades_programadas.
          const paquetesReales = parseFloat(prod.unidades_ajustadas) || parseFloat(prod.unidades_programadas);
          const cantTotal = parseFloat(comp.cantidad) * paquetesReales;
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

      await recalcularTotalesMasa(masaId, db);

      const totalKgIngredientes = componentesPeso.reduce((sum, [, comp]) => sum + comp.cantidad, 0);
      const limiteKg = await getLimiteKg(db, masa.tipo_masa);

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

      // 2. Validar cantidades_divididas — SIEMPRE, incluso si el payload no las
      // trae (un campo ausente equivale a 0 para ese producto). SAP no permite
      // crear una OV sin cantidad, así que un producto en 0/nulo en esta fase
      // es siempre un error de captura, nunca un estado de negocio válido.
      const cantidadesDivididasSeguro = cantidades_divididas || {};
      const errores = [];

      for (const prod of productosResult.rows) {
        const cantidad  = Number(cantidadesDivididasSeguro[prod.id] || 0);
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
          message: 'No se puede completar la división: hay productos sin cantidad válida.',
          errores,
        });
      }

      // 3. Guardar cantidades_divididas en productos_por_masa
      //    unidades_excedente_real = cantidad - unidades_pedidas (excedente real cortado)
      for (const prod of productosResult.rows) {
        const cantidad = Number(cantidadesDivididasSeguro[prod.id] || 0);
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

      logger.info(
        `División masa ${masaId}: cantidades guardadas para ${productosResult.rows.length} productos`
      );

      // 4. Completar fase y desbloquear siguiente
      const faseActualizada = await fasesModel.updateEstadoFase(
        masaId, 'DIVISION', 'COMPLETADA', 100, req.user.id,
        { ...(restosDatos || {}), cantidades_divididas: cantidadesDivididasSeguro }
      );
      const siguienteFase = await fasesModel.desbloquearSiguienteFase(masaId, 'DIVISION');

      const hayFaltantes = productosResult.rows.some(p => {
        const cant = Number(cantidadesDivididasSeguro[p.id] || 0);
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
  // Exportado para uso en pesaje.controller.js, masas.controller.js, sap.controller.js
  ejecutarSubdivision,
  getLimiteKg,
  simularAjusteDivisorPorGrupo,
  recalcularTotalesMasa,
};
