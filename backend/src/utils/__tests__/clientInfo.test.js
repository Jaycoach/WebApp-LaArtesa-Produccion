const { getClientIp, getUserAgent, getRequestMeta } = require('../clientInfo');

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

  test('getUserAgent trunca a 500 caracteres y devuelve null si falta', () => {
    expect(getUserAgent({ headers: { 'user-agent': 'a'.repeat(900) } })).toHaveLength(500);
    expect(getUserAgent({ headers: {} })).toBeNull();
  });

  test('getRequestMeta combina ambos', () => {
    expect(getRequestMeta({ headers: { 'x-real-ip': '203.0.113.9', 'user-agent': 'UA/1' } }))
      .toEqual({ ip: '203.0.113.9', userAgent: 'UA/1' });
  });
});
