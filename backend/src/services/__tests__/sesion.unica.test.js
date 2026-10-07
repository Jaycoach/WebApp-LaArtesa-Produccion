/**
 * Sesión única por usuario (punto 8): login transaccional que cierra las demás sesiones,
 * auditoría SESION_REEMPLAZADA, sid en el access token e interruptor de emergencia.
 * Pruebas unitarias sin BD (SQL emitido). La verificación real (simultáneos, 401 al instante,
 * auditoría en BD) vive en scripts/tests/test_sesion_unica.sh (staging).
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
const config = require('../../config');
const { generateTokens, generarAccessToken } = require('../../utils/jwt');
const authService = require('../auth.service');
const { fakeClient, sqlDe } = require('./helpers/fakeClient');
const { passwordPrueba, hashSimulado, tokenPrueba } = require('./helpers/secretos');

const SELECT_USUARIO = /FROM usuarios\s+WHERE username = \$1 OR email = \$1/;
const REVOCA_TODAS = /^UPDATE usuarios_sesiones SET revocado = true\s+WHERE usuario_id = \$1 AND revocado = false\s+RETURNING/;
const INSERT_SESION = /^INSERT INTO usuarios_sesiones/;
const INSERT_AUDITORIA = /^INSERT INTO auditoria_cambios/;

const fila = {
  id: 7, username: 'u7', email: 'u7@x.test', password_hash: hashSimulado(), nombre_completo: 'Usuario Siete',
  rol: 'OPERARIO', activo: true, email_verificado: true, intentos_fallidos: 0, bloqueado_hasta: null,
  debe_cambiar_password: false, password_expirada: false, bloqueo_vencido: false,
};
const meta = { ip: '203.0.113.7', userAgent: 'NavegadorNuevo/1' };

function clienteLogin(desplazadas = [], extra = []) {
  return fakeClient([
    [SELECT_USUARIO, { rows: [fila] }],
    [REVOCA_TODAS, { rows: desplazadas, rowCount: desplazadas.length }],
    ...extra,
  ]);
}

describe('interruptor SINGLE_SESSION_PER_USER (config.security)', () => {
  const original = process.env.SINGLE_SESSION_PER_USER;
  afterEach(() => {
    if (original === undefined) delete process.env.SINGLE_SESSION_PER_USER;
    else process.env.SINGLE_SESSION_PER_USER = original;
    jest.resetModules();
  });
  const leer = (valor) => {
    if (valor === undefined) delete process.env.SINGLE_SESSION_PER_USER;
    else process.env.SINGLE_SESSION_PER_USER = valor;
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../../config').security.singleSessionPerUser;
  };

  test('sin la variable definida: ACTIVA', () => { expect(leer(undefined)).toBe(true); });
  test.each([['false'], ['FALSE'], [' False ']])("solo un 'false' explícito (%j) la desactiva", (v) => {
    expect(leer(v)).toBe(false);
  });
  test.each([[''], ['true'], ['0'], ['no'], ['off'], ['desactivar']])('cualquier otro valor (%j) la deja ACTIVA', (v) => {
    expect(leer(v)).toBe(true);
  });
  test('el valor efectivo actual del entorno de pruebas es activa (config.security)', () => {
    expect(config.security.singleSessionPerUser).toBe(true);
  });
});

describe('login — sesión única (b)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockReset();
    bcrypt.compare.mockResolvedValue(true);
    config.security.singleSessionPerUser = true;
  });

  test('una transacción: BEGIN -> bloquea la fila del usuario -> revoca las demás -> inserta la nueva -> COMMIT', async () => {
    const client = clienteLogin([{ ip: '198.51.100.1', user_agent: 'Viejo/1' }]);
    pool.getClient.mockResolvedValue(client);

    await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    const orden = client.calls.map((c) => c.sql);
    const idx = (re) => orden.findIndex((s) => re.test(s));
    expect(orden).toContain('BEGIN');
    expect(idx(/^SELECT id FROM usuarios WHERE id = \$1 FOR UPDATE$/)).toBeGreaterThan(idx(/^BEGIN$/));
    expect(idx(REVOCA_TODAS)).toBeGreaterThan(idx(/FOR UPDATE$/));
    expect(idx(INSERT_SESION)).toBeGreaterThan(idx(REVOCA_TODAS)); // revoca y luego inserta
    expect(orden[orden.length - 1]).toBe('COMMIT');
    expect(orden).not.toContain('ROLLBACK');
    expect(sqlDe(client, REVOCA_TODAS)[0].params).toEqual([7]);
  });

  test('el access token lleva sid = id de la fila recién insertada', async () => {
    const client = clienteLogin();
    pool.getClient.mockResolvedValue(client);

    const res = await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    const sid = jwt.decode(res.accessToken).sid;
    expect(sid).toBeGreaterThan(1000); // el id que devolvió el INSERT ... RETURNING id del fake
    expect(sqlDe(client, INSERT_SESION)[0].sql).toMatch(/RETURNING id$/);
  });

  test('si falla el INSERT de la sesión nueva: ROLLBACK y las anteriores NO quedan revocadas (sin COMMIT)', async () => {
    const colision = Object.assign(new Error('duplicate key'), { code: '23505' });
    const client = clienteLogin([{ ip: null, user_agent: null }], [[INSERT_SESION, () => { throw colision; }]]);
    pool.getClient.mockResolvedValue(client);

    await expect(authService.login({ username: 'u7', password: passwordPrueba() }, meta)).rejects.toThrow('duplicate key');

    const orden = client.calls.map((c) => c.sql);
    expect(orden).toContain('ROLLBACK');
    expect(orden).not.toContain('COMMIT');
    expect(sqlDe(client, INSERT_AUDITORIA)).toHaveLength(0);
  });

  test('si falla guardar IP/UA se reintenta sin ellos y el login se completa (insertarSesion intacto)', async () => {
    let intento = 0;
    const client = clienteLogin([], [[INSERT_SESION, () => {
      intento += 1;
      if (intento === 1) throw Object.assign(new Error('invalid input syntax for type inet'), { code: '22P02' });
      return { rows: [{ id: 3001 }], rowCount: 1 };
    }]]);
    pool.getClient.mockResolvedValue(client);

    const res = await authService.login({ username: 'u7', password: passwordPrueba() }, { ip: 'basura', userAgent: 'x' });

    expect(jwt.decode(res.accessToken).sid).toBe(3001);
    expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK TO SAVEPOINT sesion_meta');
    expect(sqlDe(client, INSERT_SESION)[1].sql).not.toMatch(/ip_address/);
  });

  test('con el interruptor en false: NO revoca nada, NO audita; el login crea su sesión igual', async () => {
    config.security.singleSessionPerUser = false;
    const client = clienteLogin([{ ip: '198.51.100.1', user_agent: 'Viejo/1' }]);
    pool.getClient.mockResolvedValue(client);

    const res = await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    expect(sqlDe(client, REVOCA_TODAS)).toHaveLength(0);
    expect(sqlDe(client, INSERT_AUDITORIA)).toHaveLength(0);
    expect(sqlDe(client, INSERT_SESION)).toHaveLength(1);
    expect(jwt.decode(res.accessToken).sid).toBeTruthy(); // el sid siempre se emite
    config.security.singleSessionPerUser = true;
  });
});

describe('auditoría SESION_REEMPLAZADA (c)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockReset();
    bcrypt.compare.mockResolvedValue(true);
    config.security.singleSessionPerUser = true;
  });

  test('registra cuántas se cerraron, IP/navegador de las desplazadas y del nuevo login, solo si se cerró alguna', async () => {
    const client = clienteLogin([
      { ip: '198.51.100.1', user_agent: 'Estacion1/1' },
      { ip: '198.51.100.2', user_agent: 'Estacion2/2' },
      { ip: null, user_agent: null },
    ]);
    pool.getClient.mockResolvedValue(client);

    await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    const [ins] = sqlDe(client, INSERT_AUDITORIA);
    expect(ins.params[0]).toBe(7);
    expect(JSON.parse(ins.params[1])).toEqual({
      evento: 'SESION_REEMPLAZADA',
      sesiones_cerradas: 3,
      desplazadas: [
        { ip: '198.51.100.1', navegador: 'Estacion1/1' },
        { ip: '198.51.100.2', navegador: 'Estacion2/2' },
        { ip: null, navegador: null },
      ],
      desplazadas_omitidas: 0,
      nuevo_login: { ip: '203.0.113.7', navegador: 'NavegadorNuevo/1' },
    });
    expect(ins.params[3]).toBe(7); // actor = el usuario que inicia sesión
    expect(ins.params.slice(5, 7)).toEqual(['203.0.113.7', 'NavegadorNuevo/1']);
    expect(ins.params[7]).toMatch(/^SESION_REEMPLAZADA: 3 sesión\(es\) cerrada\(s\)/);
  });

  test('sin sesiones previas vigentes NO se audita', async () => {
    const client = clienteLogin([]);
    pool.getClient.mockResolvedValue(client);
    await authService.login({ username: 'u7', password: passwordPrueba() }, meta);
    expect(sqlDe(client, INSERT_AUDITORIA)).toHaveLength(0);
  });

  test('con 36 sesiones desplazadas: cuenta las 36 pero detalla solo 20 y acota el navegador a 150 caracteres', async () => {
    const muchas = Array.from({ length: 36 }, (_, i) => ({ ip: `198.51.100.${i + 1}`, user_agent: 'U'.repeat(400) }));
    const client = clienteLogin(muchas);
    pool.getClient.mockResolvedValue(client);

    await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    const detalle = JSON.parse(sqlDe(client, INSERT_AUDITORIA)[0].params[1]);
    expect(detalle.sesiones_cerradas).toBe(36);
    expect(detalle.desplazadas).toHaveLength(20);
    expect(detalle.desplazadas_omitidas).toBe(16);
    expect(detalle.desplazadas[0].navegador).toHaveLength(150);
  });

  test('ni el jsonb ni el motivo contienen tokens ni hashes, y las claves de nivel superior no parecen secretos', async () => {
    const refreshViejo = tokenPrueba();
    const client = clienteLogin([{ ip: '198.51.100.1', user_agent: 'Estacion1/1' }]);
    pool.getClient.mockResolvedValue(client);

    const res = await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    const { params } = sqlDe(client, INSERT_AUDITORIA)[0];
    const volcado = JSON.stringify(params);
    [fila.password_hash, refreshViejo, res.accessToken, res.refreshToken, '$2b$'].forEach((secreto) => {
      expect(volcado).not.toContain(secreto);
    });
    expect(volcado).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // ningún JWT
    Object.keys(JSON.parse(params[1])).forEach((k) => expect(k).not.toMatch(/(pass|hash|token|secret|clave|credencial)/i));
    expect(params[7]).not.toMatch(/\$2[aby]\$/);
  });

  test('un fallo de la auditoría NUNCA revierte el login (COMMIT igual, tokens entregados)', async () => {
    const client = clienteLogin([{ ip: '198.51.100.1', user_agent: 'E/1' }], [[INSERT_AUDITORIA, () => { throw new Error('auditoria caida'); }]]);
    pool.getClient.mockResolvedValue(client);

    const res = await authService.login({ username: 'u7', password: passwordPrueba() }, meta);

    const orden = client.calls.map((c) => c.sql);
    expect(res).toHaveProperty('accessToken');
    expect(orden).toContain('ROLLBACK TO SAVEPOINT auditoria_seguridad');
    expect(orden[orden.length - 1]).toBe('COMMIT');
    expect(orden).not.toContain('ROLLBACK');
  });
});

describe('/auth/refresh no aplica la sesión única (b, d)', () => {
  beforeEach(() => jest.clearAllMocks());

  const usuario = { id: 7, username: 'u7', email: 'u7@x.test', nombre_completo: 'U', rol: 'OPERARIO', activo: true };

  test('la rotación revoca SOLO la presentada, no genera SESION_REEMPLAZADA y el access nuevo trae el sid de la fila nueva', async () => {
    const viejo = generateTokens(usuario).refreshToken;
    const client = fakeClient([
      [/FOR UPDATE/, { rows: [{ usuario_id: 7, expires_at: new Date(Date.now() + 86400000) }] }],
      [/FROM usuarios\s+WHERE id = \$1 AND activo = true/, { rows: [usuario] }],
      [INSERT_SESION, { rows: [{ id: 4242 }], rowCount: 1 }],
    ]);
    pool.getClient.mockResolvedValue(client);

    const tokens = await authService.refreshToken(viejo, meta);

    expect(jwt.decode(tokens.accessToken).sid).toBe(4242);
    const revocaciones = sqlDe(client, /^UPDATE usuarios_sesiones/);
    expect(revocaciones).toHaveLength(1);
    expect(revocaciones[0].sql).toMatch(/WHERE refresh_token = \$1$/);
    expect(revocaciones[0].params).toEqual([viejo]);
    expect(sqlDe(client, /usuario_id = \$1 AND revocado = false/)).toHaveLength(0);
    expect(sqlDe(client, INSERT_AUDITORIA)).toHaveLength(0);
  });
});

describe('jwt: sid en el access token (d)', () => {
  const usuario = { id: 7, username: 'u7', email: 'u7@x.test', rol: 'OPERARIO' };
  test('generarAccessToken incluye sid cuando se indica y lo omite cuando no', () => {
    expect(jwt.decode(generarAccessToken(usuario, 99)).sid).toBe(99);
    expect(jwt.decode(generarAccessToken(usuario)).sid).toBeUndefined();
  });
});
