/**
 * verifyToken y el sid (punto 8d): sesión reemplazada/revocada/ausente => 401 SESSION_REPLACED;
 * tokens SIN sid => 401 SESSION_REPLACED (ingreso limpio tras el despliegue); el resto de los
 * 401 conservan mensaje y code. Pruebas unitarias sin BD.
 */

jest.mock('../../database/connection', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), logSecurity: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const db = require('../../database/connection');
const config = require('../../config');
const { verifyToken, optionalAuth } = require('../auth');
const { errorHandler, AppError } = require('../errorHandler');

const firmar = (payload, opts = {}) => jwt.sign({ id: 7, username: 'u7', email: 'u7@x.test', rol: 'OPERARIO', ...payload }, config.jwt.secret, { expiresIn: '1h', ...opts });

const usuarioBD = (extra = {}) => ({
  id: 7, uuid: 'u', username: 'u7', email: 'u7@x.test', nombre_completo: 'U Siete', rol: 'OPERARIO', activo: true,
  bloqueado_hasta: null, ultimo_cambio_password: null, sesion_vigente: true, ...extra,
});

async function ejecutar(token, { url = '/api/pesaje/checklist', fila = usuarioBD() } = {}) {
  db.query.mockReset();
  db.query.mockResolvedValue({ rows: fila ? [fila] : [] });
  db.query.mockResolvedValueOnce({ rows: fila ? [fila] : [] });
  const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: url };
  const next = jest.fn();
  await verifyToken(req, {}, next);
  return { req, next, error: next.mock.calls[0] && next.mock.calls[0][0] };
}

