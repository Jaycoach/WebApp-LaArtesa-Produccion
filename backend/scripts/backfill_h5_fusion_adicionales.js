/**
 * Backfill Hallazgo 5 — fusiona masas ADICIONAL (creadas antes del fix de
 * sap.controller.js) a su masa referencia, y reabre la aprobacion de la
 * referencia si aplica.
 *
 * Casos (confirmados en el diagnostico, alcance aprobado por Jonathan):
 *   542 (BRIOCHE)              -> 500
 *   543 (ARABE_OREGANO)        -> 512
 *   544 (TRADICIONAL_FORMADO)  -> 529
 *
 * 549 -> 539 NO esta en la lista -- excluido a proposito (549 ya CANCELADA
 * manualmente por otro motivo, y 539 esta SUBDIVIDIDA con sub-masas ya
 * COMPLETADA/EMPAQUE -- la regla permanente ratificada por Jonathan es
 * nunca fusionar/backfillear si la referencia o su padre ya esta
 * SUBDIVIDIDA, o si cualquier sub-masa avanzo mas alla de PLANIFICACION).
 *
 * Reusa las funciones reales de fases.controller.js (recalcularTotalesMasa,
 * simularAjusteDivisorPorGrupo) para los calculos de negocio (BOM, ajuste de
 * grupo por multiplo divisor) -- no se reimplementan a mano.
 *
 * El resto de las operaciones (repuntar productos_por_masa_ov, recalcular
 * unidades_pedidas/programadas/ajustadas desde la suma real de OVs, reabrir
 * aprobacion, cancelar la ADICIONAL) replican exactamente la misma logica y
 * el mismo SQL que el bloque de fusion ya desplegado en sap.controller.js
 * (lineas ~1018-1230 tras el fix de Hallazgo 5), adaptados para operar
 * sobre OVs que YA estaban importadas bajo la masa ADICIONAL equivocada --
 * un sync real nuevo no serviria aqui porque el control anti-duplicacion
 * (docEntry+itemCode ya importado para la fecha) las filtraria como
 * "ya importadas", sin importar bajo que masa esten.
 *
 * Diferencia deliberada frente al codigo de sync: en vez de INSERTAR una
 * fila nueva en productos_por_masa_ov (que dejaria un registro duplicado
 * de la misma linea de OV bajo dos masas, una de ellas por cancelarse), se
 * RE-APUNTA (UPDATE masa_id) la fila que ya existe -- mismo efecto final,
 * sin duplicar el historial de OVs.
 *
 * delta_ajuste = NULL en el recalculo (paso 4): si el item_code ya existia
 * en la referencia con un ajuste de aprobacion previo (automatico +2 o
 * manual), hay que resetearlo para que la re-aprobacion (que solo toca
 * productos con delta_ajuste IS NULL) lo vuelva a ajustar sobre el total ya
 * fusionado. Sin esto, el producto se queda corto en el delta perdido --
 * bug real encontrado en la verificacion de esta misma fusion (masa 500/
 * PANPAQ178 y masa 2062/PASPAQ05 en staging). Mismo parche aplicado en
 * sap.controller.js.
 *
 * Ejecucion: una transaccion (BEGIN/COMMIT) por caso, para que si uno falla
 * los anteriores ya confirmados no se reviertan. Si un caso falla, el
 * script se detiene (no sigue con los restantes) para revision manual.
 *
 * Idempotencia: si un caso ya se corrio con exito antes (la ADICIONAL ya
 * quedo CANCELADA por este mismo backfill) y el script se vuelve a correr
 * desde cero, ese caso puntual se salta limpio (YaFusionadoError) sin
 * detener los restantes.
 *
 * USO: node scripts/backfill_h5_fusion_adicionales.js
 *   (correr desde backend/; ajustar USUARIO_ID segun el ambiente -- ver nota)
 */

require('dotenv').config();

const db = require('../src/database/connection');
const { simularAjusteDivisorPorGrupo, recalcularTotalesMasa } = require('../src/controllers/fases.controller');

// NOTA: id de usuario para cancelado_por -- ajustar segun el ambiente antes
// de correr. Staging: admin=1. Produccion: admin=2 (confirmado distinto en
// la sesion de verificacion post-deploy).
const USUARIO_ID = process.env.BACKFILL_USUARIO_ID
  ? parseInt(process.env.BACKFILL_USUARIO_ID, 10)
  : (() => { throw new Error('Definir BACKFILL_USUARIO_ID en el entorno antes de correr (staging=1, produccion=2)'); })();

