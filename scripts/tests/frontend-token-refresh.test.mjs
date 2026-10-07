/**
 * Test end-to-end (Node) del interceptor REAL de frontend/src/services/api.ts
 * contra el backend REAL de staging — no una reimplementación.
 *
 * Compila api.ts (con sus dependencias: authService, useAuthStore, config)
 * con esbuild al vuelo, simula localStorage/window y ejecuta peticiones
 * reales con un access token VENCIDO (firmado con el secreto real del
 * backend, leído de backend/.env dentro del proceso — nunca se imprime).
 *
 * Escenarios (cada uno imprime su evidencia):
 *   F1  access vencido + refresh válido  -> 1 solo POST /auth/refresh, la
 *       petición original se reintenta y TIENE ÉXITO.
 *   F2  5 peticiones simultáneas con access vencido -> exactamente 1
 *       POST /auth/refresh compartido y las 5 tienen éxito.
 *   F3  access vencido + refresh inválido -> la petición falla, se limpia
 *       la sesión (auth_token, refresh_token, store), redirige a /login y
 *       NO hay bucle (1 solo intento de refresh; una petición posterior sin
 *       sesión no vuelve a llamar al backend de refresh).
 *   F4  guarda anti-bucle: si /auth/refresh responde 401 NO se reintenta
 *       renovar (adapter simulado: se cuenta cuántas veces se pide).
 *   F5  /auth/login que responde 401 NO dispara renovación (adapter simulado).
 *   F6  carrera entre pestañas: otra pestaña ya rotó el token -> se
 *       reintenta con el token nuevo SIN llamar a /auth/refresh.
 *
 * Credenciales: llegan por variables de entorno (TEST_USERNAME /
 * TEST_PASSWORD), nunca como argumento ni como literal. Los JWT vencidos se
 * firman en runtime con el secreto del .env; nada de eso se imprime.
 *
 * Uso (EN STAGING, desde la raíz del repo):
 *   API_URL=http://localhost:3000/api TEST_USERNAME=... TEST_PASSWORD=... \
 *     node scripts/tests/frontend-token-refresh.test.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const TEST_USERNAME = process.env.TEST_USERNAME;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

if (!TEST_USERNAME || !TEST_PASSWORD) {
  console.error('FALLO: faltan TEST_USERNAME / TEST_PASSWORD en el entorno');
  process.exit(1);
}

const requireFromFrontend = createRequire(path.join(REPO_ROOT, 'frontend/'));
const requireFromBackend = createRequire(path.join(REPO_ROOT, 'backend/'));
const { buildSync } = requireFromFrontend('esbuild');
const jwt = requireFromBackend('jsonwebtoken');

// --- secreto JWT real (solo en memoria) ---
function leerEnv(clave) {
  const txt = fs.readFileSync(path.join(REPO_ROOT, 'backend/.env'), 'utf8');
  const m = txt.match(new RegExp(`^${clave}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}
const JWT_SECRET = leerEnv('JWT_SECRET') || 'your-super-secret-jwt-key-change-in-production';

// --- simulación mínima de navegador ---
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.window = { location: { href: '', pathname: '/dashboard' }, addEventListener() {}, removeEventListener() {} };

// --- compilar el api.ts REAL ---
const outfile = path.join(os.tmpdir(), `api.refresh.${Date.now()}.cjs`);
buildSync({
  entryPoints: [path.join(REPO_ROOT, 'frontend/src/services/api.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  logLevel: 'silent',
  alias: { '@': path.join(REPO_ROOT, 'frontend/src') },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(API_URL),
  },
});
const { apiService } = await import(`file://${outfile}`);
fs.rmSync(outfile, { force: true });

// --- utilidades de test ---
// Ningún secreto es literal (CLAUDE.md): los valores falsos también se generan en runtime.
const aleatorio = () => crypto.randomBytes(12).toString('base64url');
const RT_SIMULADO = aleatorio();
let fallos = 0;
const ok = (m) => console.log(`OK: ${m}`);
const fallo = (m) => { console.log(`FALLO: ${m}`); fallos += 1; };
const check = (cond, okMsg, failMsg) => (cond ? ok(okMsg) : fallo(failMsg));

const inst = apiService.axiosInstance;
const peticiones = []; // { method, url, status? }
inst.interceptors.request.use((cfg) => { peticiones.push({ url: cfg.url, method: (cfg.method || '').toUpperCase() }); return cfg; });
const contar = (fragmento) => peticiones.filter((p) => (p.url || '').includes(fragmento)).length;
const reset = () => { peticiones.length = 0; };

function tokenVencido(payload) {
  return jwt.sign({ ...payload }, JWT_SECRET, { expiresIn: -60 });
}

// --- login real (HTTP) para obtener sesión legítima ---
async function loginReal() {
  const axios = requireFromFrontend('axios');
  const r = await axios.post(`${API_URL}/auth/login`, { username: TEST_USERNAME, password: TEST_PASSWORD },
    { headers: { 'X-Real-IP': '198.51.100.77', 'User-Agent': 'frontend-token-refresh-test/1.0' } });
  return r.data.data; // { user, accessToken, refreshToken }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function nuevaSesionConAccessVencido() {
  // El refresh token JWT se firma solo con {id, iat(s)}: dos emisiones del mismo usuario en el
  // mismo segundo producen el MISMO token y chocan con UNIQUE(usuarios_sesiones.refresh_token)
  // (bug preexistente del backend, reportado aparte). Se separa login y refresh por >1 s para
  // que este test mida el interceptor y no esa colisión.
  await esperar(1100);
  const d = await loginReal();
  await esperar(1100);
  const vencido = tokenVencido({ id: d.user.id, username: d.user.username, email: d.user.email, rol: d.user.rol });
  store.clear();
  localStorage.setItem('auth_token', vencido);
  localStorage.setItem('refresh_token', d.refreshToken);
  globalThis.window.location.href = '';
  globalThis.window.location.pathname = '/dashboard';
  return d;
}

// ============================ F1 ============================
console.log('\n=== F1: access vencido + refresh válido -> 1 refresh + reintento OK ===');
await nuevaSesionConAccessVencido();
reset();
let r1;
try { r1 = await apiService.get('/auth/profile'); } catch (e) { r1 = { error: e }; }
console.log(`peticiones: ${peticiones.map((p) => `${p.method} ${p.url}`).join(' | ')}`);
check(r1 && r1.success === true, 'la petición original terminó con éxito tras renovar', `la petición original NO tuvo éxito: ${JSON.stringify(r1?.error?.message || r1)}`);
check(contar('/auth/refresh') === 1, 'exactamente 1 POST /auth/refresh', `POST /auth/refresh fue llamado ${contar('/auth/refresh')} veces (se esperaba 1)`);
check(contar('/auth/profile') === 2, 'la petición original se reintentó una vez (2 GET /auth/profile: el 401 y el éxito)', `GET /auth/profile fue llamado ${contar('/auth/profile')} veces (se esperaba 2)`);
const nuevoAccess = localStorage.getItem('auth_token');
let accesoVigente = false;
try { jwt.verify(nuevoAccess, JWT_SECRET); accesoVigente = true; } catch { /* vencido */ }
check(accesoVigente, 'auth_token en localStorage quedó con un access token vigente', 'auth_token sigue vencido/ inválido tras renovar');
check(globalThis.window.location.href === '', 'no hubo redirección a /login', `hubo redirección inesperada: ${globalThis.window.location.href}`);

