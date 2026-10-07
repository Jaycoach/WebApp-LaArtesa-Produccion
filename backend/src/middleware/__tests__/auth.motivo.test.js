/**
 * Motivo del 401 SESSION_REPLACED (OTRO_INICIO | CAMBIO_PASSWORD | SESION_CERRADA) y bloqueo del
 * cambio de contraseña obligatorio. Pruebas unitarias sin BD; la verificación real contra la BD de
 * staging vive en scripts/tests/test_aviso_sesion_y_password_admin.sh.
 */

jest.mock('../../database/connection', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), logSecurity: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const db = require('../../database/connection');
const config = require('../../config');
const { verifyToken } = require('../auth');
const { errorHandler, AppError } = require('../errorHandler');

const firmar = (payload) => jwt.sign({ id: 7, username: 'u7', email: 'u7@x.test', rol: 'OPERARIO', ...payload }, config.jwt.secret, { expiresIn: '1h' });
const usuarioBD = (extra = {}) => ({
  id: 7, uuid: 'u', username: 'u7', email: 'u7@x.test', nombre_completo: 'U Siete', rol: 'OPERARIO', activo: true,
  bloqueado_hasta: null, ultimo_cambio_password: null, debe_cambiar_password: false, sesion_vigente: true, ...extra,
});
const t = (iso) => new Date(iso);
const CONSULTA_MOTIVO = /FROM usuarios_sesiones s\s+WHERE s\.id = \$1 AND s\.usuario_id = \$2/;

/** db.query: el SELECT del usuario, la consulta del motivo y el UPDATE de ultimo_acceso. */
function montarBD({ usuario, sesion }) {
  db.query.mockReset();
  db.query.mockImplementation(async (sql) => {
    if (CONSULTA_MOTIVO.test(sql)) return { rows: sesion ? [sesion] : [] };
    if (/^\s*SELECT/.test(sql)) return { rows: usuario ? [usuario] : [] };
    return { rows: [] };
  });
}
async function ejecutar(token, url = '/api/pesaje/checklist') {
  const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: url };
  const next = jest.fn();
  await verifyToken(req, {}, next);
  return { req, next, error: next.mock.calls[0] && next.mock.calls[0][0] };
}
const consultasMotivo = () => db.query.mock.calls.filter(([q]) => CONSULTA_MOTIVO.test(q));

