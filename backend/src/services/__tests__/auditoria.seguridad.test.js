/**
 * Punto 4 — auditoría de eventos de seguridad en auditoria_cambios.
 *
 * Pruebas unitarias sin BD (se verifica el SQL/params emitidos). La verificación
 * real contra la BD (incluido el escaneo de que no hay hashes ni tokens en los
 * jsonb) vive en scripts/tests/test_seguridad_cuentas_auth.sh (staging).
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
const authService = require('../auth.service');
const userService = require('../user.service');
const { registrarEventoSeguridad, EVENTO } = require('../securityHelpers');
const { fakeClient, sqlDe } = require('./helpers/fakeClient');
const {
  passwordPrueba, hashSimulado, tokenPrueba,
} = require('./helpers/secretos');

// Todo valor secreto se genera en runtime (CLAUDE.md): ningún literal de contraseña/hash/token.
const HASH_VIEJO = hashSimulado();
const HASH_NUEVO = hashSimulado();
const PW_ACTUAL = passwordPrueba();
const PW_NUEVA = passwordPrueba();
const TOKEN_CRUDO = tokenPrueba();
const REFRESH = tokenPrueba();

const INSERT_AUDITORIA = /^INSERT INTO auditoria_cambios/;
const auditorias = (client) => sqlDe(client, INSERT_AUDITORIA);

/**
 * Ningún secreto puede aparecer en lo que se manda a auditoria_cambios: ni sus valores
 * (en ningún parámetro) ni claves de aspecto secreto en el jsonb datos_nuevos.
 * `campos_modificados` SÍ nombra columnas ('password_hash'): dice QUÉ cambió, no su valor.
 */
function esperarSinSecretos(client) {
  auditorias(client).forEach(({ params }) => {
    const volcado = JSON.stringify(params);
    [HASH_VIEJO, HASH_NUEVO, PW_ACTUAL, PW_NUEVA, TOKEN_CRUDO, REFRESH, '$2b$'].forEach((secreto) => {
      expect(volcado).not.toContain(secreto);
    });
    Object.keys(JSON.parse(params[1])).forEach((clave) => {
      expect(clave).not.toMatch(/(pass|hash|token|secret|clave|credencial)/i);
    });
    expect(params[7]).not.toMatch(/\$2[aby]\$/); // motivo
  });
}

describe('registrarEventoSeguridad (helper)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('inserta el hecho: tabla usuarios, UPDATE, objetivo, actor, IP, UA, campos y motivo con el código', async () => {
    const client = fakeClient();
    await registrarEventoSeguridad(client, {
      codigo: EVENTO.CAMBIO_PASSWORD,
      descripcion: 'prueba',
      usuarioObjetivoId: '15',
      actor: { id: 15, nombre: 'Persona Prueba' },
      camposModificados: ['password_hash', 'ultimo_cambio_password'],
      detalles: { sesiones_revocadas: 2 },
      ip: '203.0.113.5',
      userAgent: 'UA/1',
    });
    const [ins] = auditorias(client);
    expect(ins.sql).toMatch(/VALUES \('usuarios', \$1, 'UPDATE', \$2::jsonb, \$3::text\[\]/);
    expect(ins.params[0]).toBe(15);
    expect(JSON.parse(ins.params[1])).toEqual({ evento: 'CAMBIO_PASSWORD', sesiones_revocadas: 2 });
    expect(ins.params[2]).toEqual(['password_hash', 'ultimo_cambio_password']);
    expect(ins.params.slice(3)).toEqual([15, 'Persona Prueba', '203.0.113.5', 'UA/1', 'CAMBIO_PASSWORD: prueba']);
  });

  test('sin actor = el sistema (usuario_id NULL, usuario_nombre "sistema")', async () => {
    const client = fakeClient();
    await registrarEventoSeguridad(client, {
      codigo: EVENTO.BLOQUEO_CUENTA_INTENTOS, descripcion: 'x', usuarioObjetivoId: 3,
    });
    const [ins] = auditorias(client);
    expect(ins.params[3]).toBeNull();
    expect(ins.params[4]).toBe('sistema');
  });

  test('defensa en profundidad: descarta claves que parecen secretos y lo avisa', async () => {
    const client = fakeClient();
    await registrarEventoSeguridad(client, {
      codigo: EVENTO.CAMBIO_PASSWORD,
      descripcion: 'x',
      usuarioObjetivoId: 3,
      detalles: {
        password_hash: HASH_NUEVO, refreshToken: REFRESH, newPassword: PW_NUEVA, token_recuperacion: TOKEN_CRUDO, ok: true,
      },
    });
    expect(JSON.parse(auditorias(client)[0].params[1])).toEqual({ evento: 'CAMBIO_PASSWORD', ok: true });
    expect(logger.warn).toHaveBeenCalledTimes(4);
    esperarSinSecretos(client);
  });

  test('transaccional: SAVEPOINT -> INSERT -> RELEASE', async () => {
    const client = fakeClient();
    await registrarEventoSeguridad(client, {
      codigo: EVENTO.CAMBIO_PASSWORD, descripcion: 'x', usuarioObjetivoId: 3, transaccional: true,
    });
    expect(client.calls.map((c) => c.sql.split(' (')[0])).toEqual([
      'SAVEPOINT auditoria_seguridad',
      'INSERT INTO auditoria_cambios',
      'RELEASE SAVEPOINT auditoria_seguridad',
    ]);
  });

  test('si el INSERT falla NO lanza: hace ROLLBACK TO SAVEPOINT y registra el error', async () => {
    const client = fakeClient([[INSERT_AUDITORIA, () => { throw new Error('boom en auditoria'); }]]);
    await expect(registrarEventoSeguridad(client, {
      codigo: EVENTO.CAMBIO_PASSWORD, descripcion: 'x', usuarioObjetivoId: 3, transaccional: true,
    })).resolves.toBeUndefined();
    expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK TO SAVEPOINT auditoria_seguridad');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('CAMBIO_PASSWORD'));
  });
});

