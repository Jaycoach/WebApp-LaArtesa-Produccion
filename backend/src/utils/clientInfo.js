/**
 * Datos del cliente de una petición HTTP (IP real y user-agent) para trazabilidad
 * y auditoría.
 *
 * La IP real viene de X-Real-IP, que nginx fija con el IP del cliente — es la misma
 * fuente que usa el rate limiter (middleware/rateLimiter.js). Si falta, se usa
 * req.ip. Solo se devuelven valores que sean una IP válida (la columna destino es
 * `inet`); cualquier otra cosa se descarta en vez de romper el INSERT.
 */

const net = require('net');

const MAX_USER_AGENT = 500;

function normalizarIp(valor) {
  if (!valor) return null;
  const primero = String(Array.isArray(valor) ? valor[0] : valor).split(',')[0].trim();
  const sinPrefijo = primero.replace(/^::ffff:/i, '');
  return net.isIP(sinPrefijo) ? sinPrefijo : null;
}

function getClientIp(req) {
  if (!req) return null;
  const headers = req.headers || {};
  return normalizarIp(headers['x-real-ip']) || normalizarIp(req.ip);
}

function getUserAgent(req) {
  const ua = req && req.headers && req.headers['user-agent'];
  return ua ? String(ua).slice(0, MAX_USER_AGENT) : null;
}

/** { ip, userAgent } listo para pasar a los servicios. */
function getRequestMeta(req) {
  return { ip: getClientIp(req), userAgent: getUserAgent(req) };
}

module.exports = { getClientIp, getUserAgent, getRequestMeta };