describe('verifyToken + sid', () => {
  test('token con sid de una sesión vigente: pasa y la consulta única incluye la subconsulta por PK', async () => {
    const { next, req } = await ejecutar(firmar({ sid: 55 }));
    expect(next).toHaveBeenCalledWith(); // sin error
    expect(req.user.id).toBe(7);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/FROM usuarios_sesiones s WHERE s\.id = \$2::integer/);
    expect(params).toEqual([7, 55]);
    // una sola consulta de verificación (la otra llamada es el UPDATE de ultimo_acceso, sin bloquear)
    expect(db.query.mock.calls.filter(([q]) => /^\s*SELECT/.test(q))).toHaveLength(1);
  });

  test.each([
    ['sesión revocada o de otro usuario (sesion_vigente=false)', usuarioBD({ sesion_vigente: false })],
    ['fila de sesión inexistente (sesion_vigente=null)', usuarioBD({ sesion_vigente: null })],
  ])('%s => 401 SESSION_REPLACED', async (_n, fila) => {
    const { error } = await ejecutar(firmar({ sid: 55 }), { fila });
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('SESSION_REPLACED');
  });

  test('access token SIN sid => 401 SESSION_REPLACED (ya no vale hasta expirar)', async () => {
    const { error } = await ejecutar(firmar({}));
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('SESSION_REPLACED');
    expect(db.query.mock.calls[0][1]).toEqual([7, null]);
  });

  test.each([['"55"'], [0], [-3], [1.5], [true]])('sid inválido (%j) => 401 SESSION_REPLACED sin consultar la BD', async (sid) => {
    const { error } = await ejecutar(firmar({ sid: JSON.parse(JSON.stringify(sid)) }));
    expect(error.code).toBe('SESSION_REPLACED');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('el chequeo de sesión va ANTES del de cambio de contraseña (las otras estaciones reciben SESSION_REPLACED)', async () => {
    const fila = usuarioBD({ sesion_vigente: false, ultimo_cambio_password: new Date(Date.now() + 60000) });
    const { error } = await ejecutar(firmar({ sid: 55 }), { fila });
    expect(error.code).toBe('SESSION_REPLACED');
  });

  test('con sesión vigente pero token anterior al cambio de contraseña conserva el 401 de siempre (sin code)', async () => {
    const fila = usuarioBD({ ultimo_cambio_password: new Date(Date.now() + 60000) });
    const { error } = await ejecutar(firmar({ sid: 55 }), { fila });
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Sesión inválida. Por favor inicie sesión nuevamente.');
    expect(error.code).toBeUndefined();
  });

  test('los demás 401/403 conservan mensaje y code: usuario inactivo, bloqueado, inexistente, sin token', async () => {
    let r = await ejecutar(firmar({ sid: 55 }), { fila: usuarioBD({ activo: false, sesion_vigente: false }) });
    expect(r.error.message).toBe('Usuario inactivo. Contacte al administrador.');
    expect(r.error.code).toBeUndefined();

    r = await ejecutar(firmar({ sid: 55 }), { fila: usuarioBD({ bloqueado_hasta: new Date(Date.now() + 60000), sesion_vigente: false }) });
    expect(r.error.statusCode).toBe(403);
    expect(r.error.message).toBe('Usuario bloqueado temporalmente.');

    r = await ejecutar(firmar({ sid: 55 }), { fila: null });
    expect(r.error.message).toBe('El usuario ya no existe.');
    expect(r.error.code).toBeUndefined();

    const next = jest.fn();
    await verifyToken({ headers: {} }, {}, next);
    expect(next.mock.calls[0][0].message).toBe('No autenticado. Por favor inicie sesión.');
    expect(next.mock.calls[0][0].code).toBeUndefined();
  });

  test('token expirado y token con firma inválida conservan su mensaje', async () => {
    const vencido = firmar({ sid: 55 }, { expiresIn: -10 });
    let next = jest.fn();
    await verifyToken({ headers: { authorization: `Bearer ${vencido}` } }, {}, next);
    expect(next.mock.calls[0][0].message).toBe('Token expirado. Por favor inicie sesión nuevamente.');

    next = jest.fn();
    await verifyToken({ headers: { authorization: 'Bearer no.es.jwt' } }, {}, next);
    expect(next.mock.calls[0][0].message).toBe('Token inválido');
  });

  describe('excepción acotada: token corto de verificación de correo (scp=set-password)', () => {
    test('sin sid vale SOLO en /auth/set-initial-password', async () => {
      const token = firmar({ scp: 'set-password' });
      const ok = await ejecutar(token, { url: '/api/auth/set-initial-password' });
      expect(ok.next).toHaveBeenCalledWith();

      const otra = await ejecutar(token, { url: '/api/pesaje/checklist' });
      expect(otra.error.code).toBe('SESSION_REPLACED');

      const otra2 = await ejecutar(token, { url: '/api/users' });
      expect(otra2.error.code).toBe('SESSION_REPLACED');
    });

    test('sin el claim scp, /auth/set-initial-password también exige sesión', async () => {
      const { error } = await ejecutar(firmar({}), { url: '/api/auth/set-initial-password' });
      expect(error.code).toBe('SESSION_REPLACED');
    });
  });
});

describe('optionalAuth + sid', () => {
  const llamar = async (token, fila) => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: fila ? [fila] : [] });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    return req;
  };
  test('con sesión vigente identifica al usuario', async () => {
    expect((await llamar(firmar({ sid: 5 }), usuarioBD())).user.id).toBe(7);
  });
  test('sesión revocada o token sin sid: continúa SIN usuario', async () => {
    expect((await llamar(firmar({ sid: 5 }), usuarioBD({ sesion_vigente: false }))).user).toBeUndefined();
    expect((await llamar(firmar({}), usuarioBD())).user).toBeUndefined();
  });
});

describe('errorHandler: code de AppError', () => {
  const responder = (err) => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler(err, { originalUrl: '/x', method: 'GET', ip: '1.1.1.1' }, res, () => {});
    return { status: res.status.mock.calls[0][0], cuerpo: res.json.mock.calls[0][0] };
  };
  test('AppError con code lo emite en el JSON', () => {
    const { status, cuerpo } = responder(new AppError('msg', 401, 'SESSION_REPLACED'));
    expect(status).toBe(401);
    expect(cuerpo.code).toBe('SESSION_REPLACED');
    expect(cuerpo.message).toBe('msg');
  });
  test('AppError sin code NO agrega la clave (los demás errores no cambian)', () => {
    const { cuerpo } = responder(new AppError('No autenticado', 401));
    expect(cuerpo).not.toHaveProperty('code');
  });
});
