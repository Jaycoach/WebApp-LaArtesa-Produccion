/**
 * Utilidades para manejo de JWT
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');

/**
 * Generar access y refresh tokens
 */
const generateTokens = (user) => {
  try {
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      rol: user.rol
    };
    
    const accessToken = jwt.sign(
      payload,
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    
    const refreshToken = jwt.sign(
      { id: user.id },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn }
    );
    
    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.expiresIn
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
const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken
};