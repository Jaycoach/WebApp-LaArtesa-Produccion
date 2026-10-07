/**
 * Pruebas unitarias (sin BD) de la seguridad de cuentas en auth.service.js:
 *   - punto 1: reinicio del contador al vencer el bloqueo
 *   - punto 3: trazabilidad de login (IP/UA en la sesión, log de fallos)
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
const logger = require('../../utils/logger');
const pool = require('../../database/connection');
const config = require('../../config');
const authService = require('../auth.service');
const { passwordPrueba, hashSimulado } = require('./helpers/secretos');

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
  password_hash: hashSimulado(),
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

    await expect(authService.login({ username: 'usuario.prueba', password: passwordPrueba() }))
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

    await expect(authService.login({ username: 'usuario.prueba', password: passwordPrueba() }))
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

    await expect(authService.login({ username: 'usuario.prueba', password: passwordPrueba() }))
      .rejects.toThrow('Credenciales inválidas');
    expect(client.calls.some((c) => /bloqueado_hasta <= NOW\(\)/.test(c.sql) && /^UPDATE/.test(c.sql))).toBe(false);
  });

  test('el UPDATE de fallo lee umbral y duración de config (valores efectivos: 5 intentos, 30 min)', async () => {
    const client = fakeClient([[selectUsuario, { rows: [{ ...usuarioBase }] }]]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);

    await expect(authService.login({ username: 'usuario.prueba', password: passwordPrueba() })).rejects.toThrow();

    const upd = client.calls.find((c) => /intentos_fallidos = intentos_fallidos \+ 1/.test(c.sql));
    expect(upd.params).toEqual([7, config.security.maxLoginAttempts, config.security.lockoutDuration]);
    expect(config.security.maxLoginAttempts).toBe(5);
    expect(config.security.lockoutDuration).toBe(30);
    // Equivalente exacto a la condición histórica (intentos_fallidos >= 4 antes de incrementar)
    expect(upd.sql).toMatch(/WHEN intentos_fallidos \+ 1 >= \$2 THEN NOW\(\) \+ make_interval\(mins => \$3\)/);
  });
});

describe('login — punto 3: trazabilidad', () => {
  const PW_SECRETA = passwordPrueba(); // generada en runtime: no debe aparecer en ningún log
  const meta = { ip: '203.0.113.7', userAgent: 'NavegadorPrueba/9.9' };

  beforeEach(() => jest.clearAllMocks());

  const logsComoTexto = () => JSON.stringify([
    ...logger.warn.mock.calls, ...logger.error.mock.calls, ...logger.info.mock.calls,
  ]);

  test('login exitoso guarda ip_address y user_agent en usuarios_sesiones', async () => {
    const client = fakeClient([[selectUsuario, { rows: [{ ...usuarioBase }] }]]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(true);

    await authService.login({ username: 'usuario.prueba', password: PW_SECRETA }, meta);

    const ins = client.calls.find((c) => /^INSERT INTO usuarios_sesiones/.test(c.sql));
    expect(ins.sql).toMatch(/\(usuario_id, refresh_token, expires_at, ip_address, user_agent\)/);
    expect(ins.params[0]).toBe(7);
    expect(ins.params[2]).toBe('203.0.113.7');
    expect(ins.params[3]).toBe('NavegadorPrueba/9.9');
  });

  test('login sin meta sigue funcionando (ip/user_agent NULL)', async () => {
    const client = fakeClient([[selectUsuario, { rows: [{ ...usuarioBase }] }]]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(true);

    await authService.login({ username: 'usuario.prueba', password: PW_SECRETA });

    const ins = client.calls.find((c) => /^INSERT INTO usuarios_sesiones/.test(c.sql));
    expect(ins.params[2]).toBeNull();
    expect(ins.params[3]).toBeNull();
  });

  test.each([
    ['usuario_inexistente', { rows: [] }, null],
    ['password_incorrecta', { rows: [{ ...usuarioBase }] }, false],
    ['cuenta_bloqueada', { rows: [{ ...usuarioBase, bloqueado_hasta: new Date(Date.now() + 600000) }] }, null],
    ['cuenta_desactivada', { rows: [{ ...usuarioBase, activo: false }] }, null],
  ])('fallo %s: el log lleva username, IP y motivo, y nunca la contraseña', async (motivo, filas, compare) => {
    const client = fakeClient([[selectUsuario, filas]]);
    pool.getClient.mockResolvedValue(client);
    if (compare !== null) bcrypt.compare.mockResolvedValue(compare);

    await expect(authService.login({ username: 'usuario.prueba', password: PW_SECRETA }, meta)).rejects.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      `Login fallido username="usuario.prueba" ip=203.0.113.7 motivo=${motivo} ua="NavegadorPrueba/9.9"`,
    );
    expect(logsComoTexto()).not.toContain(PW_SECRETA);
  });

  test('un username con saltos de línea no puede falsear líneas del log', async () => {
    const client = fakeClient([[selectUsuario, { rows: [] }]]);
    pool.getClient.mockResolvedValue(client);

    await expect(authService.login({ username: 'admin\n2026-01-01 info: Login exitoso', password: PW_SECRETA }, meta))
      .rejects.toThrow('Credenciales inválidas');

    const linea = logger.warn.mock.calls[0][0];
    expect(linea).not.toMatch(/[\r\n]/);
    expect(linea).toContain('motivo=usuario_inexistente');
  });

  test('sin IP disponible el log lo dice explícitamente', async () => {
    const client = fakeClient([[selectUsuario, { rows: [] }]]);
    pool.getClient.mockResolvedValue(client);
    await expect(authService.login({ username: 'x', password: PW_SECRETA })).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith('Login fallido username="x" ip=desconocida motivo=usuario_inexistente ua="desconocido"');
  });
});
