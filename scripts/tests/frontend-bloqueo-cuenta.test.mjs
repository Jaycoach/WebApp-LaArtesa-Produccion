/**
 * Test unitario (Node) de la lógica REAL de frontend/src/utils/bloqueoCuenta.ts
 * (la que alimenta la insignia "Bloqueado hasta HH:mm" de la pantalla de usuarios).
 * Compila el archivo con esbuild al vuelo — no es una reimplementación.
 *
 * Verifica: hora en America/Bogota (UTC-5) sin importar el huso del equipo,
 * cambio de día, valores sin zona tratados como UTC, bloqueos vencidos/nulos.
 *
 * Uso: node scripts/tests/frontend-bloqueo-cuenta.test.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const requireFromFrontend = createRequire(path.join(REPO_ROOT, 'frontend/'));
const { buildSync } = requireFromFrontend('esbuild');

const outfile = path.join(os.tmpdir(), `bloqueoCuenta.${Date.now()}.cjs`);
buildSync({
  entryPoints: [path.join(REPO_ROOT, 'frontend/src/utils/bloqueoCuenta.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent',
});
const { cuentaBloqueada, textoBloqueo, detalleBloqueo } = await import(`file://${outfile}`);
fs.rmSync(outfile, { force: true });

let fallos = 0;
const eq = (nombre, actual, esperado) => {
  if (actual === esperado) console.log(`OK: ${nombre} (= ${JSON.stringify(esperado)})`);
  else { console.log(`FALLO: ${nombre}: obtuvo ${JSON.stringify(actual)}, esperaba ${JSON.stringify(esperado)}`); fallos += 1; }
};

// "Ahora" fijo: 2026-10-07 19:05 UTC = 14:05 en Bogotá
const ahora = new Date('2026-10-07T19:05:00Z');

console.log(`(huso del proceso: ${Intl.DateTimeFormat().resolvedOptions().timeZone} — el resultado NO debe depender de él)`);
eq('bloqueo en el futuro => bloqueada', cuentaBloqueada('2026-10-07T19:35:00.000Z', ahora), true);
eq('bloqueo vencido => no bloqueada', cuentaBloqueada('2026-10-07T19:04:59.000Z', ahora), false);
eq('null => no bloqueada', cuentaBloqueada(null, ahora), false);
eq('undefined => no bloqueada', cuentaBloqueada(undefined, ahora), false);
eq('basura => no bloqueada (no lanza)', cuentaBloqueada('no-es-fecha', ahora), false);

eq('19:35Z se muestra como 14:35 de Bogotá', textoBloqueo('2026-10-07T19:35:00.000Z', ahora), 'Bloqueado hasta 14:35');
eq('sin zona (timestamp de la BD) se trata como UTC, no como hora local', textoBloqueo('2026-10-07T19:35:00', ahora), 'Bloqueado hasta 14:35');
eq('formato 24 h (sin a. m./p. m.)', /a\. ?m\.|p\. ?m\./i.test(textoBloqueo('2026-10-07T19:35:00Z', ahora)), false);
eq('mismo día de Bogotá (22:50 -> 23:20 del 7) no agrega fecha',
  textoBloqueo('2026-10-08T04:20:00Z', new Date('2026-10-08T03:50:00Z')), 'Bloqueado hasta 23:20');
eq('el bloqueo cruza la medianoche de Bogotá (23:50 del 7 -> 00:20 del 8) e incluye la fecha',
  textoBloqueo('2026-10-08T05:20:00Z', new Date('2026-10-08T04:50:00Z')), 'Bloqueado hasta 00:20 (8/10/2026)');
eq('vencido => sin texto', textoBloqueo('2026-10-07T19:00:00Z', ahora), null);
eq('null => sin texto', textoBloqueo(null, ahora), null);
eq('el tooltip aclara que es hora de Bogotá', detalleBloqueo('2026-10-07T19:35:00Z').endsWith('(hora de Bogotá)'), true);
eq('tooltip vacío si no hay fecha', detalleBloqueo(null), '');

console.log('');
if (fallos === 0) { console.log('TODOS LOS CHECKS DE bloqueoCuenta PASARON'); process.exit(0); }
console.log(`${fallos} CHECK(S) DE bloqueoCuenta FALLARON`);
process.exit(1);
