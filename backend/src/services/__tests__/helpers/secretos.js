/**
 * Valores "secretos" de prueba GENERADOS EN RUNTIME (CLAUDE.md, manejo de credenciales:
 * ningún test puede llevar una contraseña, hash o token como literal, ni siquiera uno
 * inventado). Cada corrida produce valores distintos; los tests nunca dependen del valor,
 * solo de que sea el mismo dentro del test.
 */
const crypto = require('crypto');

const aleatorio = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

/** Contraseña de prueba (no cumple ninguna regla: los servicios se prueban con bcrypt mockeado). */
const passwordPrueba = () => `pw_${aleatorio(10)}`;

/** Hash con forma de bcrypt, pero aleatorio (no corresponde a ninguna contraseña). */
const hashSimulado = () => `$2b$12$${aleatorio(30)}`;

/** Token/refresh token opaco de prueba. */
const tokenPrueba = () => `tk_${aleatorio(24)}`;

module.exports = { aleatorio, passwordPrueba, hashSimulado, tokenPrueba };
