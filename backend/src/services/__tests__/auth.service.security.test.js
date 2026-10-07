/**
 * Pruebas unitarias (sin BD) de la seguridad de cuentas en auth.service.js:
 *   - punto 1: reinicio del contador al vencer el bloqueo
 *
 * El pool y bcrypt se mockean; se verifica QUÉ SQL se emite y en qué orden.
 * La verificación contra la BD real vive en
 * scripts/tests/test_seguridad_cuentas_auth.sh (staging).
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
const config = require('../../config');
const authService = require('../auth.service');

/**
 * Cliente falso: `handlers` es una lista de [regex, respuesta|fn]; la primera
 * que coincida con el SQL responde. Registra todas las llamadas en `calls`.
 */
function fakeClient(handlers) {
  const calls = [];
  const client = {
    calls,
    release: jest.fn(),
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      for (const [re, res] of handlers) {
        if (re.test(sql)) return typeof res === 'function' ? res(sql, params) : res;
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return client;
}

const usuarioBase = {
  id: 7,
  username: 'usuario.prueba',
  email: 'prueba@example.test',
  password_hash: 'hash-simulado',
  nombre_completo: 'Usuario Prueba',
  rol: 'OPERARIO',
  activo: true,
  email_verificado: true,
  intentos_fallidos: 0,
  bloqueado_hasta: null,
  debe_cambiar_password: false,
  password_expirada: false,
  bloqueo_vencido: false,
};

const selectUsuario = /FROM usuarios\s+WHERE username = \$1 OR email = \$1/;

describe('login — punto 1: reinicio del contador al vencer el bloqueo', () => {
  beforeEach(() => jest.clearAllMocks());

  test('bloqueo VENCIDO: reinicia intentos/bloqueo ANTES de evaluar la contraseña; un fallo suma 1 desde cero', async () => {
    const client = fakeClient([
      [selectUsuario, {
        rows: [{
          ...usuarioBase, intentos_fallidos: 5, bloqueado_hasta: new Date(Date.now() - 60000), bloqueo_vencido: true,
        }],
      }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockImplementation(async () => {
      // En el momento de comparar, el reinicio ya debe haberse emitido
      expect(client.calls.some((c) => /SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = \$1 AND bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= NOW\(\)/.test(c.sql))).toBe(true);
      return false;
    });

    await expect(authService.login({ username: 'usuario.prueba', password: 'x' }))
      .rejects.toThrow('Credenciales inválidas');

    const reinicio = client.calls.findIndex((c) => /SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = \$1 AND bloqueado_hasta/.test(c.sql));
    const incremento = client.calls.findIndex((c) => /intentos_fallidos = intentos_fallidos \+ 1/.test(c.sql));
    expect(reinicio).toBeGreaterThan(-1);
    expect(incremento).toBeGreaterThan(reinicio);
  });

  test('bloqueo VIGENTE: rechaza con el mensaje original y NO reinicia ni incrementa', async () => {
    const client = fakeClient([
      [selectUsuario, {
        rows: [{
          ...usuarioBase, intentos_fallidos: 5, bloqueado_hasta: new Date(Date.now() + 600000), bloqueo_vencido: false,
        }],
      }],
    ]);
    pool.getClient.mockResolvedValue(client);

    await expect(authService.login({ username: 'usuario.prueba', password: 'x' }))
      .rejects.toThrow(/^Cuenta bloqueada hasta/);

    expect(client.calls.some((c) => /intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = \$1 AND bloqueado_hasta IS NOT NULL/.test(c.sql))).toBe(false);
    expect(client.calls.some((c) => /intentos_fallidos \+ 1/.test(c.sql))).toBe(false);
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('sin bloqueo previo: no emite el reinicio', async () => {
    const client = fakeClient([
      [selectUsuario, { rows: [{ ...usuarioBase, intentos_fallidos: 2 }] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);

    await expect(authService.login({ username: 'usuario.prueba', password: 'x' }))
      .rejects.toThrow('Credenciales inválidas');
    expect(client.calls.some((c) => /bloqueado_hasta <= NOW\(\)/.test(c.sql) && /^UPDATE/.test(c.sql))).toBe(false);
  });

  test('el UPDATE de fallo lee umbral y duración de config (valores efectivos: 5 intentos, 30 min)', async () => {
    const client = fakeClient([[selectUsuario, { rows: [{ ...usuarioBase }] }]]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);

    await expect(authService.login({ username: 'usuario.prueba', password: 'x' })).rejects.toThrow();

    const upd = client.calls.find((c) => /intentos_fallidos = intentos_fallidos \+ 1/.test(c.sql));
    expect(upd.params).toEqual([7, config.security.maxLoginAttempts, config.security.lockoutDuration]);
    expect(config.security.maxLoginAttempts).toBe(5);
    expect(config.security.lockoutDuration).toBe(30);
    // Equivalente exacto a la condición histórica (intentos_fallidos >= 4 antes de incrementar)
    expect(upd.sql).toMatch(/WHEN intentos_fallidos \+ 1 >= \$2 THEN NOW\(\) \+ make_interval\(mins => \$3\)/);
  });
});
