/**
 * Punto 2 — los flujos que escriben password_hash se comportan igual:
 *   changePassword (cambio propio), resetPassword (por token) y
 *   resetUserPassword (por administrador).
 *
 * Pruebas unitarias sin BD (se verifica el SQL emitido). Verificación real
 * contra la BD: scripts/tests/test_seguridad_cuentas_auth.sh (staging).
 */

jest.mock('../../database/connection', () => ({ getClient: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), logSecurity: jest.fn(),
}));
jest.mock('../email.service', () => ({
  sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn(),
}));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

const bcrypt = require('bcrypt');
const pool = require('../../database/connection');
const authService = require('../auth.service');
const userService = require('../user.service');
const { fakeClient, sqlDe } = require('./helpers/fakeClient');

const HASH_VIEJO = 'hash-viejo-simulado';
const HASH_NUEVO = 'hash-nuevo-simulado';

/** Comportamiento común a los tres flujos. */
function esperarComportamientoUnificado(client, userId) {
  const historial = sqlDe(client, /^INSERT INTO usuarios_historial_passwords/);
  expect(historial).toHaveLength(1);
  expect(historial[0].params).toEqual([userId, HASH_VIEJO]);

  const upd = sqlDe(client, /^UPDATE usuarios SET password_hash/);
  expect(upd).toHaveLength(1);
  expect(upd[0].sql).toMatch(/password_hash = \$1/);
  expect(upd[0].sql).toMatch(/ultimo_cambio_password = NOW\(\)/);
  expect(upd[0].sql).toMatch(/fecha_actualizacion = NOW\(\)/);
  expect(upd[0].sql).toMatch(/intentos_fallidos = 0/);
  expect(upd[0].sql).toMatch(/bloqueado_hasta = NULL/);
  expect(upd[0].params).toEqual([HASH_NUEVO, userId]);

  expect(sqlDe(client, /^UPDATE usuarios_sesiones SET revocado = true/)).toHaveLength(1);
  expect(client.calls.map((c) => c.sql)).toContain('COMMIT');
}

describe('punto 2 — flujos de contraseña unificados', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks no vacía la cola de mockResolvedValueOnce: un test que falle antes
    // de consumirla contaminaría a los siguientes.
    bcrypt.compare.mockReset();
    bcrypt.hash.mockReset();
  });

  const clienteCambioPropio = () => fakeClient([
    [/SELECT username, nombre_completo, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ username: 'u7', nombre_completo: 'Usuario Siete', password_hash: HASH_VIEJO }] }],
    [/FROM usuarios_historial_passwords/, { rows: [] }],
    [/^UPDATE usuarios_sesiones/, { rowCount: 2, rows: [] }],
  ]);

  test('changePassword CON refreshToken de su sesión: comportamiento unificado y conserva esa sesión', async () => {
    const client = clienteCambioPropio();
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.changePassword(7, 'actual', 'nueva', { refreshToken: 'refresh-sesion-actual' });

    esperarComportamientoUnificado(client, 7);
    const rev = sqlDe(client, /^UPDATE usuarios_sesiones SET revocado = true/)[0];
    expect(rev.sql).toMatch(/refresh_token <> \$2/);
    expect(rev.params).toEqual([7, 'refresh-sesion-actual']);
  });

  test.each([
    ['sin refreshToken', {}],
    ['con refreshToken vacío', { refreshToken: '' }],
    ['con refreshToken no-string', { refreshToken: { $ne: null } }],
  ])('changePassword %s: revoca TODAS las sesiones', async (_nombre, ctx) => {
    const client = clienteCambioPropio();
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.changePassword(7, 'actual', 'nueva', ctx);

    esperarComportamientoUnificado(client, 7);
    const rev = sqlDe(client, /^UPDATE usuarios_sesiones SET revocado = true/)[0];
    expect(rev.sql).not.toMatch(/refresh_token <>/);
    expect(rev.params).toEqual([7]);
  });

  test('changePassword con contraseña actual incorrecta: no escribe nada (ni historial, ni UPDATE, ni revocación)', async () => {
    const client = clienteCambioPropio();
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);

    await expect(authService.changePassword(7, 'incorrecta', 'nueva', { refreshToken: 'r' }))
      .rejects.toThrow('Contraseña actual incorrecta');

    expect(sqlDe(client, /^INSERT INTO usuarios_historial_passwords/)).toHaveLength(0);
    expect(sqlDe(client, /^UPDATE usuarios/)).toHaveLength(0);
    expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
  });

  test('resetPassword por token: comportamiento unificado, consume el token y revoca todas las sesiones', async () => {
    const client = fakeClient([
      [/FROM usuarios\s+WHERE token_recuperacion = \$1/, { rows: [{ id: 9, email: 'a@b.test', password_hash: HASH_VIEJO }] }],
      [/FROM usuarios_historial_passwords/, { rows: [] }],
      [/^UPDATE usuarios_sesiones/, { rowCount: 3, rows: [] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.resetPassword('token-crudo-simulado', 'nueva');

    esperarComportamientoUnificado(client, 9);
    const upd = sqlDe(client, /^UPDATE usuarios SET password_hash/)[0];
    expect(upd.sql).toMatch(/token_recuperacion = NULL/);
    expect(upd.sql).toMatch(/token_recuperacion_expira = NULL/);
    expect(sqlDe(client, /^UPDATE usuarios_sesiones/)[0].sql).not.toMatch(/refresh_token <>/);
  });

  test('resetUserPassword (admin): comportamiento unificado (antes no actualizaba ultimo_cambio_password ni el historial)', async () => {
    const client = fakeClient([
      [/SELECT id, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ id: 12, password_hash: HASH_VIEJO }] }],
      [/^UPDATE usuarios_sesiones/, { rowCount: 2, rows: [] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await userService.resetUserPassword(12, 'clave-temporal');

    esperarComportamientoUnificado(client, 12);
    expect(sqlDe(client, /^UPDATE usuarios SET password_hash/)[0].sql).not.toMatch(/token_recuperacion/);
  });

  test('resetUserPassword con usuario inexistente: no escribe nada y hace ROLLBACK', async () => {
    const client = fakeClient([[/SELECT id, password_hash FROM usuarios/, { rows: [] }]]);
    pool.getClient.mockResolvedValue(client);

    await expect(userService.resetUserPassword(999, 'clave-temporal')).rejects.toThrow('Usuario no encontrado');

    expect(client.calls.some((c) => /^UPDATE|^INSERT/.test(c.sql))).toBe(false);
    expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
  });

  test('setInitialPassword sigue funcionando con los helpers movidos y NO revoca sesiones (fuera de alcance)', async () => {
    const client = fakeClient([
      [/SELECT id, debe_cambiar_password, password_hash FROM usuarios/, { rows: [{ id: 5, debe_cambiar_password: true, password_hash: HASH_VIEJO }] }],
      [/FROM usuarios_historial_passwords/, { rows: [] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.setInitialPassword(5, 'nueva');

    expect(sqlDe(client, /^INSERT INTO usuarios_historial_passwords/)).toHaveLength(1);
    expect(sqlDe(client, /^UPDATE usuarios/)[0].sql).toMatch(/debe_cambiar_password = false/);
    expect(sqlDe(client, /^UPDATE usuarios_sesiones/)).toHaveLength(0);
  });
});
