const { getClientIp, getUserAgent, getRequestMeta } = require('../clientInfo');

const NUL = String.fromCharCode(0);
const SOH = String.fromCharCode(1);

describe('clientInfo', () => {
  test('usa X-Real-IP (misma fuente que el rate limiter) antes que req.ip', () => {
    expect(getClientIp({ headers: { 'x-real-ip': '203.0.113.9' }, ip: '10.0.0.1' })).toBe('203.0.113.9');
  });

  test('cae a req.ip cuando no hay X-Real-IP', () => {
    expect(getClientIp({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  test('quita el prefijo ::ffff: de IPv4 mapeada', () => {
    expect(getClientIp({ headers: {}, ip: '::ffff:192.0.2.5' })).toBe('192.0.2.5');
  });

  test('toma la primera IP de una lista y acepta IPv6', () => {
    expect(getClientIp({ headers: { 'x-real-ip': '198.51.100.7, 10.0.0.2' } })).toBe('198.51.100.7');
    expect(getClientIp({ headers: { 'x-real-ip': '2001:db8::1' } })).toBe('2001:db8::1');
  });

  test('descarta valores que no son IP (la columna destino es inet) en vez de romper el INSERT', () => {
    expect(getClientIp({ headers: { 'x-real-ip': "1.1.1.1'; DROP TABLE usuarios;--" }, ip: undefined })).toBeNull();
    expect(getClientIp({ headers: { 'x-real-ip': 'no-es-ip' }, ip: '10.0.0.3' })).toBe('10.0.0.3');
    expect(getClientIp(undefined)).toBeNull();
  });

  test('getUserAgent trunca a 512 caracteres y devuelve null si falta', () => {
    expect(getUserAgent({ headers: { 'user-agent': 'a'.repeat(900) } })).toHaveLength(512);
    expect(getUserAgent({ headers: { 'user-agent': 'a'.repeat(20000) } })).toHaveLength(512);
    expect(getUserAgent({ headers: {} })).toBeNull();
  });

  test('getUserAgent quita caracteres de control (PostgreSQL rechaza NUL en text)', () => {
    expect(getUserAgent({ headers: { 'user-agent': `Mozilla${NUL}/5.0\r\nX` } })).toBe('Mozilla/5.0X');
    expect(getUserAgent({ headers: { 'user-agent': `${NUL}${SOH}` } })).toBeNull();
  });

  test('X-Forwarded-For NUNCA es fuente de la IP (el cliente puede inyectarlo)', () => {
    expect(getClientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, ip: '10.0.0.9' })).toBe('10.0.0.9');
    expect(getClientIp({ headers: { 'x-forwarded-for': '6.6.6.6' } })).toBeNull();
    expect(getClientIp({ headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' } })).toBe('203.0.113.9');
  });

  test('último recurso: req.socket.remoteAddress', () => {
    expect(getClientIp({ headers: {}, socket: { remoteAddress: '::ffff:192.0.2.77' } })).toBe('192.0.2.77');
  });

  test('cadenas arbitrarias o larguísimas en X-Real-IP => NULL (no rompen nada)', () => {
    expect(getClientIp({ headers: { 'x-real-ip': 'x'.repeat(20000) } })).toBeNull();
    expect(getClientIp({ headers: { 'x-real-ip': '999.999.999.999' } })).toBeNull();
    expect(getClientIp({ headers: { 'x-real-ip': `${NUL}\n` } })).toBeNull();
  });

  test('getRequestMeta combina ambos', () => {
    expect(getRequestMeta({ headers: { 'x-real-ip': '203.0.113.9', 'user-agent': 'UA/1' } }))
      .toEqual({ ip: '203.0.113.9', userAgent: 'UA/1' });
  });
});