// ============================ F2 ============================
console.log('\n=== F2: 5 peticiones simultáneas con access vencido -> 1 solo refresh compartido ===');
await nuevaSesionConAccessVencido();
reset();
const resultados = await Promise.allSettled(Array.from({ length: 5 }, () => apiService.get('/auth/profile')));
const exitosas = resultados.filter((x) => x.status === 'fulfilled' && x.value?.success === true).length;
console.log(`peticiones: refresh=${contar('/auth/refresh')} profile=${contar('/auth/profile')} exitosas=${exitosas}/5`);
check(exitosas === 5, 'las 5 peticiones tuvieron éxito', `solo ${exitosas}/5 tuvieron éxito`);
check(contar('/auth/refresh') === 1, 'exactamente 1 POST /auth/refresh para las 5 (single-flight)', `POST /auth/refresh fue llamado ${contar('/auth/refresh')} veces (se esperaba 1)`);

// ============================ F3 ============================
console.log('\n=== F3: refresh inválido -> limpia sesión, redirige a /login, SIN bucle ===');
await nuevaSesionConAccessVencido();
localStorage.setItem('refresh_token', aleatorio());
reset();
let r3;
try { r3 = await apiService.get('/auth/profile'); } catch (e) { r3 = { rejected: true, e }; }
console.log(`peticiones: ${peticiones.map((p) => `${p.method} ${p.url}`).join(' | ')}`);
check(r3 && r3.rejected === true, 'la petición se rechazó (no se enmascara el fallo)', 'la petición NO se rechazó');
check(contar('/auth/refresh') === 1, '1 solo intento de refresh (sin bucle)', `POST /auth/refresh fue llamado ${contar('/auth/refresh')} veces (se esperaba 1)`);
check(globalThis.window.location.href === '/login', 'redirigió a /login', `href=${JSON.stringify(globalThis.window.location.href)} (se esperaba /login)`);
check(localStorage.getItem('auth_token') === null && localStorage.getItem('refresh_token') === null, 'auth_token y refresh_token fueron limpiados', 'quedaron tokens en localStorage tras el fallo');
reset();
try { await apiService.get('/auth/profile'); } catch { /* esperado */ }
check(contar('/auth/refresh') === 0, 'una petición posterior sin sesión NO vuelve a llamar a /auth/refresh', `se llamó /auth/refresh ${contar('/auth/refresh')} veces tras limpiar sesión`);