describe('auditoría en cada flujo de seguridad', () => {
  const meta = { ip: '203.0.113.9', userAgent: 'NavegadorPrueba/2' };

  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockReset();
    bcrypt.hash.mockReset();
  });

  test('bloqueo por intentos: se audita SOLO cuando el UPDATE efectivamente bloqueó', async () => {
    const usuario = {
      id: 7, username: 'usuario.prueba', email: 'u@x.test', password_hash: HASH_VIEJO, nombre_completo: 'U P', rol: 'OPERARIO',
      activo: true, email_verificado: true, intentos_fallidos: 4, bloqueado_hasta: null, debe_cambiar_password: false, bloqueo_vencido: false,
    };
    const armar = (fila) => fakeClient([
      [/FROM usuarios\s+WHERE username = \$1 OR email = \$1/, { rows: [usuario] }],
      [/RETURNING intentos_fallidos, bloqueado_hasta/, { rows: [fila] }],
    ]);
    bcrypt.compare.mockResolvedValue(false);

    // 5º fallo: bloquea
    const c1 = armar({ intentos_fallidos: 5, bloqueado_hasta: new Date(Date.now() + 1800000) });
    pool.getClient.mockResolvedValue(c1);
    await expect(authService.login({ username: 'usuario.prueba', password: PW_ACTUAL }, meta)).rejects.toThrow('Credenciales inválidas');
    expect(auditorias(c1)).toHaveLength(1);
    const [ins] = auditorias(c1);
    expect(ins.params[0]).toBe(7);
    expect(JSON.parse(ins.params[1])).toEqual({
      evento: 'BLOQUEO_CUENTA_INTENTOS', username: 'usuario.prueba', intentos_fallidos: 5, duracion_minutos: 30,
    });
    expect(ins.params[3]).toBeNull();
    expect(ins.params[4]).toBe('sistema');
    expect(ins.params[5]).toBe('203.0.113.9');
    expect(ins.params[7]).toMatch(/^BLOQUEO_CUENTA_INTENTOS: /);
    expect(JSON.stringify(ins.params)).not.toContain(PW_ACTUAL);

    // 3er fallo: no bloquea => sin auditoría
    const c2 = armar({ intentos_fallidos: 3, bloqueado_hasta: null });
    pool.getClient.mockResolvedValue(c2);
    await expect(authService.login({ username: 'usuario.prueba', password: PW_ACTUAL }, meta)).rejects.toThrow('Credenciales inválidas');
    expect(auditorias(c2)).toHaveLength(0);
  });

  test('si la auditoría del bloqueo falla, el login igual responde "Credenciales inválidas" (no error 500)', async () => {
    const usuario = {
      id: 7, username: 'u', email: 'u@x.test', password_hash: HASH_VIEJO, nombre_completo: 'U', rol: 'OPERARIO', activo: true,
      email_verificado: true, intentos_fallidos: 4, bloqueado_hasta: null, debe_cambiar_password: false, bloqueo_vencido: false,
    };
    const client = fakeClient([
      [/FROM usuarios\s+WHERE username = \$1 OR email = \$1/, { rows: [usuario] }],
      [/RETURNING intentos_fallidos, bloqueado_hasta/, { rows: [{ intentos_fallidos: 5, bloqueado_hasta: new Date() }] }],
      [INSERT_AUDITORIA, () => { throw new Error('auditoria caida'); }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);
    await expect(authService.login({ username: 'u', password: PW_ACTUAL }, meta)).rejects.toThrow('Credenciales inválidas');
  });

  test('changePassword: audita CAMBIO_PASSWORD con el usuario como actor, dentro de la transacción y antes del COMMIT', async () => {
    const client = fakeClient([
      [/SELECT username, nombre_completo, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ username: 'u7', nombre_completo: 'Usuario Siete', password_hash: HASH_VIEJO }] }],
      [/FROM usuarios_historial_passwords/, { rows: [] }],
      [/^UPDATE usuarios_sesiones/, { rowCount: 2, rows: [] }],
      [/^SELECT 1 FROM usuarios_sesiones/, { rows: [{ '?column?': 1 }] }], // la sesión indicada sigue viva
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.changePassword(7, PW_ACTUAL, PW_NUEVA, { refreshToken: REFRESH, ...meta });

    const [ins] = auditorias(client);
    expect(ins.params[0]).toBe(7);
    expect(JSON.parse(ins.params[1])).toEqual({ evento: 'CAMBIO_PASSWORD', sesiones_revocadas: 2, sesion_actual_conservada: true });
    expect(ins.params[2]).toEqual(['password_hash', 'ultimo_cambio_password', 'intentos_fallidos', 'bloqueado_hasta']);
    expect(ins.params[3]).toBe(7);
    expect(ins.params[4]).toBe('Usuario Siete');
    expect(ins.params.slice(5, 7)).toEqual(['203.0.113.9', 'NavegadorPrueba/2']);
    const orden = client.calls.map((c) => c.sql);
    expect(orden.indexOf('COMMIT')).toBeGreaterThan(orden.findIndex((s) => INSERT_AUDITORIA.test(s)));
    expect(orden).toContain('SAVEPOINT auditoria_seguridad');
    esperarSinSecretos(client);
  });

  test('changePassword con un refreshToken que NO corresponde a ninguna sesión vigente: la auditoría dice sesion_actual_conservada=false', async () => {
    const client = fakeClient([
      [/SELECT username, nombre_completo, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ username: 'u7', nombre_completo: 'Usuario Siete', password_hash: HASH_VIEJO }] }],
      [/FROM usuarios_historial_passwords/, { rows: [] }],
      [/^UPDATE usuarios_sesiones/, { rowCount: 3, rows: [] }],
      [/^SELECT 1 FROM usuarios_sesiones/, { rows: [] }], // ninguna sesión vigente con ese token
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.changePassword(7, PW_ACTUAL, PW_NUEVA, { refreshToken: tokenPrueba(), ...meta });

    expect(JSON.parse(auditorias(client)[0].params[1])).toEqual({
      evento: 'CAMBIO_PASSWORD', sesiones_revocadas: 3, sesion_actual_conservada: false,
    });
  });

  test('changePassword: si la auditoría falla, el cambio de contraseña SÍ se confirma (COMMIT, sin ROLLBACK de la transacción)', async () => {
    const client = fakeClient([
      [/SELECT username, nombre_completo, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ username: 'u7', nombre_completo: 'Usuario Siete', password_hash: HASH_VIEJO }] }],
      [/FROM usuarios_historial_passwords/, { rows: [] }],
      [INSERT_AUDITORIA, () => { throw new Error('auditoria caida'); }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValueOnce(true).mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await expect(authService.changePassword(7, PW_ACTUAL, PW_NUEVA, meta)).resolves.toEqual({ message: 'Contraseña actualizada exitosamente' });

    const orden = client.calls.map((c) => c.sql);
    expect(orden).toContain('ROLLBACK TO SAVEPOINT auditoria_seguridad');
    expect(orden).toContain('COMMIT');
    expect(orden).not.toContain('ROLLBACK');
  });

  test('changePassword con contraseña incorrecta: NO audita', async () => {
    const client = fakeClient([
      [/SELECT username, nombre_completo, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ username: 'u7', nombre_completo: 'U', password_hash: HASH_VIEJO }] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);
    await expect(authService.changePassword(7, passwordPrueba(), PW_NUEVA, meta)).rejects.toThrow('Contraseña actual incorrecta');
    expect(auditorias(client)).toHaveLength(0);
  });

  test('reset por token: audita RESET_PASSWORD_TOKEN sin el token ni el hash', async () => {
    const client = fakeClient([
      [/FROM usuarios\s+WHERE token_recuperacion = \$1/, { rows: [{ id: 9, email: 'a@b.test', username: 'u9', nombre_completo: 'Usuario Nueve', password_hash: HASH_VIEJO }] }],
      [/FROM usuarios_historial_passwords/, { rows: [] }],
      [/^UPDATE usuarios_sesiones/, { rowCount: 3, rows: [] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.compare.mockResolvedValue(false);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await authService.resetPassword(TOKEN_CRUDO, PW_NUEVA, meta);

    const [ins] = auditorias(client);
    expect(ins.params[0]).toBe(9);
    expect(JSON.parse(ins.params[1])).toEqual({ evento: 'RESET_PASSWORD_TOKEN', via: 'token_recuperacion', sesiones_revocadas: 3 });
    expect(ins.params[3]).toBe(9);
    expect(ins.params[7]).toMatch(/^RESET_PASSWORD_TOKEN: /);
    esperarSinSecretos(client);
  });

  test('reset por admin: el actor es el admin y el objetivo la cuenta afectada', async () => {
    const client = fakeClient([
      [/SELECT id, password_hash FROM usuarios WHERE id = \$1/, { rows: [{ id: 12, password_hash: HASH_VIEJO }] }],
      [/^UPDATE usuarios_sesiones/, { rowCount: 1, rows: [] }],
    ]);
    pool.getClient.mockResolvedValue(client);
    bcrypt.hash.mockResolvedValue(HASH_NUEVO);

    await userService.resetUserPassword('12', PW_NUEVA, { actor: { id: 2, nombre: 'Admin Prueba' }, ...meta });

    const [ins] = auditorias(client);
    expect(ins.params[0]).toBe(12);
    expect(JSON.parse(ins.params[1])).toEqual({ evento: 'RESET_PASSWORD_ADMIN', temporal: true, sesiones_revocadas: 1 });
    expect(ins.params[3]).toBe(2);
    expect(ins.params[4]).toBe('Admin Prueba');
    expect(ins.params[7]).toMatch(/^RESET_PASSWORD_ADMIN: /);
    esperarSinSecretos(client);
  });

  test('desbloqueo manual: audita con el admin como actor, conserva la respuesta original y no filtra columnas internas', async () => {
    const client = fakeClient([
      [/^UPDATE usuarios u/, { rows: [{
        id: 12, username: 'u12', bloqueado_hasta: null, intentos_previos: 5, estaba_bloqueado: true,
      }] }],
    ]);
    pool.getClient.mockResolvedValue(client);

    const res = await userService.unlockUser('12', { actor: { id: 2, nombre: 'Admin Prueba' }, ...meta });

    expect(res).toEqual({ id: 12, username: 'u12', bloqueado_hasta: null });
    const [ins] = auditorias(client);
    expect(ins.params[0]).toBe(12);
    expect(JSON.parse(ins.params[1])).toEqual({
      evento: 'DESBLOQUEO_MANUAL', username: 'u12', intentos_previos: 5, estaba_bloqueado: true,
    });
    expect(ins.params[3]).toBe(2);
    expect(ins.params[7]).toMatch(/^DESBLOQUEO_MANUAL: /);
  });

  test('desbloqueo de usuario inexistente: error original y sin auditoría', async () => {
    const client = fakeClient([[/^UPDATE usuarios u/, { rows: [] }]]);
    pool.getClient.mockResolvedValue(client);
    await expect(userService.unlockUser('999', { actor: { id: 2, nombre: 'A' } })).rejects.toThrow('Usuario no encontrado');
    expect(auditorias(client)).toHaveLength(0);
  });
});
