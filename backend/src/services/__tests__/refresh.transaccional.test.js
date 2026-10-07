/**
 * Punto 7 — refresh token: jti único + rotación transaccional.
 * Pruebas unitarias sin BD (SQL emitido). El comportamiento real (mismo segundo, dos refresh
 * simultáneos) se verifica contra staging en scripts/tests/test_seguridad_cuentas_auth.sh.
 */

jest.mock('../../database/connection', () => ({ getClient: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), logSecurity: jest.fn(),
}));
jest.mock('../email.service', () => ({
  sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn(),
}));
jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../../database/connection');
const { generateTokens } = require('../../utils/jwt');
const authService = require('../auth.service');
const { fakeClient, sqlDe } = require('./helpers/fakeClient');
const { passwordPrueba, hashSimulado } = require('./helpers/secretos');

const usuario = {
  id: 7, username: 'u7', email: 'u7@x.test', nombre_completo: 'U Siete', rol: 'OPERARIO', activo: true,
};
const meta = { ip: '203.0.113.7', userAgent: 'UA/1' };

const SESION_VIGENTE = [/FROM usuarios_sesiones\s+WHERE refresh_token = \$1 AND revocado = false\s+FOR UPDATE/,
  { rows: [{ usuario_id: 7, expires_at: new Date(Date.now() + 86400000) }] }];
const USUARIO_ACTIVO = [/FROM usuarios\s+WHERE id = \$1 AND activo = true/, { rows: [usuario] }];
const INSERT_SESION = /^INSERT INTO usuarios_sesiones/;
const REVOCA = /^UPDATE usuarios_sesiones\s+SET revocado = true\s+WHERE refresh_token = \$1/;

describe('jti único en los tokens', () => {
  test('dos emisiones del mismo usuario en el mismo segundo producen tokens DISTINTOS (access y refresh)', () => {
    const a = generateTokens(usuario);
    const b = generateTokens(usuario);
    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(a.accessToken).not.toBe(b.accessToken);
    const pa = jwt.decode(a.refreshToken);
    const pb = jwt.decode(b.refreshToken);
    expect(pa.iat).toBe(pb.iat); // mismo segundo: antes esto daba el mismo JWT
    expect(pa.jti).toBeTruthy();
    expect(pa.jti).not.toBe(pb.jti);
    expect(jwt.decode(a.accessToken).jti).toBeTruthy();
  });

  test('el access token conserva sus claims de siempre', () => {
    const p = jwt.decode(generateTokens(usuario).accessToken);
    expect(p).toMatchObject({ id: 7, username: 'u7', email: 'u7@x.test', rol: 'OPERARIO' });
  });
});

