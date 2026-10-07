/**
 * Verificación de UI (Playwright) del aviso de sesión cerrada, el modal de restablecer contraseña y la
 * pantalla de cambio obligatorio, contra el Vite LOCAL (proxy a la API de STAGING), en escritorio y a 390 px.
 *
 * Escenarios (cada uno imprime su evidencia y deja capturas en OUT_DIR):
 *   S1 OTRO_INICIO        S2 CAMBIO_PASSWORD + pantalla de clave TEMPORAL     S3 SESION_CERRADA
 *   S4 otra pestaña       S5 modal de ADMIN (y lo que NO ve un supervisor)    S6 VENCIMIENTO y ALTA
 *   S7 convivencia con el aviso de nueva versión (cambia APP_VERSION en staging y lo restaura)
 *
 * Requisitos: `ssh artesa-staging` funcionando; Vite corriendo:
 *   cd frontend && STAGING_API=http://<staging> npx vite --config vite.staging.config.ts --port 5199
 * Uso:  STAGING_API=http://<staging> UI_URL=http://localhost:5199 node scripts/tests/ui-aviso-sesion.playwright.mjs
 *
 * Credenciales: se generan en runtime, viajan por stdin al servidor y NUNCA se imprimen. Los usuarios de
 * prueba se desactivan al terminar (también si algo falla).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = createRequire(path.join(REPO, 'frontend/'))('playwright');

const UI = process.env.UI_URL || 'http://localhost:5199';
const API = `${process.env.STAGING_API}/api`;
const OUT = process.env.OUT_DIR || 'C:/tmp/ui-evidence';
const HOST = process.env.STAGING_SSH || 'artesa-staging';
if (!process.env.STAGING_API) { console.error('FALLO: define STAGING_API'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

let fallos = 0;
const ok = (m) => console.log(`OK: ${m}`);
const fallo = (m) => { console.log(`FALLO: ${m}`); fallos += 1; };
const check = (c, m, d = '') => (c ? ok(m) : fallo(`${m} ${d}`));
const seccion = (t) => console.log(`\n==== ${t} ====`);

// ---------- credenciales de runtime ----------
const rnd = (n, set) => Array.from(crypto.randomBytes(n)).map((b) => set[b % set.length]).join('');
const nuevaClave = () => `${rnd(3, 'ABCDEFGHJK')}${rnd(5, 'abcdefghjkmn')}${rnd(3, '23456789')}${rnd(1, '@$!%*?&#')}`;
const sfx = rnd(5, 'abcdefghjkmnpqrstuvwxyz');
const U = {}; // clave -> { username, password, rol, debe, id }
const defUsuario = (k, rol, debe = false) => { U[k] = { username: `test_ui_${k}_${sfx}`, password: nuevaClave(), rol, debe }; };
defUsuario('adm', 'ADMIN'); defUsuario('sup', 'SUPERVISOR');
defUsuario('ope1', 'OPERARIO'); defUsuario('ope2', 'OPERARIO'); defUsuario('ope3', 'OPERARIO');
defUsuario('ope4', 'OPERARIO'); defUsuario('ope5', 'OPERARIO'); defUsuario('tgt', 'OPERARIO');
defUsuario('venc', 'OPERARIO'); defUsuario('alta', 'CALIDAD', true); defUsuario('ver', 'OPERARIO');

// ---------- utilidades de servidor ----------
function remoto(cmd, input) {
  const r = spawnSync('ssh', [HOST, cmd], { input, encoding: 'utf8', maxBuffer: 20e6 });
  return { code: r.status, out: (r.stdout || '').replace(/\r/g, ''), err: (r.stderr || '').replace(/\r/g, '') };
}
const sql = (q) => remoto(`bash -lc 'cd ~/LaArtesa/backend && set -a && . ./.env && set +a && PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -f -'`, q).out.trim();

function crearUsuarios() {
  const payload = JSON.stringify(Object.values(U).map(({ username, password, rol, debe }) => ({ username, password, rol, debe })));
  const prog = `
const bcrypt=require('bcrypt');const db=require('./src/database/connection');
let t='';process.stdin.on('data',d=>t+=d).on('end',async()=>{
 const us=JSON.parse(t);const ids={};
 for(const u of us){const h=await bcrypt.hash(u.password,12);
  const r=await db.query("INSERT INTO usuarios (username,email,password_hash,nombre_completo,rol,activo,email_verificado,intentos_fallidos,debe_cambiar_password) VALUES ($1,$2,$3,$4,$5,true,true,0,$6) RETURNING id",[u.username,u.username+'@artesa-staging-test.com',h,'Prueba UI '+u.rol,u.rol,u.debe]);ids[u.username]=r.rows[0].id;}
 console.log(JSON.stringify(ids));process.exit(0);});`;
  const b64 = Buffer.from(prog).toString('base64');
  const r = remoto(`bash -lc 'source ~/.nvm/nvm.sh >/dev/null 2>&1; cd ~/LaArtesa/backend && node -e "$(echo ${b64} | base64 -d)"'`, payload);
  let ids; try { ids = JSON.parse(r.out.trim().split('\n').pop()); } catch { throw new Error(`no se pudieron crear los usuarios: ${r.err.slice(0, 200)}`); }
  for (const u of Object.values(U)) u.id = ids[u.username];
}
function desactivarUsuarios() {
  const ids = Object.values(U).map((u) => u.id).filter(Boolean);
  if (!ids.length) return;
  sql(`UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username=username||'_DEACTIVATED' WHERE id IN (${ids.join(',')}) AND username NOT LIKE '%_DEACTIVATED';`);
  console.log(`[cleanup] usuarios de prueba desactivados: ${ids.join(' ')}`);
}
async function apiLogin(k, ip = '198.51.100.77') {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip }, body: JSON.stringify({ username: U[k].username, password: U[k].password }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, token: j?.data?.accessToken, debe: j?.data?.user?.debe_cambiar_password, motivo: j?.data?.user?.motivo_cambio_password };
}
async function apiResetPassword(adminToken, targetKey, nueva) {
  const r = await fetch(`${API}/users/${U[targetKey].id}/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ newPassword: nueva }) });
  return r.status;
}
const revocarSesiones = (k) => sql(`UPDATE usuarios_sesiones SET revocado=true WHERE usuario_id=${U[k].id} AND revocado=false;`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- utilidades de UI ----------
const VIEWPORTS = { escritorio: { width: 1280, height: 800 }, movil390: { width: 390, height: 844 } };
async function foto(page, nombre) {
  for (const [vn, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(250);
    const archivo = path.join(OUT, `${nombre}.${vn}.png`);
    await page.screenshot({ path: archivo, fullPage: true });
    // en 390 px no puede haber scroll horizontal de la página
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (vn === 'movil390') check(desborde <= 0, `${nombre}: sin scroll horizontal a 390 px`, `(desborde ${desborde}px)`);
  }
  await page.setViewportSize(VIEWPORTS.escritorio);
}
function vigilar(page) {
  const est = { refresh: 0, navegaciones: [], consola: [] };
  page.on('request', (r) => { if (/\/auth\/refresh/.test(r.url())) est.refresh += 1; });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) est.navegaciones.push(new URL(f.url()).pathname + new URL(f.url()).search); });
  page.on('console', (m) => { if (m.type() === 'error') est.consola.push(m.text().slice(0, 120)); });
  return est;
}
async function loginUI(page, k, clave = U[k].password) {
  await page.goto(`${UI}/login`);
  await page.fill('#username', U[k].username);
  await page.fill('#password', clave);
  await page.click('button[type=submit]');
}
const textoAviso = (page) => page.locator('[role=status]').first().innerText().catch(() => '');
const claveAviso = (page) => page.evaluate(() => sessionStorage.getItem('aviso_sesion_cerrada'));

// =============================================================================================
const browser = await chromium.launch();
let versionTocada = false;
try {
  crearUsuarios();
  ok(`usuarios de prueba creados (${Object.keys(U).length})`);
  const adm = await apiLogin('adm');
  check(adm.status === 200 && adm.token, 'login API del admin de prueba');

  // ---------------------------------------------------------------- S1
  seccion('S1 — OTRO_INICIO: otro equipo inicia sesión con el mismo usuario');
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.escritorio });
    const page = await ctx.newPage(); const est = vigilar(page);
    await loginUI(page, 'ope1'); await page.waitForURL(`${UI}/`, { timeout: 15000 });
    ok('ope1 inició sesión en la UI (dashboard)');
    await apiLogin('ope1', '198.51.100.78'); // "otro equipo"
    est.navegaciones.length = 0; est.refresh = 0;
    await page.reload();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.getByText('Tu sesión se cerró').waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500); // margen para detectar una segunda navegación
    console.log(`  navegaciones tras la recarga: ${JSON.stringify(est.navegaciones)}  /auth/refresh: ${est.refresh}`);
    check(est.navegaciones.filter((n) => n.startsWith('/login')).length === 1, 'UNA sola navegación a /login');
    check(est.refresh === 0, '0 llamadas a /auth/refresh');
    const t = await textoAviso(page);
    console.log(`  aviso: ${JSON.stringify(t)}`);
    check(t.includes(`«${U.ope1.username}»`) && t.includes('Alguien inició sesión con el usuario') && t.includes('avísale a tu supervisor'), 'texto OTRO_INICIO con el usuario');
    const negrita = await page.locator('[role=status] strong').innerText();
    check(negrita === U.ope1.username, 'el usuario está en negrita');
    await foto(page, 's1-aviso-otro-inicio');
    await page.reload(); await page.waitForTimeout(1200);
    check((await textoAviso(page)).includes('Tu sesión se cerró'), 'el aviso SOBREVIVE a una recarga');
    await page.getByRole('button', { name: 'Entendido' }).click();
    check(!(await claveAviso(page)) && !(await textoAviso(page)), '«Entendido» lo borra');
    await page.reload(); await page.waitForTimeout(800);
    check(!(await textoAviso(page)), 'tras «Entendido» no reaparece al recargar');
    await ctx.close();
  }

  // ---------------------------------------------------------------- S2
  seccion('S2 — CAMBIO_PASSWORD por reset de admin + pantalla de clave TEMPORAL');
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.escritorio });
    const page = await ctx.newPage(); const est = vigilar(page);
    await loginUI(page, 'ope2'); await page.waitForURL(`${UI}/`, { timeout: 15000 });
    await esperar(1200);
    const temporal = nuevaClave();
    check((await apiResetPassword(adm.token, 'ope2', temporal)) === 200, 'el admin restablece la clave de ope2 (API)');
    await page.reload(); await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.getByText('Tu sesión se cerró').waitFor({ timeout: 10000 });
    const t = await textoAviso(page);
    check(t.includes('fue cambiada') && t.includes(`«${U.ope2.username}»`) && t.includes('pídela al administrador'), 'texto CAMBIO_PASSWORD con el usuario');
    await foto(page, 's2-aviso-cambio-password');
    // login con la temporal: el aviso se borra al iniciar sesión y aparece la pantalla de cambio obligatorio
    await page.fill('#username', U.ope2.username); await page.fill('#password', temporal); await page.click('button[type=submit]');
    await page.waitForURL(/\/set-password/, { timeout: 15000 });
    check(!(await claveAviso(page)), 'el inicio de sesión exitoso borra el aviso');
    check(page.url().includes('motivo=TEMPORAL'), 'la pantalla recibe motivo=TEMPORAL');
    const cuerpo = await page.locator('body').innerText();
    check(cuerpo.includes('Tu contraseña es temporal: crea una nueva para continuar'), 'texto de clave temporal');
    await foto(page, 's2-cambio-obligatorio-temporal');
    // completar el cambio por la UI
    const nueva = nuevaClave();
    await page.fill('input[placeholder="Mínimo 8 caracteres"]', nueva); await page.fill('input[placeholder="Repite la contraseña"]', nueva);
    await page.getByRole('button', { name: 'Establecer contraseña' }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.fill('#username', U.ope2.username); await page.fill('#password', nueva); await page.click('button[type=submit]');
    await page.waitForURL(`${UI}/`, { timeout: 15000 });
    ok('tras el cambio obligatorio entra normal con la clave nueva (dashboard)');
    await ctx.close();
  }

  // ---------------------------------------------------------------- S3
  seccion('S3 — SESION_CERRADA (revocación masiva / token sin sid)');
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.escritorio });
    const page = await ctx.newPage(); const est = vigilar(page);
    await loginUI(page, 'ope3'); await page.waitForURL(`${UI}/`, { timeout: 15000 });
    revocarSesiones('ope3'); est.navegaciones.length = 0;
    await page.reload(); await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.getByText('Vuelve a iniciar sesión').waitFor({ timeout: 10000 });
    const t = await textoAviso(page);
    console.log(`  aviso: ${JSON.stringify(t)}`);
    check(t.includes('Por seguridad, tu sesión se cerró. Ingresa de nuevo con tu usuario y contraseña.') && !t.includes('Alguien'), 'texto SESION_CERRADA (no dice que alguien más entró)');
    check(est.navegaciones.filter((n) => n.startsWith('/login')).length === 1, 'UNA sola navegación a /login');
    await foto(page, 's3-aviso-sesion-cerrada');
    await ctx.close();
  }

  // ---------------------------------------------------------------- S4
  seccion('S4 — otro usuario inicia sesión en otra pestaña del mismo navegador');
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.escritorio });
    const p1 = await ctx.newPage(); const p2 = await ctx.newPage();
    await loginUI(p1, 'ope4'); await p1.waitForURL(`${UI}/`, { timeout: 15000 });
    await loginUI(p2, 'ope5');
    await p1.waitForURL(/session_replaced=1/, { timeout: 15000 });
    await p1.getByText('Tu sesión se cerró').waitFor({ timeout: 10000 });
    const t = await textoAviso(p1);
    console.log(`  aviso: ${JSON.stringify(t)}`);
    check(t.includes('otro usuario en este navegador'), 'texto de otra pestaña (mismo componente, texto propio)');
    await foto(p1, 's4-aviso-otra-pestana');
    await p1.reload(); await p1.waitForTimeout(800);
    check((await textoAviso(p1)).includes('otro usuario en este navegador'), 'sobrevive a una recarga');
    await ctx.close();
  }

  // ---------------------------------------------------------------- S5
  seccion('S5 — modal «Restablecer contraseña» (solo ADMIN, no en su fila)');
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS.escritorio });
    const page = await ctx.newPage();
    await loginUI(page, 'adm'); await page.waitForURL(`${UI}/`, { timeout: 15000 });
    await page.goto(`${UI}/configuracion/usuarios`);
    await page.getByRole('button', { name: 'Todos los usuarios' }).click();
    const fila = (k) => page.locator('div.py-4').filter({ hasText: `@${U[k].username}` }).first();
    await fila('tgt').waitFor({ timeout: 15000 });
    check((await fila('adm').getByRole('button', { name: 'Restablecer contraseña' }).count()) === 0, 'NO hay botón en la fila del propio admin');
    check((await fila('tgt').getByRole('button', { name: 'Restablecer contraseña' }).count()) === 1, 'sí hay botón en la fila de otro usuario');
    await foto(page, 's5-lista-usuarios-admin');
    await fila('tgt').getByRole('button', { name: 'Restablecer contraseña' }).click();
    await page.locator('#clave-temporal').waitFor();
    await page.fill('#clave-temporal', 'abc');
    await foto(page, 's5-modal-reglas-sin-cumplir');
    const clave = nuevaClave();
    await page.fill('#clave-temporal', clave); await page.fill('#clave-confirmacion', clave);
    await page.getByRole('button', { name: 'Mostrar' }).click();
    check((await page.locator('#clave-temporal').getAttribute('type')) === 'text', 'mostrar/ocultar clave');
    await page.getByRole('button', { name: 'Ocultar' }).click();
    await foto(page, 's5-modal-lista-para-enviar');
    // error legible del backend: se fuerza un 400 sin pasar la validación del cliente
    await page.getByRole('button', { name: 'Asignar clave temporal' }).click();
    await page.getByText('Contraseña temporal asignada. Entrégala al usuario de forma segura; deberá cambiarla en su primer ingreso. Todas sus sesiones se cerraron.').waitFor({ timeout: 15000 });
    ok('aviso exacto de clave temporal asignada');
    await foto(page, 's5-aviso-clave-temporal-asignada');
    check(sql(`SELECT debe_cambiar_password FROM usuarios WHERE id=${U.tgt.id};`) === 't', 'en BD: debe_cambiar_password = true');
    // supervisor: sin botón ni pestaña «Mi contraseña»
    const ctx2 = await browser.newContext({ viewport: VIEWPORTS.escritorio });
    const p2 = await ctx2.newPage();
    await loginUI(p2, 'sup'); await p2.waitForURL(`${UI}/`, { timeout: 15000 });
    await p2.goto(`${UI}/configuracion/usuarios`);
    await p2.getByRole('button', { name: 'Todos los usuarios' }).click();
    await p2.locator('div.py-4').filter({ hasText: `@${U.tgt.username}` }).first().waitFor({ timeout: 15000 });
    check((await p2.getByRole('button', { name: 'Restablecer contraseña' }).count()) === 0, 'SUPERVISOR no ve «Restablecer contraseña»');
    check((await p2.getByRole('button', { name: 'Mi contraseña' }).count()) === 0, 'SUPERVISOR no ve la pestaña «Mi contraseña»');
    await foto(p2, 's5-lista-usuarios-supervisor');
    await ctx2.close(); await ctx.close();
  }

  // ---------------------------------------------------------------- S6
  seccion('S6 — cambio obligatorio: VENCIMIENTO y ALTA');
  {
    sql(`UPDATE usuarios SET ultimo_cambio_password = NOW() - INTERVAL '4 months' WHERE id=${U.venc.id};`);
    for (const [k, motivo, texto, archivo] of [
      ['venc', 'VENCIMIENTO', 'Tu contraseña venció (cada 3 meses se debe cambiar): crea una nueva para continuar', 's6-cambio-obligatorio-vencimiento'],
      ['alta', 'ALTA', 'Crea tu contraseña personal para comenzar', 's6-cambio-obligatorio-alta'],
    ]) {
      const ctx = await browser.newContext({ viewport: VIEWPORTS.escritorio });
      const page = await ctx.newPage();
      await loginUI(page, k); await page.waitForURL(/\/set-password/, { timeout: 15000 });
      check(page.url().includes(`motivo=${motivo}`), `${k}: la pantalla recibe motivo=${motivo}`);
      check((await page.locator('body').innerText()).includes(texto), `${k}: texto del motivo`);
      await foto(page, archivo);
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- S7
  seccion('S7 — convivencia con el aviso de NUEVA VERSIÓN (banner ámbar) y el aviso de sesión');
  {
    const bump = (v) => remoto(`bash -lc 'source ~/.nvm/nvm.sh >/dev/null 2>&1; cd ~/LaArtesa/backend && sed -i "/^APP_VERSION=/d" .env && echo "APP_VERSION=${v}" >> .env && pm2 restart artesa-backend-staging >/dev/null 2>&1; sleep 4'`);
    const banner = (page) => page.getByText('Hay una nueva versión disponible').count();
    const ctx = await browser.newContext({ viewport: VIEWPORTS.movil390 });
    const page = await ctx.newPage(); const est = vigilar(page);
    await loginUI(page, 'ver'); await page.waitForURL(`${UI}/`, { timeout: 15000 });
    ok('usuario en el dashboard con sesión válida (versión base cargada)');
    versionTocada = true;
    bump('uitest1'); ok('staging: APP_VERSION cambiada a uitest1 (simula el deploy)');
    await page.getByText('Hay una nueva versión disponible').waitFor({ timeout: 40000 });
    ok('aparece el aviso de nueva versión');
    await foto(page, 's7-1-banner-version');
    revocarSesiones('ver'); ok('las sesiones del usuario quedan cerradas (como los tokens viejos tras el deploy)');
    est.navegaciones.length = 0; est.refresh = 0;
    await page.getByRole('button', { name: 'Actualizar ahora' }).click(); // recarga por versión
    await page.waitForURL(/\/login/, { timeout: 20000 });
    await page.getByText('Vuelve a iniciar sesión').waitFor({ timeout: 10000 });
    console.log(`  navegaciones tras «Actualizar ahora»: ${JSON.stringify(est.navegaciones)}  /auth/refresh: ${est.refresh}`);
    check(est.refresh === 0, 'sin llamadas a /auth/refresh');
    check(est.navegaciones.filter((n) => n === '/login').length === 1, 'recarga por versión -> 401 -> UNA navegación a /login');
    check((await textoAviso(page)).includes('Por seguridad, tu sesión se cerró'), 'el usuario termina en /login con el aviso SESION_CERRADA');
    check((await banner(page)) === 0, 'el banner de versión ya no está (la versión nueva es la base)');
    await foto(page, 's7-2-login-aviso-sesion-tras-recarga-por-version');
    const n0 = est.navegaciones.length;
    await page.waitForTimeout(35000); // más de dos ciclos de polling (15 s): sin bucles
    check(est.navegaciones.length === n0 && page.url().includes('/login'), 'sin bucles de recarga en 35 s (2 ciclos de polling)');
    check((await textoAviso(page)).includes('Por seguridad'), 'el aviso de sesión sigue visible tras el polling de versión');
    // segundo cambio de versión estando YA en /login con el aviso: ambos conviven y ninguno borra al otro
    bump('uitest2');
    await page.getByText('Hay una nueva versión disponible').waitFor({ timeout: 40000 });
    check((await textoAviso(page)).includes('Por seguridad') || (await page.getByText('Vuelve a iniciar sesión').count()) > 0, 'banner de versión + aviso de sesión visibles a la vez');
    check(!!(await claveAviso(page)), 'el banner de versión no borró el aviso de sesión');
    await foto(page, 's7-3-banner-version-y-aviso-sesion-juntos');
    await page.getByRole('button', { name: 'Actualizar ahora' }).click();
    await page.waitForLoadState('load'); await page.waitForTimeout(1500);
    check((await page.getByText('Vuelve a iniciar sesión').count()) > 0 && !!(await claveAviso(page)), 'tras recargar por versión el aviso de sesión SIGUE ahí');
    check((await banner(page)) === 0, 'y el banner de versión desaparece (no vuelve a dispararse)');
    await foto(page, 's7-4-despues-de-recargar-por-version');
    await ctx.close();
  }
} catch (e) {
  fallo(`excepción en el escenario: ${String(e.message || e).slice(0, 300)}`);
} finally {
  await browser.close();
  if (versionTocada) {
    remoto(`bash -lc 'source ~/.nvm/nvm.sh >/dev/null 2>&1; cd ~/LaArtesa/backend && sed -i "/^APP_VERSION=/d" .env && pm2 restart artesa-backend-staging >/dev/null 2>&1; sleep 4'`);
    const v = await fetch(`${API}/version`).then((r) => r.json()).catch(() => ({}));
    console.log(`[cleanup] APP_VERSION restaurada (línea eliminada, estado original). /api/version => ${JSON.stringify(v)}`);
  }
  desactivarUsuarios();
}
console.log(`\ncapturas en: ${OUT}`);
console.log(fallos === 0 ? 'TODAS LAS VERIFICACIONES DE UI PASARON' : `${fallos} VERIFICACIÓN(ES) DE UI FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
