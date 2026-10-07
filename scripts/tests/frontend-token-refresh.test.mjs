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
 *   F0  COLISIÓN EXPLÍCITA (punto 7): login y refresh en el MISMO segundo, 5 veces
 *       seguidas, sin esperas -> todas las renovaciones tienen éxito (antes: 409/23505).
 *   F8  sesión única (punto 8e): 401 con code SESSION_REPLACED (sesión reemplazada por otro
 *       login, y access token SIN sid) => 0 llamadas a /auth/refresh, limpia la sesión,
 *       redirige a /login, deja el aviso UNA sola vez y no hay bucle (5 peticiones
 *       simultáneas => 5 llamadas, ninguna reintentada).
 *   F7  cambio de contraseña real (authService.changePassword con el refresh_token
 *       de localStorage): la sesión desde la que se cambia se CONSERVA y la de otra
 *       estación se revoca (el usuario que cambia su clave no queda expulsado).
 *
 * Credenciales: llegan por variables de entorno (TEST_USERNAME /
 * TEST_PASSWORD / NEW_PASSWORD), nunca como argumento ni como literal. Los JWT vencidos se
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

// Un error de axios sin capturar vuelca la configuración de la petición (incluido el cuerpo con la
// contraseña de prueba). Ningún error debe llegar a la salida sin sanear.
const saneado = (e) => (e && e.response ? `HTTP ${e.response.status}` : (e && e.code) || (e && e.message) || 'error');
process.on('uncaughtException', (e) => { console.log(`FALLO: excepción no controlada en el harness (${saneado(e)})`); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log(`FALLO: promesa rechazada sin controlar en el harness (${saneado(e)})`); process.exit(1); });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const TEST_USERNAME = process.env.TEST_USERNAME;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const NEW_PASSWORD = process.env.NEW_PASSWORD;
let claveActual = TEST_PASSWORD; // F7 la cambia; los escenarios posteriores deben usar la vigente

if (!TEST_USERNAME || !TEST_PASSWORD || !NEW_PASSWORD) {
  console.error('FALLO: faltan TEST_USERNAME / TEST_PASSWORD / NEW_PASSWORD en el entorno');
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
const sstore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sstore.has(k) ? sstore.get(k) : null),
  setItem: (k, v) => { sstore.set(k, String(v)); },
  removeItem: (k) => { sstore.delete(k); },
};
// location.replace/href cuentan las NAVEGACIONES: tras un 401 definitivo debe haber exactamente UNA.
const location = {
  href: '',
  pathname: '/dashboard',
  navegaciones: 0,
  replace(url) { this.href = url; this.navegaciones += 1; },
};
globalThis.window = { location, addEventListener() {}, removeEventListener() {} };