// ============================ F4 / F5 (adapter simulado) ============================
console.log('\n=== F4/F5: guardas anti-bucle con respuestas 401 simuladas ===');
const adapterOriginal = inst.defaults.adapter;
const llamadas = [];
inst.defaults.adapter = (cfg) => {
  llamadas.push(cfg.url);
  const err = new Error('401 simulado');
  err.isAxiosError = true;
  err.config = cfg;
  err.response = { status: 401, data: { success: false }, headers: {}, config: cfg };
  return Promise.reject(err);
};
store.clear();
localStorage.setItem('auth_token', aleatorio());
localStorage.setItem('refresh_token', RT_SIMULADO);
globalThis.window.location.href = '';
try { await apiService.post('/auth/refresh', { refreshToken: RT_SIMULADO }); } catch { /* esperado */ }
check(llamadas.filter((u) => u.includes('/auth/refresh')).length === 1, 'F4: un 401 en /auth/refresh NO dispara otra renovación (1 sola llamada)', `F4: /auth/refresh llamado ${llamadas.filter((u) => u.includes('/auth/refresh')).length} veces`);

llamadas.length = 0;
store.clear();
localStorage.setItem('auth_token', aleatorio());
localStorage.setItem('refresh_token', RT_SIMULADO);
globalThis.window.location.href = '';
try { await apiService.post('/auth/login', { username: aleatorio(), password: aleatorio() }); } catch { /* esperado */ }
check(llamadas.filter((u) => u.includes('/auth/refresh')).length === 0, 'F5: un 401 en /auth/login NO dispara renovación', `F5: se llamó /auth/refresh ${llamadas.filter((u) => u.includes('/auth/refresh')).length} veces desde /auth/login`);
inst.defaults.adapter = adapterOriginal;

// ============================ F6 ============================
console.log('\n=== F6: otra pestaña ya rotó el token -> reintento con el token nuevo, sin /auth/refresh ===');
const d6 = await nuevaSesionConAccessVencido();
// Simula que OTRA pestaña, entre el envío y el 401, ya renovó y dejó un access vigente:
const vigente = jwt.sign({ id: d6.user.id, username: d6.user.username, email: d6.user.email, rol: d6.user.rol }, JWT_SECRET, { expiresIn: '5m' });
inst.interceptors.request.use((cfg) => {
  // Solo en el primer envío: tras salir con el token viejo, "otra pestaña" escribe el nuevo.
  if (!globalThis.__otraPestaña && (cfg.url || '').includes('/auth/profile')) {
    globalThis.__otraPestaña = true;
    setTimeout(() => localStorage.setItem('auth_token', vigente), 0);
  }
  return cfg;
});
reset();
let r6;
try { r6 = await apiService.get('/auth/profile'); } catch (e) { r6 = { error: e }; }
console.log(`peticiones: ${peticiones.map((p) => `${p.method} ${p.url}`).join(' | ')}`);
check(r6 && r6.success === true, 'F6: la petición terminó con éxito usando el token que dejó la otra pestaña', `F6: no tuvo éxito: ${JSON.stringify(r6?.error?.message || r6)}`);
check(contar('/auth/refresh') === 0, 'F6: NO se llamó a /auth/refresh (evita rotar dos veces el mismo refresh token)', `F6: se llamó /auth/refresh ${contar('/auth/refresh')} veces`);

console.log('');
if (fallos === 0) {
  console.log('TODOS LOS CHECKS DE RENOVACIÓN DE TOKEN PASARON');
  process.exit(0);
}
console.log(`${fallos} CHECK(S) DE RENOVACIÓN DE TOKEN FALLARON`);
process.exit(1);
