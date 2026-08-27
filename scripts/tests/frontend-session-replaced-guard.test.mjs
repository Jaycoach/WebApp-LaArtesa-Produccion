/**
 * Test unitario (Node) de la lógica REAL de
 * frontend/src/utils/sessionReplacedGuard.ts — no una reimplementación.
 *
 * Compila ese archivo (y su dependencia jwt.ts) con esbuild al vuelo y
 * ejecuta la función exportada `debeTratarseComoSesionReemplazada` con
 * distintos StorageEvent simulados.
 *
 * No usa ninguna contraseña ni token real: los JWT de prueba se arman a
 * mano (header.payload.firma-falsa) con ids sintéticos (111/222) — la
 * función bajo prueba nunca verifica firma, solo decodifica el payload,
 * así que un JWT con firma inventada es exactamente lo que hace falta
 * para probar la lógica sin tocar ningún secreto real.
 *
 * Uso: node scripts/tests/frontend-session-replaced-guard.test.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_FILE = path.join(REPO_ROOT, 'frontend/src/utils/sessionReplacedGuard.ts');

// esbuild vive en frontend/node_modules, no en la raíz del repo ni junto a
// este script — resolverlo explícitamente desde ahí en vez de asumir cwd.
const requireFromFrontend = createRequire(path.join(REPO_ROOT, 'frontend/'));
const { buildSync } = requireFromFrontend('esbuild');

if (!fs.existsSync(SRC_FILE)) {
  console.error(`FALLO: no se encontró ${SRC_FILE}`);
  process.exit(1);
}

// Compilar a un archivo temporal CJS y requerirlo — así se ejecuta el
// código TAL CUAL vive en el repo, no una copia mantenida a mano.
const outfile = path.join(os.tmpdir(), `sessionReplacedGuard.${Date.now()}.cjs`);
buildSync({
  entryPoints: [SRC_FILE],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent',
});
const { debeTratarseComoSesionReemplazada } = await import(`file://${outfile}`);
fs.rmSync(outfile, { force: true });

// --- JWT sintéticos, sin firma real ---
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function fakeJwt(payload) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  return `${header}.${body}.firma-de-prueba-no-real`;
}

const tokenUsuarioA_v1 = fakeJwt({ id: 111, username: 'usuario_a', rol: 'OPERARIO', iat: 1000 });
const tokenUsuarioA_v2 = fakeJwt({ id: 111, username: 'usuario_a', rol: 'OPERARIO', iat: 2000 }); // mismo id, ej. refresh
const tokenUsuarioB = fakeJwt({ id: 222, username: 'usuario_b', rol: 'SUPERVISOR', iat: 1500 });
const tokenSinId = fakeJwt({ username: 'sin_id' }); // token decodificable pero sin claim id

let fallos = 0;
function assertCase(desc, actual, esperado) {
  if (actual === esperado) {
    console.log(`OK: ${desc}`);
  } else {
    console.log(`FALLO: ${desc} — esperaba ${esperado}, obtuvo ${actual}`);
    fallos++;
  }
}

// 1) Storage event con token de OTRO usuario -> true (sesión reemplazada)
assertCase(
  'token de otro usuario en otra pestaña -> se trata como sesión reemplazada',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: tokenUsuarioA_v1,
    newValue: tokenUsuarioB,
    isAuthenticated: true,
    currentUserId: 111,
  }),
  true
);

// 2) Storage event con token del MISMO usuario (refresh normal) -> false
assertCase(
  'refresh del mismo usuario (mismo id, distinto iat) -> NO interrumpe',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: tokenUsuarioA_v1,
    newValue: tokenUsuarioA_v2,
    isAuthenticated: true,
    currentUserId: 111,
  }),
  false
);

// 3) Regresión: cambia una clave de localStorage que NO es auth_token -> false
assertCase(
  'cambio en una clave distinta a auth_token -> se ignora por completo',
  debeTratarseComoSesionReemplazada({
    key: 'alguna-otra-clave',
    oldValue: 'x',
    newValue: 'y',
    isAuthenticated: true,
    currentUserId: 111,
  }),
  false
);

// 4) newValue null (logout en otra pestaña) -> false (fuera de alcance de este fix)
assertCase(
  'logout en otra pestaña (newValue null) -> no se trata como sesión reemplazada aquí',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: tokenUsuarioA_v1,
    newValue: null,
    isAuthenticated: true,
    currentUserId: 111,
  }),
  false
);

// 5) Esta pestaña no tenía sesión propia -> false (nada que proteger)
assertCase(
  'pestaña sin sesión propia (isAuthenticated=false) -> no actúa',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: null,
    newValue: tokenUsuarioB,
    isAuthenticated: false,
    currentUserId: null,
  }),
  false
);

// 6) Token nuevo no decodificable / sin id -> false (no actuar a ciegas)
assertCase(
  'token nuevo sin claim id -> no actúa a ciegas',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: tokenUsuarioA_v1,
    newValue: tokenSinId,
    isAuthenticated: true,
    currentUserId: 111,
  }),
  false
);

// 7) oldValue null pero newValue coincide con el usuario actual -> false
assertCase(
  'sin token viejo pero newValue es el mismo usuario actual -> no interrumpe',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: null,
    newValue: tokenUsuarioA_v1,
    isAuthenticated: true,
    currentUserId: 111,
  }),
  false
);

// 8) oldValue null y newValue es OTRO usuario -> true (fallback al id actual funciona)
assertCase(
  'sin token viejo y newValue es otro usuario -> sí se trata como reemplazada',
  debeTratarseComoSesionReemplazada({
    key: 'auth_token',
    oldValue: null,
    newValue: tokenUsuarioB,
    isAuthenticated: true,
    currentUserId: 111,
  }),
  true
);

console.log('');
if (fallos === 0) {
  console.log('TODOS LOS CHECKS PASARON');
  process.exit(0);
} else {
  console.log(`${fallos} CHECK(S) FALLARON`);
  process.exit(1);
}