// --- compilar el api.ts REAL ---
const outfile = path.join(os.tmpdir(), `api.refresh.${Date.now()}.cjs`);
const entradaApi = path.join(os.tmpdir(), `entrada.api.${Date.now()}.ts`);
fs.writeFileSync(entradaApi, [
  `export { apiService } from ${JSON.stringify(path.join(REPO_ROOT, 'frontend/src/services/api.ts').replace(/\\/g, '/'))};`,
  `export { useAuthStore } from ${JSON.stringify(path.join(REPO_ROOT, 'frontend/src/store/useAuthStore.ts').replace(/\\/g, '/'))};`,
].join('\n'));
buildSync({
  entryPoints: [entradaApi],
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
const { apiService, useAuthStore } = await import(`file://${outfile}`);
fs.rmSync(outfile, { force: true });
fs.rmSync(entradaApi, { force: true });
// utilidad real del aviso (la misma que lee la pantalla de login)
const outAviso = path.join(os.tmpdir(), `sesionReemplazada.${Date.now()}.cjs`);
buildSync({
  entryPoints: [path.join(REPO_ROOT, 'frontend/src/utils/avisoSesion.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: outAviso, logLevel: 'silent',
});
const {
  leerAvisoSesion, descartarAvisoSesion, guardarAvisoSesion, contenidoAviso, motivoDesdeRespuesta, CLAVE_AVISO_SESION,
} = await import(`file://${outAviso}`);
fs.rmSync(outAviso, { force: true });
// authService real (misma clase que usa la pantalla de cambio de contraseña)
const outAuth = path.join(os.tmpdir(), `authService.refresh.${Date.now()}.cjs`);
buildSync({
  entryPoints: [path.join(REPO_ROOT, 'frontend/src/services/authService.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: outAuth, logLevel: 'silent',
  alias: { '@': path.join(REPO_ROOT, 'frontend/src') },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API_URL) },
});
const { authService } = await import(`file://${outAuth}`);
fs.rmSync(outAuth, { force: true });

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
  try {
    const r = await axios.post(`${API_URL}/auth/login`, { username: TEST_USERNAME, password: claveActual },
      { headers: { 'X-Real-IP': '198.51.100.77', 'User-Agent': 'frontend-token-refresh-test/1.0' } });
    return r.data.data; // { user, accessToken, refreshToken }
  } catch (e) {
    throw new Error(`login de prueba falló (${saneado(e)})`);
  }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function nuevaSesionConAccessVencido() {
  // SIN esperas a propósito: login y refresh caen en el mismo segundo. Antes del punto 7 esto
  // producía el mismo refresh token (iat en segundos) y un 409 (23505); con el jti único debe
  // funcionar siempre.
  const d = await loginReal();
  const vencido = tokenVencido({ id: d.user.id, username: d.user.username, email: d.user.email, rol: d.user.rol });
  store.clear();
  localStorage.setItem('auth_token', vencido);
  localStorage.setItem('refresh_token', d.refreshToken);
  globalThis.window.location.href = '';
  globalThis.window.location.navegaciones = 0;
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
check(globalThis.window.location.href === '/login' && globalThis.window.location.navegaciones === 1, 'redirigió a /login con UNA sola navegación', `href=${JSON.stringify(globalThis.window.location.href)} navegaciones=${globalThis.window.location.navegaciones} (se esperaba /login y 1)`);
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
const vigente = jwt.sign({ id: d6.user.id, username: d6.user.username, email: d6.user.email, rol: d6.user.rol, sid: jwt.decode(d6.accessToken).sid }, JWT_SECRET, { expiresIn: '5m' });
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

// ============================ F0 ============================
console.log('\n=== F0: colisión explícita — login + refresh en el MISMO segundo, 5 rondas sin esperas ===');
let rondasOk = 0;
for (let i = 0; i < 5; i += 1) {
  await nuevaSesionConAccessVencido();
  reset();
  let r;
  try { r = await apiService.get('/auth/profile'); } catch (e) { r = { error: e }; }
  if (r && r.success === true && contar('/auth/refresh') === 1) rondasOk += 1;
  else console.log(`  ronda ${i + 1}: ${JSON.stringify(r?.error?.message || r)} (refresh=${contar('/auth/refresh')})`);
}
check(rondasOk === 5, 'F0: las 5 rondas login->refresh inmediato tuvieron éxito (sin 409/23505)', `F0: solo ${rondasOk}/5 rondas tuvieron éxito`);

// ============================ F7 ============================
console.log('\n=== F7: cambio de contraseña real: se conserva la sesión actual, se revoca la de otra estación ===');
const axiosReal = requireFromFrontend('axios');
const refrescarCon = async (rt) => {
  try { const r = await axiosReal.post(`${API_URL}/auth/refresh`, { refreshToken: rt }); return r.status; }
  catch (e) { return e.response ? e.response.status : 0; }
};
const dOtra = await loginReal();        // otra estación con sesión abierta
const dActual = await loginReal();      // la estación que cambia la clave (con sesión única cierra la de arriba)
store.clear();
localStorage.setItem('auth_token', dActual.accessToken);
localStorage.setItem('refresh_token', dActual.refreshToken); // tal como lo deja authService.login
let cambioOk = true;
try { await authService.changePassword(TEST_PASSWORD, NEW_PASSWORD); } catch (e) { cambioOk = false; console.log(`  error: ${e.message}`); }
check(cambioOk, 'F7: authService.changePassword terminó con éxito', 'F7: authService.changePassword falló');
if (cambioOk) claveActual = NEW_PASSWORD;
const stOtra = await refrescarCon(dOtra.refreshToken);
// Con sesión única la otra estación ya cayó al iniciar sesión la actual; la revocación por cambio de
// contraseña con varias sesiones vivas se prueba en test_sesion_unica.sh (caso 4).
check(stOtra === 400, `F7: la sesión de la OTRA estación está revocada (refresh => HTTP ${stOtra})`, `F7: la otra estación NO está revocada (HTTP ${stOtra}, se esperaba 400)`);
const stActual = await refrescarCon(dActual.refreshToken);
check(stActual === 200, `F7: la sesión que cambió la clave SIGUE viva (refresh => HTTP ${stActual}): no queda expulsada`, `F7: la sesión que cambió la clave quedó revocada (HTTP ${stActual}, se esperaba 200)`);

// ============================ F8 ============================
console.log('\n=== F8: SESSION_REPLACED => sin renovar, limpia sesión, UNA navegación a /login, aviso PERSISTENTE con su motivo, sin bucle ===');
const restablecerNavegador = () => {
  store.clear();
  sstore.clear();
  globalThis.window.location.href = '';
  globalThis.window.location.navegaciones = 0;
  globalThis.window.location.pathname = '/dashboard';
  useAuthStore.setState({ user: { username: A_USERNAME }, isAuthenticated: true });
  reset();
};

// F8a: sesión reemplazada de verdad (el login B cierra la sesión de A)
const A = await loginReal();
const B = await loginReal();
const A_USERNAME = A.user.username;
restablecerNavegador();
localStorage.setItem('auth_token', A.accessToken);
localStorage.setItem('refresh_token', A.refreshToken);
let r8;
try { r8 = await apiService.get('/auth/profile'); } catch (e) { r8 = { rejected: true, e }; }
console.log(`peticiones: ${peticiones.map((p) => `${p.method} ${p.url}`).join(' | ')}`);
check(r8 && r8.rejected === true, 'F8a: la petición con el access token de A se rechazó', 'F8a: la petición NO se rechazó');
check(contar('/auth/refresh') === 0, 'F8a: 0 llamadas a /auth/refresh (no se intenta renovar)', `F8a: /auth/refresh llamado ${contar('/auth/refresh')} veces`);
check(contar('/auth/profile') === 1, 'F8a: la petición no se reintentó (1 sola llamada)', `F8a: /auth/profile llamado ${contar('/auth/profile')} veces`);
check(globalThis.window.location.href === '/login' && globalThis.window.location.navegaciones === 1, 'F8a: UNA sola navegación, a /login (sin doble salida SPA + recarga)', `F8a: href=${JSON.stringify(globalThis.window.location.href)} navegaciones=${globalThis.window.location.navegaciones}`);
check(localStorage.getItem('auth_token') === null && localStorage.getItem('refresh_token') === null && localStorage.getItem('auth-storage') === null, 'F8a: sesión limpiada (auth_token, refresh_token y auth-storage)', 'F8a: quedaron datos de sesión');
const aviso8a = leerAvisoSesion();
console.log(`  aviso guardado (clave ${CLAVE_AVISO_SESION}): ${JSON.stringify(aviso8a)}`);
check(aviso8a && aviso8a.motivo === 'OTRO_INICIO' && aviso8a.username === A_USERNAME, 'F8a: el aviso trae motivo OTRO_INICIO (del backend) y el usuario leído del store ANTES de limpiar', `F8a: aviso=${JSON.stringify(aviso8a)}`);
check(CLAVE_AVISO_SESION !== 'aviso_sesion_reemplazada' && sstore.size === 1 && sstore.has(CLAVE_AVISO_SESION), 'F8a: usa su propia clave de sessionStorage y no deja ninguna otra', `F8a: claves=${JSON.stringify([...sstore.keys()])}`);
check(JSON.stringify(leerAvisoSesion()) === JSON.stringify(aviso8a) && JSON.stringify(leerAvisoSesion()) === JSON.stringify(aviso8a), 'F8a: leer el aviso NO lo borra (dos lecturas = la misma) => sobrevive a recargas', 'F8a: el aviso desapareció al leerlo');
check(contenidoAviso(aviso8a).titulo === 'Tu sesión se cerró' && contenidoAviso(aviso8a).fragmentos.map((f) => f.texto).join('') === `Alguien inició sesión con el usuario «${A_USERNAME}» en otro equipo o navegador. Por seguridad, cada usuario solo puede estar abierto en un lugar a la vez. Si no fuiste tú, avísale a tu supervisor.`, 'F8a: texto exacto de OTRO_INICIO con el usuario', 'F8a: texto distinto al pedido');
check(contenidoAviso(aviso8a).fragmentos.filter((f) => f.negrita).map((f) => f.texto).join() === A_USERNAME, 'F8a: el usuario va en negrita', 'F8a: el usuario no está en negrita');
descartarAvisoSesion();
check(leerAvisoSesion() === null && sstore.size === 0, 'F8a: «Entendido» / login exitoso (descartarAvisoSesion) lo borra', 'F8a: el aviso sigue después de descartarlo');

// F8b: 5 peticiones simultáneas con la sesión reemplazada: sin bucle, aviso único
restablecerNavegador();
localStorage.setItem('auth_token', A.accessToken);
localStorage.setItem('refresh_token', A.refreshToken);
const res8b = await Promise.allSettled(Array.from({ length: 5 }, () => apiService.get('/auth/profile')));
console.log(`peticiones: refresh=${contar('/auth/refresh')} profile=${contar('/auth/profile')} rechazadas=${res8b.filter((x) => x.status === 'rejected').length}/5`);
check(res8b.every((x) => x.status === 'rejected'), 'F8b: las 5 se rechazaron', 'F8b: alguna tuvo éxito');
check(contar('/auth/refresh') === 0 && contar('/auth/profile') === 5, 'F8b: 0 renovaciones y exactamente 5 llamadas (ninguna reintentada: sin bucle)', `F8b: refresh=${contar('/auth/refresh')} profile=${contar('/auth/profile')}`);
check(leerAvisoSesion() && leerAvisoSesion().motivo === 'OTRO_INICIO' && sstore.size === 1 && globalThis.window.location.navegaciones >= 1, 'F8b: aviso único (una sola clave, mismo contenido) aunque fallaran 5 peticiones a la vez', `F8b: aviso=${JSON.stringify(leerAvisoSesion())} claves=${sstore.size}`);
reset();
try { await apiService.get('/auth/profile'); } catch { /* esperado */ }
check(contar('/auth/refresh') === 0, 'F8b: una petición posterior sin sesión tampoco renueva', `F8b: refresh=${contar('/auth/refresh')}`);

// F8c: access token SIN sid (emitido con el código anterior) => mismo tratamiento
restablecerNavegador();
const sinSid = jwt.sign({ id: B.user.id, username: B.user.username, email: B.user.email, rol: B.user.rol }, JWT_SECRET, { expiresIn: '5m' });
localStorage.setItem('auth_token', sinSid);
localStorage.setItem('refresh_token', B.refreshToken);
let r8c;
try { r8c = await apiService.get('/auth/profile'); } catch (e) { r8c = { rejected: true, e }; }
check(r8c && r8c.rejected === true && contar('/auth/refresh') === 0, 'F8c: access token sin sid => rechazado SIN intentar renovar', `F8c: rejected=${r8c && r8c.rejected} refresh=${contar('/auth/refresh')}`);
check(globalThis.window.location.href === '/login' && globalThis.window.location.navegaciones === 1, 'F8c: UNA navegación a /login', `F8c: navegaciones=${globalThis.window.location.navegaciones}`);
const aviso8c = leerAvisoSesion();
check(aviso8c && aviso8c.motivo === 'SESION_CERRADA', 'F8c: token sin sid => motivo SESION_CERRADA (no dice que alguien más entró)', `F8c: aviso=${JSON.stringify(aviso8c)}`);
check(contenidoAviso(aviso8c).titulo === 'Vuelve a iniciar sesión' && contenidoAviso(aviso8c).fragmentos.map((f) => f.texto).join('') === 'Por seguridad, tu sesión se cerró. Ingresa de nuevo con tu usuario y contraseña.', 'F8c: texto exacto de SESION_CERRADA', 'F8c: texto distinto al pedido');

// F8d: la sesión B (la vigente) sigue funcionando
restablecerNavegador();
localStorage.setItem('auth_token', B.accessToken);
localStorage.setItem('refresh_token', B.refreshToken);
let r8d;
try { r8d = await apiService.get('/auth/profile'); } catch (e) { r8d = { error: e }; }
check(r8d && r8d.success === true && globalThis.window.location.href === '' && globalThis.window.location.navegaciones === 0 && leerAvisoSesion() === null, 'F8d: la sesión vigente (B) sigue funcionando, sin navegación ni aviso', `F8d: ${JSON.stringify(r8d?.error?.message || r8d)}`);

// F9: utilidad del aviso (sin backend): textos por motivo con y sin usuario, motivo desconocido, JSON dañado, CAMBIO_PASSWORD
console.log('\n=== F9: textos y robustez del aviso (utilidad real) ===');
const txt = (a) => contenidoAviso(a).fragmentos.map((f) => f.texto).join('');
const u9 = aleatorio().slice(0, 8);
check(contenidoAviso({ motivo: 'CAMBIO_PASSWORD', username: u9 }).titulo === 'Tu sesión se cerró' && txt({ motivo: 'CAMBIO_PASSWORD', username: u9 }) === `La contraseña del usuario «${u9}» fue cambiada. Ingresa con la contraseña nueva; si no la conoces, pídela al administrador.`, 'F9: texto exacto de CAMBIO_PASSWORD con usuario', 'F9: CAMBIO_PASSWORD distinto al pedido');
check(!txt({ motivo: 'CAMBIO_PASSWORD' }).includes('«') && !txt({ motivo: 'OTRO_INICIO' }).includes('«'), 'F9: sin usuario conocido el texto se redacta sin él', 'F9: quedó un « huérfano sin usuario');
check(txt({ motivo: 'OTRA_PESTANA' }).includes('otro usuario en este navegador'), 'F9: el aviso de otra pestaña conserva su sentido', 'F9: texto de otra pestaña perdido');
check(motivoDesdeRespuesta({ code: 'SESSION_REPLACED', motivo: 'CAMBIO_PASSWORD' }) === 'CAMBIO_PASSWORD' && motivoDesdeRespuesta({ code: 'SESSION_REPLACED' }) === 'SESION_CERRADA' && motivoDesdeRespuesta({ motivo: 'INVENTADO' }) === 'SESION_CERRADA' && motivoDesdeRespuesta(null) === 'SESION_CERRADA', 'F9: motivo desconocido o ausente => SESION_CERRADA', 'F9: motivoDesdeRespuesta incorrecto');
sstore.set(CLAVE_AVISO_SESION, '{no es json');
check(leerAvisoSesion() === null, 'F9: un JSON dañado en sessionStorage no rompe la pantalla (sin aviso)', 'F9: leyó un aviso inválido');
sstore.set(CLAVE_AVISO_SESION, JSON.stringify({ motivo: 'HACK', username: 'x' }));
check(leerAvisoSesion() === null, 'F9: un motivo no permitido en sessionStorage se ignora', 'F9: aceptó un motivo inválido');
guardarAvisoSesion({ motivo: 'OTRO_INICIO', username: '  ' + 'x'.repeat(300) });
check(leerAvisoSesion().username.length === 100, 'F9: el usuario se recorta a 100 caracteres', 'F9: no se recortó el usuario');
descartarAvisoSesion();

// F10: el aviso de sesión y el de nueva versión no comparten nada (claves ni flujo)
console.log('\n=== F10: independencia respecto del aviso de nueva versión ===');
const fuenteVersion = fs.readFileSync(path.join(REPO_ROOT, 'frontend/src/hooks/useVersionCheck.ts'), 'utf8');
check(!/localStorage|sessionStorage/.test(fuenteVersion), 'F10: useVersionCheck no usa ningún storage (no puede borrar ni leer el aviso de sesión)', 'F10: useVersionCheck usa storage');
check(!fuenteVersion.includes(CLAVE_AVISO_SESION), 'F10: useVersionCheck no menciona la clave del aviso de sesión', 'F10: useVersionCheck toca la clave del aviso');

console.log('');
if (fallos === 0) {
  console.log('TODOS LOS CHECKS DE RENOVACIÓN DE TOKEN PASARON');
  process.exit(0);
}
console.log(`${fallos} CHECK(S) DE RENOVACIÓN DE TOKEN FALLARON`);
process.exit(1);