const CASOS = [
  { adicionalId: 542, referenciaId: 500, tipoMasa: 'BRIOCHE' },
  { adicionalId: 543, referenciaId: 512, tipoMasa: 'ARABE_OREGANO' },
  { adicionalId: 544, referenciaId: 529, tipoMasa: 'TRADICIONAL_FORMADO' },
];

// Idempotencia (QA 2026-08-26): si un caso ya se corrio con exito antes (la
// ADICIONAL ya quedo CANCELADA por este mismo backfill) y el script se
// vuelve a correr desde cero, ese caso puntual debe saltarse limpio -- no
// tratarse como una falla que detiene TODO el script. YaFusionadoError es
// la unica excepcion que el loop principal trata como "skip y continua";
// cualquier otro Error sigue deteniendo el script completo para revision
// manual (comportamiento sin cambios para fallas reales).
class YaFusionadoError extends Error {}

async function snapshot(client, masaId, label) {
  const masaR = await client.query(
    `SELECT id, codigo_masa, estado, fase_actual, aprobado_por, aprobado_en, total_productos, total_ordenes
     FROM masas_produccion WHERE id = $1`,
    [masaId]
  );
  const progresoR = await client.query(
    `SELECT fase, estado FROM progreso_fases WHERE masa_id = $1 AND fase IN ('PLANIFICACION','PESAJE','EMPAQUE') ORDER BY fase`,
    [masaId]
  );
  const productosR = await client.query(
    `SELECT sap_item_code, unidades_pedidas, unidades_programadas, unidades_ajustadas, unidades_excedente, delta_ajuste
     FROM productos_por_masa WHERE masa_id = $1 ORDER BY sap_item_code`,
    [masaId]
  );
  console.log(`\n--- ${label}: masa ${masaId} ---`);
  console.log('masas_produccion:', JSON.stringify(masaR.rows[0]));
  console.log('progreso_fases:', JSON.stringify(progresoR.rows));
  console.log('productos_por_masa:', JSON.stringify(productosR.rows));
}

