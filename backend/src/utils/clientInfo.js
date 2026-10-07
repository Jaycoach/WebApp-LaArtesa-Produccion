/**
 * Datos del cliente de una petición HTTP (IP real y user-agent) para trazabilidad
 * y auditoría.
 *
 * Orden de preferencia (idéntico al del rate limiter, middleware/rateLimiter.js:
 * `req.headers['x-real-ip'] || req.ip`, más un último recurso):
 *   1. X-Real-IP — nginx lo SOBRESCRIBE con $remote_addr, el cliente no puede falsearlo.
 *   2. req.ip (Express; sin `trust proxy` es la dirección del socket).
 *   3. req.socket.remoteAddress.
 * X-Forwarded-For NO se usa: lo puede inyectar el cliente.
 * Solo se devuelven valores que sean una IP válida (net.isIP; la columna destino es `inet`);
 * cualquier otra cosa se descarta (NULL) en vez de romper el INSERT y, con él, el login.
 */

const net = require('net');

const MAX_USER_AGENT = 512;

function normalizarIp(valor) {
  if (!valor) return null;
  const primero = String(Array.isArray(valor) ? valor[0] : valor).split(',')[0].trim();
  const sinPrefijo = primero.replace(/^::ffff:/i, '');
  return net.isIP(sinPrefijo) ? sinPrefijo : null;
}

function getClientIp(req) {
  if (!req) return null;
  const headers = req.headers || {};
  return normalizarIp(headers['x-real-ip'])
    || normalizarIp(req.ip)
    || normalizarIp(req.socket && req.socket.remoteAddress);
}

function getUserAgent(req) {
  const ua = req && req.headers && req.headers['user-agent'];
  if (!ua) return null;
  // Sin caracteres de control (incluido NUL, que PostgreSQL rechaza en text) y con tope de largo
  const limpio = String(ua).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_USER_AGENT);
  return limpio || null;
}

/** { ip, userAgent } listo para pasar a los servicios. */
function getRequestMeta(req) {
  return { ip: getClientIp(req), userAgent: getUserAgent(req) };
}

module.exports = { getClientIp, getUserAgent, getRequestMeta };