describe('motivo del cierre de sesión', () => {
  const revocada = { revocado: true, created_at: t('2026-10-07T10:00:00Z'), siguiente_creada: null, hay_vigente_posterior: false };

  test('OTRO_INICIO: revocada y hay una sesión vigente creada después', async () => {
    montarBD({ usuario: usuarioBD({ sesion_vigente: false }), sesion: { ...revocada, siguiente_creada: t('2026-10-07T10:05:00Z'), hay_vigente_posterior: true } });
    const { error } = await ejecutar(firmar({ sid: 55 }));
    expect([error.statusCode, error.code, error.motivo]).toEqual([401, 'SESSION_REPLACED', 'OTRO_INICIO']);
  });

  test('CAMBIO_PASSWORD: revocada y ultimo_cambio_password posterior a su creación (sin sesión intermedia)', async () => {
    montarBD({ usuario: usuarioBD({ sesion_vigente: false, ultimo_cambio_password: t('2026-10-07T10:30:00Z') }), sesion: revocada });
    const { error } = await ejecutar(firmar({ sid: 55 }));
    expect([error.code, error.motivo]).toEqual(['SESSION_REPLACED', 'CAMBIO_PASSWORD']);
  });

  test('reset por admin y luego un login con la temporal: la sesión previa sigue siendo CAMBIO_PASSWORD', async () => {
    montarBD({
      usuario: usuarioBD({ sesion_vigente: false, ultimo_cambio_password: t('2026-10-07T10:30:00Z') }),
      sesion: { ...revocada, siguiente_creada: t('2026-10-07T10:31:00Z'), hay_vigente_posterior: true },
    });
    expect((await ejecutar(firmar({ sid: 55 }))).error.motivo).toBe('CAMBIO_PASSWORD');
  });

  test('un inicio de sesión ANTERIOR al cambio de contraseña sigue siendo OTRO_INICIO', async () => {
    montarBD({
      usuario: usuarioBD({ sesion_vigente: false, ultimo_cambio_password: t('2026-10-07T11:00:00Z') }),
      sesion: { ...revocada, siguiente_creada: t('2026-10-07T10:05:00Z'), hay_vigente_posterior: true },
    });
    expect((await ejecutar(firmar({ sid: 55 }))).error.motivo).toBe('OTRO_INICIO');
  });

  test('ultimo_cambio_password ANTERIOR a la creación de la sesión no cuenta como cambio de contraseña', async () => {
    montarBD({ usuario: usuarioBD({ sesion_vigente: false, ultimo_cambio_password: t('2026-10-01T00:00:00Z') }), sesion: revocada });
    expect((await ejecutar(firmar({ sid: 55 }))).error.motivo).toBe('SESION_CERRADA');
  });

  test.each([
    ['token sin sid (emitido antes del despliegue)', () => firmar({}), null],
    ['sesión inexistente o de otro usuario', () => firmar({ sid: 55 }), null],
    ['revocación masiva sin sesión posterior ni cambio de clave', () => firmar({ sid: 55 }), revocada],
    ['sesión no revocada (estado inconsistente)', () => firmar({ sid: 55 }), { ...revocada, revocado: false }],
  ])('SESION_CERRADA: %s', async (_n, token, sesion) => {
    montarBD({ usuario: usuarioBD({ sesion_vigente: sesion ? false : null }), sesion });
    const { error } = await ejecutar(token());
    expect([error.statusCode, error.code, error.motivo]).toEqual([401, 'SESSION_REPLACED', 'SESION_CERRADA']);
  });

  test('un token sin sid NO consulta usuarios_sesiones para calcular el motivo', async () => {
    montarBD({ usuario: usuarioBD({ sesion_vigente: null }), sesion: null });
    await ejecutar(firmar({}));
    expect(consultasMotivo()).toHaveLength(0);
  });

  test('si la consulta del motivo falla, el 401 sigue siendo SESSION_REPLACED con SESION_CERRADA', async () => {
    montarBD({ usuario: usuarioBD({ sesion_vigente: false }), sesion: revocada });
    const original = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, p) => {
      if (CONSULTA_MOTIVO.test(sql)) throw new Error('boom');
      return original(sql, p);
    });
    const { error } = await ejecutar(firmar({ sid: 55 }));
    expect([error.code, error.motivo]).toEqual(['SESSION_REPLACED', 'SESION_CERRADA']);
  });

  test('la respuesta HTTP lleva code y motivo; los demás 401 no llevan motivo', () => {
    const responder = (err) => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      errorHandler(err, { originalUrl: '/x', method: 'GET', ip: '1.1.1.1' }, res, () => {});
      return res.json.mock.calls[0][0];
    };
    expect(responder(new AppError('m', 401, 'SESSION_REPLACED', 'OTRO_INICIO'))).toMatchObject({ code: 'SESSION_REPLACED', motivo: 'OTRO_INICIO' });
    expect(responder(new AppError('No autenticado', 401))).not.toHaveProperty('motivo');
  });
});

describe('peticiones válidas: sin consultas nuevas', () => {
  test('sesión vigente: las MISMAS dos consultas de siempre (SELECT del usuario + UPDATE de ultimo_acceso), sin consulta de motivo', async () => {
    montarBD({ usuario: usuarioBD(), sesion: null });
    const { next } = await ejecutar(firmar({ sid: 55 }));
    expect(next).toHaveBeenCalledWith();
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(consultasMotivo()).toHaveLength(0);
    expect(db.query.mock.calls.filter(([q]) => /^\s*SELECT/.test(q))).toHaveLength(1);
  });
});

describe('cambio de contraseña obligatorio (debe_cambiar_password)', () => {
  test('bloquea la API con 403 PASSWORD_CHANGE_REQUIRED', async () => {
    montarBD({ usuario: usuarioBD({ debe_cambiar_password: true }), sesion: null });
    const { error } = await ejecutar(firmar({ sid: 55 }), '/api/pesaje/checklist');
    expect([error.statusCode, error.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);
  });
  test('deja pasar SOLO /auth/set-initial-password', async () => {
    montarBD({ usuario: usuarioBD({ debe_cambiar_password: true }), sesion: null });
    expect((await ejecutar(firmar({ sid: 55 }), '/api/auth/set-initial-password')).next).toHaveBeenCalledWith();
    for (const url of ['/api/auth/profile', '/api/auth/change-password', '/api/users']) {
      expect((await ejecutar(firmar({ sid: 55 }), url)).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });
  test('sin la marca, todo pasa como siempre', async () => {
    montarBD({ usuario: usuarioBD({ debe_cambiar_password: false }), sesion: null });
    expect((await ejecutar(firmar({ sid: 55 }), '/api/auth/profile')).next).toHaveBeenCalledWith();
  });
});