describe('refreshToken() transaccional', () => {
  beforeEach(() => jest.clearAllMocks());

  test('orden: BEGIN -> SELECT FOR UPDATE -> INSERT nueva -> UPDATE revoca vieja -> COMMIT', async () => {
    const viejo = generateTokens(usuario).refreshToken;
    const client = fakeClient([SESION_VIGENTE, USUARIO_ACTIVO]);
    pool.getClient.mockResolvedValue(client);

    const tokens = await authService.refreshToken(viejo, meta);

    const orden = client.calls.map((c) => c.sql);
    const idx = (re) => orden.findIndex((s) => re.test(s));
    expect(orden[0]).toBe('BEGIN');
    expect(idx(/FOR UPDATE/)).toBeGreaterThan(idx(/^BEGIN$/));
    expect(idx(INSERT_SESION)).toBeGreaterThan(idx(/FOR UPDATE/));
    expect(idx(REVOCA)).toBeGreaterThan(idx(INSERT_SESION)); // primero inserta, luego revoca
    expect(orden[orden.length - 1]).toBe('COMMIT');
    expect(orden).not.toContain('ROLLBACK');
    expect(tokens.refreshToken).not.toBe(viejo);
    const ins = sqlDe(client, INSERT_SESION)[0];
    expect(ins.params).toEqual([7, tokens.refreshToken, '203.0.113.7', 'UA/1']);
    expect(sqlDe(client, REVOCA)[0].params).toEqual([viejo]);
  });

  test('si el INSERT de la sesión nueva falla (p. ej. colisión 23505): ROLLBACK, NO se revoca la vieja, NO hay COMMIT', async () => {
    const viejo = generateTokens(usuario).refreshToken;
    const colision = Object.assign(new Error('duplicate key'), { code: '23505' });
    const client = fakeClient([SESION_VIGENTE, USUARIO_ACTIVO, [INSERT_SESION, () => { throw colision; }]]);
    pool.getClient.mockResolvedValue(client);

    await expect(authService.refreshToken(viejo, meta)).rejects.toThrow('duplicate key');

    const orden = client.calls.map((c) => c.sql);
    expect(orden).toContain('ROLLBACK');
    expect(orden).not.toContain('COMMIT');
    expect(sqlDe(client, REVOCA)).toHaveLength(0); // la sesión del usuario sigue viva
    expect(sqlDe(client, INSERT_SESION)).toHaveLength(1); // 23505 no se reintenta
  });

  test('si falla guardar IP/UA (valor inválido) se reintenta SIN ellos y el refresh se completa', async () => {
    const viejo = generateTokens(usuario).refreshToken;
    let intento = 0;
    const client = fakeClient([SESION_VIGENTE, USUARIO_ACTIVO, [INSERT_SESION, () => {
      intento += 1;
      if (intento === 1) throw Object.assign(new Error('invalid input syntax for type inet'), { code: '22P02' });
      return { rows: [{ id: 2001 }], rowCount: 1 };
    }]]);
    pool.getClient.mockResolvedValue(client);

    await expect(authService.refreshToken(viejo, { ip: 'basura', userAgent: 'x' })).resolves.toHaveProperty('refreshToken');

    const orden = client.calls.map((c) => c.sql);
    expect(orden).toContain('ROLLBACK TO SAVEPOINT sesion_meta');
    expect(sqlDe(client, INSERT_SESION)).toHaveLength(2);
    expect(sqlDe(client, INSERT_SESION)[1].sql).not.toMatch(/ip_address/);
    expect(orden[orden.length - 1]).toBe('COMMIT');
    expect(sqlDe(client, REVOCA)).toHaveLength(1);
  });

  test('token ya revocado (el segundo de dos refresh simultáneos): falla limpio, sin tocar nada', async () => {
    const viejo = generateTokens(usuario).refreshToken;
    const client = fakeClient([[/FOR UPDATE/, { rows: [] }]]);
    pool.getClient.mockResolvedValue(client);

    await expect(authService.refreshToken(viejo, meta)).rejects.toThrow('Token inválido o revocado');

    const orden = client.calls.map((c) => c.sql);
    expect(orden).toContain('ROLLBACK');
    expect(sqlDe(client, INSERT_SESION)).toHaveLength(0);
    expect(sqlDe(client, REVOCA)).toHaveLength(0);
  });

  test('refresh token con firma inválida: rechaza sin abrir transacción', async () => {
    const client = fakeClient();
    pool.getClient.mockResolvedValue(client);
    await expect(authService.refreshToken('no-es-un-jwt', meta)).rejects.toThrow();
    expect(client.calls).toHaveLength(0);
  });

  test('sesión expirada: ROLLBACK y mensaje original', async () => {
    const viejo = generateTokens(usuario).refreshToken;
    const client = fakeClient([[/FOR UPDATE/, { rows: [{ usuario_id: 7, expires_at: new Date(Date.now() - 1000) }] }]]);
    pool.getClient.mockResolvedValue(client);
    await expect(authService.refreshToken(viejo, meta)).rejects.toThrow('Token expirado');
    expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
  });
});

describe('login nunca falla por IP/UA inválidos (punto 6e)', () => {
  beforeEach(() => jest.clearAllMocks());

  const filaLogin = {
    id: 7, username: 'u7', email: 'u7@x.test', password_hash: hashSimulado(), nombre_completo: 'U', rol: 'OPERARIO',
    activo: true, email_verificado: true, intentos_fallidos: 0, bloqueado_hasta: null,
    debe_cambiar_password: false, password_expirada: false, bloqueo_vencido: false,
  };

  test('si el INSERT con IP/UA falla, el login igual entrega tokens (reintenta sin ellos)', async () => {
    let intento = 0;
    const client = fakeClient([
      [/FROM usuarios\s+WHERE username = \$1 OR email = \$1/, { rows: [filaLogin] }],
      [INSERT_SESION, () => {
        intento += 1;
        if (intento === 1) throw Object.assign(new Error('invalid input syntax for type inet'), { code: '22P02' });
        return { rows: [{ id: 2001 }], rowCount: 1 };
      }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(true);

    const res = await authService.login({ username: 'u7', password: passwordPrueba() }, { ip: 'basura', userAgent: 'x' });

    expect(res).toHaveProperty('accessToken');
    expect(res).toHaveProperty('refreshToken');
    expect(sqlDe(client, INSERT_SESION)).toHaveLength(2);
    expect(sqlDe(client, INSERT_SESION)[1].sql).not.toMatch(/ip_address/);
  });
});
