/**
 * Backfill de masas_lotes_simulados (migración 068).
 *
 * Cubre masas que quedaron APROBADAS / en PLANIFICACION ANTES de este deploy
 * (nunca pasaron por aprobarMasaCore/updateUnidadesProgramadas con la
 * simulación nueva) — sin este backfill, confirmarPesaje las cubriría igual
 * vía su propio fallback (simula al vuelo si no encuentra plan), pero
 * Empaque ya se habría quedado sin el correo de aprobación con el lote real
 * y sin poder verlo en pantalla antes del pesaje. Ver FASE de implementación
 * (2026-08-24), paso 10.
 *
 * Alcance: SOLO estado='APROBADA'. Se evaluó también incluir estado='PENDIENTE'
 * (masas aún no aprobadas por un supervisor) y se descartó a propósito: esas
 * masas todavía no pasaron por el delta+2 default ni por la simulación de
 * grupo (simularAjusteDivisorPorGrupo) que solo corren dentro de
 * aprobarMasaCore, así que cualquier plan calculado ahora sobre unidades sin
 * ajustar quedaría estructuralmente distinto al que se generaría al aprobar
 * de verdad — y guardarPlanLotes() fijaría lote_produccion en una masa que
 * el supervisor ni siquiera revisó todavía. Si Jonathan confirma que sí hace
 * falta cubrir PENDIENTE, se ajusta el filtro de abajo.
 *
 * Uso:
 *   node scripts/backfill_lotes_simulados.js --dry-run   (BEGIN + ROLLBACK, no persiste nada)
 *   node scripts/backfill_lotes_simulados.js             (BEGIN + COMMIT real)
 *
 * Filtro de fecha opcional (sin ninguno de estos flags, el alcance es TODAS
 * las masas candidatas — mismo comportamiento ya validado en staging, para
 * no romper ese uso):
 *   --fecha=YYYY-MM-DD              (mp.fecha_produccion = esa fecha exacta)
 *   --desde=YYYY-MM-DD [--hasta=YYYY-MM-DD]   (rango, cualquiera de los dos
 *                                               por separado también es válido)
 * --fecha es mutuamente excluyente con --desde/--hasta (error explícito si
 * se combinan, para no dejar ambigüedad sobre qué filtro aplicó).
 *
 * Idempotente: la selección de candidatas ya filtra
 * "NOT EXISTS masas_lotes_simulados para esa masa", así que correr el script
 * dos veces no vuelve a tocar una masa ya backfilleada (equivalente en
 * efecto a ON CONFLICT DO NOTHING, sin necesitarlo: guardarPlanLotes() hace
 * DELETE+INSERT completo por diseño para la re-simulación en vivo — usar
 * ON CONFLICT DO NOTHING ahí sería incorrecto para ese otro caso de uso).
 */

const { Pool } = require('pg');
require('dotenv').config();
const config = require('../src/config');
const { simularPlanLotes, guardarPlanLotes } = require('../src/controllers/fases.controller');

const DRY_RUN = process.argv.includes('--dry-run');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function leerArgFecha(nombre) {
  const arg = process.argv.find(a => a.startsWith(`--${nombre}=`));
  if (!arg) return null;
  const valor = arg.slice(`--${nombre}=`.length);
  if (!FECHA_RE.test(valor)) {
    throw new Error(`--${nombre} debe tener formato YYYY-MM-DD (recibido: "${valor}")`);
  }
  return valor;
}

const FECHA = leerArgFecha('fecha');
const DESDE = leerArgFecha('desde');
const HASTA = leerArgFecha('hasta');

if (FECHA && (DESDE || HASTA)) {
  throw new Error('--fecha es mutuamente excluyente con --desde/--hasta — use uno u otro, no ambos.');
}

// Filtro de fecha opcional sobre mp.fecha_produccion — construido con
// placeholders numerados a partir de $1 y aplicado tal cual al WHERE de la
// query de candidatas. Sin --fecha/--desde/--hasta, filtroFechaSql queda
// vacío y filtroFechaParams vacío: mismo alcance de siempre (todas).
let filtroFechaSql = '';
const filtroFechaParams = [];
if (FECHA) {
  filtroFechaParams.push(FECHA);
  filtroFechaSql = `AND mp.fecha_produccion = $${filtroFechaParams.length}`;
} else if (DESDE || HASTA) {
  const partes = [];
  if (DESDE) { filtroFechaParams.push(DESDE); partes.push(`mp.fecha_produccion >= $${filtroFechaParams.length}`); }
  if (HASTA) { filtroFechaParams.push(HASTA); partes.push(`mp.fecha_produccion <= $${filtroFechaParams.length}`); }
  filtroFechaSql = `AND ${partes.join(' AND ')}`;
}

const pool = new Pool({
  host:     config.database.host,
  port:     config.database.port,
  database: config.database.name,
  user:     config.database.user,
  password: config.database.password,
  ssl:      config.database.ssl,
});

