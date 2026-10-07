/**
 * Utilidades para manejo de JWT
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');

/**
 * Refresh token. jwtid (claim jti) único por emisión: sin él dos tokens del mismo usuario
 * emitidos en el mismo segundo (iat tiene resolución de 1 s) salen idénticos y el refresh
 * token choca con UNIQUE(usuarios_sesiones.refresh_token) (error 23505).
 */
const generarRefreshToken = (user) => jwt.sign(
  { id: user.id },
  config.jwt.refreshSecret,
  { expiresIn: config.jwt.refreshExpiresIn, jwtid: crypto.randomUUID() },
);

/**
 * Access token. `sessionId` (claim sid) es el id de la fila de usuarios_sesiones a la que
 * pertenece; el middleware de auth lo usa para rechazar al instante un access token cuya
 * sesión fue reemplazada o revocada. Sin sessionId el token no lleva sid (comportamiento
 * anterior: vale hasta que expire).
 */
const generarAccessToken = (user, sessionId) => jwt.sign(
  {
    id: user.id,
    username: user.username,
    email: user.email,
    rol: user.rol,
    ...(sessionId !== undefined && sessionId !== null ? { sid: sessionId } : {}),
  },
  config.jwt.secret,
  { expiresIn: config.jwt.expiresIn, jwtid: crypto.randomUUID() },
);

/**
 * Generar access y refresh tokens. El flujo de sesiones (auth.service) usa
 * generarRefreshToken + generarAccessToken por separado porque el sid solo se conoce
 * después de insertar la sesión.
 */
const generateTokens = (user, sessionId) => {
  try {
    return {
      accessToken: generarAccessToken(user, sessionId),
      refreshToken: generarRefreshToken(user),
      expiresIn: config.jwt.expiresIn,
    };
  } catch (error) {
    logger.error('Error al generar tokens:', error);
    throw new Error('Error al generar tokens de autenticación');
  }
};

/**
 * Verificar access token
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expirado');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Token inválido');
    }
    throw error;
  }
};

/**
 * Verificar refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Refresh token expirado');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Refresh token inválido');
    }
    throw error;
  }
};

/**
 * Decodificar token sin verificar (para debugging)
 */
const decodeToken = (token) => jwt.decode(token);

module.exports = {
  generarRefreshToken,
  generarAccessToken,
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
};