async function fusionar(client, caso) {
  const { adicionalId, referenciaId, tipoMasa } = caso;

  console.log(`\n=== FUSIONANDO ${adicionalId} -> ${referenciaId} (${tipoMasa}) ===`);
  await snapshot(client, referenciaId, 'ANTES (referencia)');
  await snapshot(client, adicionalId, 'ANTES (adicional)');

  // 1. Verificaciones de seguridad -- regla permanente ratificada por
  //    Jonathan. Aborta con error explicito si algo no calza; no continua
  //    "a medias" en silencio.
  const refR = await client.query(
    `SELECT estado, fase_actual, es_adicional, masa_padre_id, es_subdivision
     FROM masas_produccion WHERE id = $1`,
    [referenciaId]
  );
  const ref = refR.rows[0];
  if (!ref) throw new Error(`Masa referencia ${referenciaId} no existe`);
  if (ref.fase_actual !== 'PLANIFICACION') {
    throw new Error(`Masa ${referenciaId}: fase_actual=${ref.fase_actual} (no PLANIFICACION) -- Pesaje ya pudo haber avanzado, abortando`);
  }
  if (['COMPLETADA', 'SUBDIVIDIDA', 'CANCELADA'].includes(ref.estado)) {
    throw new Error(`Masa ${referenciaId}: estado=${ref.estado} es terminal -- nunca fusionable, abortando`);
  }
  const pesajeR = await client.query(
    `SELECT estado FROM progreso_fases WHERE masa_id = $1 AND fase = 'PESAJE'`,
    [referenciaId]
  );
  if (pesajeR.rows[0]?.estado !== 'BLOQUEADA') {
    throw new Error(`Masa ${referenciaId}: progreso_fases.PESAJE=${pesajeR.rows[0]?.estado} (no BLOQUEADA) -- abortando`);
  }
  // Si la referencia tuviera sub-masas (no deberia, es_subdivision=false para
  // las 3 referencias del alcance, pero se valida igual por seguridad):
  const subMasasR = await client.query(
    `SELECT id, estado, fase_actual FROM masas_produccion WHERE masa_padre_id = $1`,
    [referenciaId]
  );
  const subMasaAvanzada = subMasasR.rows.find(s => s.fase_actual !== 'PLANIFICACION' || !['PLANIFICACION', 'APROBADA'].includes(s.estado));
  if (subMasaAvanzada) {
    throw new Error(`Masa ${referenciaId} tiene una sub-masa (id ${subMasaAvanzada.id}) mas alla de PLANIFICACION -- abortando`);
  }

  const adicionalR = await client.query(
    `SELECT estado, fase_actual FROM masas_produccion WHERE id = $1`,
    [adicionalId]
  );
  if (!adicionalR.rows[0]) throw new Error(`Masa ADICIONAL ${adicionalId} no existe`);
  if (adicionalR.rows[0].estado === 'CANCELADA') {
    // Idempotencia: esto es EXACTAMENTE lo que deja este mismo script al
    // terminar con exito (paso 9 mas abajo) -- si ya esta asi, el caso ya
    // se proceso antes. Se trata como "ya hecho", no como una falla nueva.
    throw new YaFusionadoError(`Masa ADICIONAL ${adicionalId} ya esta CANCELADA -- caso ya procesado en una corrida anterior, se salta`);
  }

  const requiereReapertura = ref.estado === 'APROBADA';

  // 2. Traer las lineas de OV de la ADICIONAL (una fila por linea de OV real)
  const ovRows = await client.query(
    `SELECT id, producto_masa_id, sap_doc_entry, sap_doc_num, sap_line_num, sap_item_code
     FROM productos_por_masa_ov WHERE masa_id = $1 ORDER BY sap_line_num`,
    [adicionalId]
  );
  if (ovRows.rows.length === 0) {
    // Idempotencia: la ADICIONAL sigue sin CANCELAR (no cayo en el chequeo
    // de arriba) pero ya no tiene lineas de OV propias -- ya se le
    // re-apuntaron todas a la referencia en una corrida anterior que se
    // interrumpio DESPUES del COMMIT de ese paso pero antes de llegar al
    // paso 9 (cancelarla). Estado inconsistente real, no un simple "ya
    // hecho" -- se detiene para revision manual, no se asume nada.
    throw new Error(`Masa ADICIONAL ${adicionalId} no tiene filas en productos_por_masa_ov pero NO esta CANCELADA -- estado inconsistente, revisar a mano antes de reintentar`);
  }
  const itemCodesInvolucrados = [...new Set(ovRows.rows.map(r => r.sap_item_code))];

  // 3. Repuntar cada linea de OV a la masa referencia -- crear la fila
  //    agregada en productos_por_masa de la referencia si el item_code es
  //    nuevo ahi, o reusar la existente si ya tenia ese producto.
  for (const ov of ovRows.rows) {
    const ppmExistente = await client.query(
      `SELECT id FROM productos_por_masa WHERE masa_id = $1 AND sap_item_code = $2`,
      [referenciaId, ov.sap_item_code]
    );

    let productoMasaId;
    if (ppmExistente.rows.length > 0) {
      productoMasaId = ppmExistente.rows[0].id;
    } else {
      // Copiar el dato maestro (gramaje, unidades_por_paquete, multiplo_divisor,
      // tamanio, forma, etc.) de la fila que tenia la ADICIONAL -- mismo
      // criterio de "dato maestro ya resuelto" que usa el codigo real.
      const origenR = await client.query(
        `SELECT producto_codigo, producto_nombre, gramaje_unitario,
                unidades_por_paquete, multiplo_divisor, tamanio, forma,
                peso_masa_dividida, dias_vencimiento, requiere_formado
         FROM productos_por_masa WHERE id = $1`,
        [ov.producto_masa_id]
      );
      const o = origenR.rows[0];
      const insertPPM = await client.query(
        `INSERT INTO productos_por_masa (
           masa_id, producto_codigo, producto_nombre, presentacion,
           gramaje_unitario, unidades_pedidas, unidades_programadas,
           kilos_pedidos, kilos_programados,
           sap_item_code, unidades_por_paquete, cantidad_paquetes,
           sap_doc_entry, sap_doc_num,
           multiplo_divisor, unidades_ajustadas, unidades_excedente,
           tamanio, forma, peso_masa_dividida, dias_vencimiento, requiere_formado
         ) VALUES ($1,$2,$3,'Por definir',$4,0,0,0,0,$5,$6,$7,$8,$9,$10,0,0,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          referenciaId, o.producto_codigo, o.producto_nombre, o.gramaje_unitario,
          ov.sap_item_code, o.unidades_por_paquete, 0, ov.sap_doc_entry, ov.sap_doc_num,
          o.multiplo_divisor, o.tamanio, o.forma, o.peso_masa_dividida, o.dias_vencimiento, o.requiere_formado,
        ]
      );
      productoMasaId = insertPPM.rows[0].id;
    }

    // Re-apuntar la fila de productos_por_masa_ov ya existente (no se
    // inserta una nueva -- evita duplicar el historial de la misma linea
    // de OV bajo dos masas distintas).
    await client.query(
      `UPDATE productos_por_masa_ov
       SET masa_id = $1, producto_masa_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [referenciaId, productoMasaId, ov.id]
    );
  }

  // 4. Recalcular unidades_pedidas/programadas/ajustadas/excedente en
  //    productos_por_masa desde la suma real de productos_por_masa_ov --
  //    MISMA formula exacta que sap.controller.js (bloque de fusion), no
  //    se acumula a mano.
  for (const itemCode of itemCodesInvolucrados) {
    const totalesR = await client.query(
      `SELECT COALESCE(SUM(unidades_pedidas), 0) AS total_unidades
       FROM productos_por_masa_ov WHERE masa_id = $1 AND sap_item_code = $2`,
      [referenciaId, itemCode]
    );
    const totalUnidades = parseInt(totalesR.rows[0].total_unidades, 10);

    const bomR = await client.query(
      `SELECT COALESCE(SUM(cantidad), 0) AS kg_por_unidad
       FROM sap_bom_componentes WHERE item_code_padre = $1 AND grupo_sap = 181`,
      [itemCode]
    );
    let kgPorPaquete = parseFloat(bomR.rows[0].kg_por_unidad || 0);

    const artR = await client.query(
      `SELECT gramaje, sales_qty_per_pack, multiplo_divisor FROM sap_articulos WHERE item_code = $1`,
      [itemCode]
    );
    const art = artR.rows[0] || {};
    if (kgPorPaquete <= 0) {
      const gramaje = parseFloat(art.gramaje || 0);
      const qtyPerPack = parseFloat(art.sales_qty_per_pack || 1);
      kgPorPaquete = gramaje > 0 ? (gramaje * qtyPerPack) / 1000 : 0;
    }
    const unidadesPorPaquete = parseFloat(art.sales_qty_per_pack || 1);
    const multiploDivisor = parseInt(art.multiplo_divisor || 0, 10);

    const cantidadPaquetes = unidadesPorPaquete > 0 ? totalUnidades / unidadesPorPaquete : totalUnidades;
    const panesTotal = totalUnidades * unidadesPorPaquete;
    const panesAjustados = (multiploDivisor > 0 && panesTotal % multiploDivisor !== 0)
      ? (Math.floor(panesTotal / multiploDivisor) + 1) * multiploDivisor
      : panesTotal;
    const unidadesAjustadas = multiploDivisor > 0
      ? Math.round(panesAjustados / unidadesPorPaquete)
      : totalUnidades;
    const unidadesExcedente = unidadesAjustadas - totalUnidades;

    // delta_ajuste = NULL: si este item_code ya existia en la referencia
    // con un ajuste de aprobacion previo (automatico +2 o manual), hay que
    // resetearlo para que la re-aprobacion (que solo toca productos con
    // delta_ajuste IS NULL) lo vuelva a ajustar sobre el total ya fusionado.
    // Sin esto, el producto se queda corto en el delta perdido -- bug real
    // encontrado en la verificacion de esta misma fusion (ver masa 500/
    // PANPAQ178 y masa 2062/PASPAQ05 en staging).
    await client.query(
      `UPDATE productos_por_masa
       SET unidades_pedidas = $1, unidades_programadas = $1, cantidad_paquetes = $2,
           kilos_pedidos = $3, kilos_programados = $3,
           unidades_ajustadas = $4, unidades_excedente = $5, delta_ajuste = NULL, updated_at = NOW()
       WHERE masa_id = $6 AND sap_item_code = $7`,
      [totalUnidades, cantidadPaquetes, kgPorPaquete * totalUnidades, unidadesAjustadas, unidadesExcedente, referenciaId, itemCode]
    );
  }

  // 5. Simulacion de ajuste de grupo por multiplo divisor -- FUNCION REAL
  //    de fases.controller.js, sin reimplementar. Puede reajustar OTROS
  //    productos de la referencia (no solo los recien fusionados) si el
  //    multiplo exige redistribuir entre todo el tipo_masa.
  const productosSimR = await client.query(
    `SELECT id, producto_nombre, tamanio, forma, multiplo_divisor, unidades_por_paquete, unidades_programadas
     FROM productos_por_masa WHERE masa_id = $1`,
    [referenciaId]
  );
  const ajustesGrupo = simularAjusteDivisorPorGrupo(productosSimR.rows, tipoMasa);
  for (const ajuste of ajustesGrupo) {
    await client.query(
      `UPDATE productos_por_masa
       SET unidades_programadas = $1::integer, kilos_programados = gramaje_unitario * $1::integer / 1000.0,
           cantidad_paquetes = $1::integer, origen_ajuste_divisor = 'MERGE_OV',
           unidades_ajuste_grupal = unidades_ajuste_grupal + $2::integer, updated_at = NOW()
       WHERE id = $3`,
      [ajuste.unidadesProgramadasNuevas, ajuste.deltaPaquetes, ajuste.productoId]
    );
  }
  if (ajustesGrupo.length > 0) {
    console.log(`Ajuste de grupo (multiplo divisor) aplico a ${ajustesGrupo.length} producto(s) de la masa ${referenciaId}`);
  }

  // 6. Contadores de la masa referencia
  await client.query(
    `UPDATE masas_produccion
     SET total_productos = (SELECT COUNT(DISTINCT sap_item_code) FROM productos_por_masa_ov WHERE masa_id = $1),
         total_ordenes   = (SELECT COUNT(DISTINCT sap_doc_entry)  FROM productos_por_masa_ov WHERE masa_id = $1),
         updated_at      = NOW()
     WHERE id = $1`,
    [referenciaId]
  );

  // 7. Recalcular ingredientes_masa (BOM completo) -- FUNCION REAL de
  //    fases.controller.js, sin reimplementar formulas de panaderia a mano.
  await recalcularTotalesMasa(referenciaId, client);

  // 8. Reabrir aprobacion si la referencia ya estaba APROBADA -- revierte
  //    exactamente lo que aprobarMasaCore fija al aprobar.
  if (requiereReapertura) {
    await client.query(
      `UPDATE masas_produccion
       SET estado = 'PLANIFICACION', aprobado_por = NULL, aprobado_en = NULL, updated_at = NOW()
       WHERE id = $1`,
      [referenciaId]
    );
    await client.query(
      `UPDATE progreso_fases SET estado = 'EN_PROGRESO', updated_at = NOW()
       WHERE masa_id = $1 AND fase = 'PLANIFICACION'`,
      [referenciaId]
    );
    await client.query(
      `UPDATE progreso_fases SET estado = 'BLOQUEADA', updated_at = NOW()
       WHERE masa_id = $1 AND fase = 'EMPAQUE'`,
      [referenciaId]
    );
    console.log(`Masa ${referenciaId} reabierta a PLANIFICACION (estaba APROBADA)`);
  }

  // 9. Cancelar la masa ADICIONAL -- no se borra nada, queda como historial
  //    de por que existio.
  await client.query(
    `UPDATE masas_produccion
     SET estado = 'CANCELADA', cancelado_por = $2, cancelado_en = NOW(),
         motivo_cancelacion = $3, updated_at = NOW()
     WHERE id = $1`,
    [adicionalId, USUARIO_ID, `Fusionada a masa ${referenciaId} -- Hallazgo 5, backfill 2026-08-26`]
  );

  await snapshot(client, referenciaId, 'DESPUES (referencia)');
  await snapshot(client, adicionalId, 'DESPUES (adicional)');
  console.log(`=== FIN ${adicionalId} -> ${referenciaId} ===\n`);
}

(async () => {
  await db.connect();
  console.log(`Conectado a: ${process.env.DB_NAME}@${process.env.DB_HOST} -- USUARIO_ID=${USUARIO_ID}`);

  for (const caso of CASOS) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await fusionar(client, caso);
      await client.query('COMMIT');
      console.log(`>>> COMMIT OK: ${caso.adicionalId} -> ${caso.referenciaId}`);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof YaFusionadoError) {
        // Idempotencia: no es una falla -- este caso puntual ya se proceso
        // en una corrida anterior. Se salta y se sigue con los restantes,
        // sin duplicar nada (el ROLLBACK de arriba no deshace nada real,
        // porque fusionar() lanzo el error ANTES de escribir nada en este
        // intento).
        console.log(`>>> SKIP (ya procesado antes): ${caso.adicionalId} -> ${caso.referenciaId} -- ${e.message}`);
        continue;
      }
      console.error(`>>> ROLLBACK -- fallo en ${caso.adicionalId} -> ${caso.referenciaId}: ${e.message}`);
      console.error('Deteniendo el script -- revisar manualmente antes de reintentar los casos restantes.');
      process.exit(1);
    } finally {
      client.release();
    }
  }

  // Verificacion final: no debe quedar ninguna masa ADICIONAL con Pesaje
  // bloqueado y referencia mergeable dentro del alcance ya procesado.
  const verifFinal = await db.query(
    `SELECT mp.id, mp.codigo_masa, mp.estado
     FROM masas_produccion mp
     WHERE mp.id = ANY($1::int[])`,
    [CASOS.map(c => c.adicionalId)]
  );
  console.log('\n=== Verificacion final: estado de las ADICIONALes procesadas ===');
  console.log(JSON.stringify(verifFinal.rows, null, 2));

  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