async function main() {
  const client = await pool.connect();
  const resumen = { ok: [], sinBom: [], error: [] };

  try {
    await client.query('BEGIN');

    const candidatas = await client.query(`
      SELECT mp.id, mp.codigo_masa, mp.fecha_produccion
      FROM masas_produccion mp
      WHERE mp.estado = 'APROBADA'
        AND mp.fase_actual = 'PLANIFICACION'
        AND NOT EXISTS (
          SELECT 1 FROM ingredientes_masa im
          WHERE im.masa_id = mp.id AND im.pesado = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM masas_lotes_simulados mls WHERE mls.masa_id = mp.id
        )
        ${filtroFechaSql}
      ORDER BY mp.fecha_produccion
    `, filtroFechaParams);

    const descFiltro = FECHA ? ` (fecha_produccion = ${FECHA})`
      : (DESDE || HASTA) ? ` (fecha_produccion ${DESDE ? `>= ${DESDE}` : ''}${DESDE && HASTA ? ' AND ' : ''}${HASTA ? `<= ${HASTA}` : ''})`
      : ' (todas las fechas)';
    console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Candidatas para backfill${descFiltro}: ${candidatas.rows.length}`);
    if (candidatas.rows.length > 0) {
      const fechasDistintas = [...new Set(candidatas.rows.map(r => r.fecha_produccion.toISOString().slice(0, 10)))].sort();
      console.log(`  Fechas presentes en las candidatas: ${fechasDistintas.join(', ')}`);
    }

    for (const m of candidatas.rows) {
      try {
        const plan = await simularPlanLotes(m.id, client);
        if (!plan) {
          console.warn(`  [SIN BOM] masa ${m.id} (${m.codigo_masa}, ${m.fecha_produccion.toISOString().slice(0, 10)}) — sin productos aptos con BOM, se omite.`);
          resumen.sinBom.push(m.id);
          continue;
        }
        // simulado_por = NULL explícito: esta simulación la corrió el script,
        // no un usuario real — mismo criterio de "no inventar autoría" que la
        // migración 067 (Case B, usuario_id NULL cuando no hay quién firmarlo).
        await guardarPlanLotes(m.id, plan, null, client);
        const lotes = plan.tandas.map(t => t.lote).join(', ');
        console.log(`  [OK] masa ${m.id} (${m.codigo_masa}, ${m.fecha_produccion.toISOString().slice(0, 10)}) → ${lotes}`);
        resumen.ok.push(m.id);
      } catch (err) {
        console.error(`  [ERROR] masa ${m.id} (${m.codigo_masa}): ${err.message}`);
        resumen.error.push(m.id);
      }
    }

    if (resumen.error.length > 0) {
      throw new Error(`${resumen.error.length} masa(s) fallaron durante la simulación — abortando transacción completa (nada se persiste). IDs: ${resumen.error.join(', ')}`);
    }

    // Verificación dentro de la misma transacción, antes de decidir commit/rollback
    const verificacion = await client.query(`
      SELECT mp.id, mp.codigo_masa, mp.fecha_produccion, mp.estado,
             COUNT(mls.id) AS filas_lote_simulado
      FROM masas_produccion mp
      LEFT JOIN masas_lotes_simulados mls ON mls.masa_id = mp.id
      WHERE mp.estado = 'APROBADA' AND mp.fase_actual = 'PLANIFICACION'
      GROUP BY mp.id, mp.codigo_masa, mp.fecha_produccion, mp.estado
      ORDER BY mp.fecha_produccion
    `);
    console.log('\n── Verificación (APROBADA + PLANIFICACION, todas) ──');
    console.table(verificacion.rows.map(r => ({
      id: r.id, codigo_masa: r.codigo_masa,
      fecha: r.fecha_produccion.toISOString().slice(0, 10),
      estado: r.estado, filas_lote_simulado: r.filas_lote_simulado,
    })));
    const enCero = verificacion.rows.filter(r => parseInt(r.filas_lote_simulado, 10) === 0);
    if (enCero.length > 0) {
      console.warn(`\n⚠️  ${enCero.length} masa(s) APROBADA/PLANIFICACION quedan con filas_lote_simulado=0 (posible: ya tenían ingrediente pesado, o sin BOM):`);
      console.table(enCero.map(r => ({ id: r.id, codigo_masa: r.codigo_masa, fecha: r.fecha_produccion.toISOString().slice(0, 10) })));
    } else {
      console.log('\n✅ Ninguna masa APROBADA/PLANIFICACION quedó con filas_lote_simulado=0.');
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n[DRY-RUN] ROLLBACK aplicado — nada quedó persistido.');
    } else {
      await client.query('COMMIT');
      console.log('\nCOMMIT aplicado.');
    }

    console.log(`\nResumen: ${resumen.ok.length} OK, ${resumen.sinBom.length} sin BOM (omitidas), ${resumen.error.length} con error.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nERROR — transacción revertida por completo, nada quedó persistido.');
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
