/**
 * Middleware de Autenticación JWT
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('./errorHandler');
const db = require('../database/connection');

/**
 * Extraer token del header Authorization o cookies
 */
const extractToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return req.headers.authorization.substring(7);
  }
  return req.cookies?.token || null;
};

/**
 * Verificar token JWT y validaciones de usuario
 */
const verifyToken = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      throw new AppError('No autenticado. Por favor inicie sesión.', 401);
    }

    // 2. Verificar token
    const decoded = jwt.verify(token, config.jwt.secret);

    // 3. Verificar que el usuario aún exista en BD
    const result = await db.query(
      `SELECT id, uuid, username, email, nombre_completo, rol, activo, bloqueado_hasta, ultimo_cambio_password
       FROM usuarios 
       WHERE id = $1`,
      [decoded.userId],
    );

    if (!result.rows.length) {
      throw new AppError('El usuario ya no existe.', 401);
    }

    const user = result.rows[0];

    // 4. Verificar que el usuario esté activo
    if (!user.activo) {
      logger.logSecurity('INACTIVE_USER_ACCESS_ATTEMPT', {
        userId: user.id,
        username: user.username,
        ip: req.ip,
      });
      throw new AppError('Usuario inactivo. Contacte al administrador.', 401);
    }

    // 5. Verificar que el usuario no esté bloqueado
    if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
      logger.logSecurity('BLOCKED_USER_ACCESS_ATTEMPT', {
        userId: user.id,
        username: user.username,
        blockedUntil: user.bloqueado_hasta,
        ip: req.ip,
      });
      throw new AppError('Usuario bloqueado temporalmente.', 403);
    }

    // 6. Verificar cambio de contraseña post-emisión del token
    if (decoded.iat && user.ultimo_cambio_password) {
      const passwordChangeTime = new Date(user.ultimo_cambio_password).getTime() / 1000;
      if (decoded.iat < passwordChangeTime) {
        throw new AppError('Sesión inválida. Por favor inicie sesión nuevamente.', 401);
      }
    }

    // 7. Agregar usuario autenticado al request
    req.user = {
      id: user.id,
      uuid: user.uuid,
      username: user.username,
      email: user.email,
      nombreCompleto: user.nombre_completo,
      rol: user.rol,
    };

    // 8. Actualizar último acceso (sin bloquear)
    db.query(
      'UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id],
    ).catch((err) => logger.error('Error actualizando último acceso:', err));

    return next();
  } catch (error) {
    // Manejar errores específicos de JWT
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Token inválido', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token expirado. Por favor inicie sesión nuevamente.', 401));
    }

    return next(error);
  }
};

/**
 * Middleware para verificar permisos por rol
 * @param {...string} roles - Roles permitidos para acceder
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('No autenticado', 401));
  }

  if (!roles.includes(req.user.rol)) {
    logger.logSecurity('UNAUTHORIZED_ROLE_ACCESS', {
      userId: req.user.id,
      userRole: req.user.rol,
      requiredRoles: roles,
      path: req.path,
      ip: req.ip,
    });

    return next(new AppError('No tiene permisos para realizar esta acción', 403));
  }

  return next();
};

/**
 * Middleware opcional de autenticación
 * Verifica token si existe, continúa sin él si no hay
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, config.jwt.secret);

    const result = await db.query(
      `SELECT id, uuid, username, email, nombre_completo, rol, activo
       FROM usuarios 
       WHERE id = $1 AND activo = true`,
      [decoded.userId],
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      req.user = {
        id: user.id,
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        nombreCompleto: user.nombre_completo,
        rol: user.rol,
      };
    }

    return next();
  } catch (error) {
    // Si hay error de validación, continuar sin usuario
    logger.debug('Autenticación opcional fallida:', error.message);
    return next();
  }
};

/**
 * Middleware para verificar propiedad de recurso o rol admin
 * @param {string} userIdParam - Nombre del parámetro que contiene el userId
 */
const requireOwnerOrAdmin = (userIdParam = 'userId') => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('No autenticado', 401));
  }

  const resourceUserId = parseInt(req.params[userIdParam], 10);
  const isOwner = req.user.id === resourceUserId;
  const isAdmin = req.user.rol === 'ADMIN';

  if (!isOwner && !isAdmin) {
    logger.logSecurity('UNAUTHORIZED_RESOURCE_ACCESS', {
      userId: req.user.id,
      resourceUserId,
      path: req.path,
      ip: req.ip,
    });

    return next(new AppError('No tiene permisos para acceder a este recurso', 403));
  }

  return next();
};

module.exports = {
  verifyToken,
  requireRole,
  optionalAuth,
  requireOwnerOrAdmin,
};
