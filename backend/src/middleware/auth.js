/**
 * Middleware de Autenticación JWT
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('./errorHandler');
const db = require('../database/connection');

const CODIGO_SESION_REEMPLAZADA = 'SESSION_REPLACED';
const MENSAJE_SESION_REEMPLAZADA = 'Su sesión fue cerrada porque se inició sesión en otro dispositivo o navegador.';
const RUTA_SET_PASSWORD = /\/auth\/set-initial-password\/?(\?|$)/;

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

    // Un sid (id de sesión) presente pero inválido solo puede venir de un token manipulado
    const tieneSid = decoded.sid !== undefined && decoded.sid !== null;
    if (tieneSid && !(Number.isInteger(decoded.sid) && decoded.sid > 0)) {
      throw new AppError(MENSAJE_SESION_REEMPLAZADA, 401, CODIGO_SESION_REEMPLAZADA);
    }

    // 3. Verificar que el usuario aún exista en BD. En la MISMA consulta (subconsulta por clave
    //    primaria de usuarios_sesiones, sin ida y vuelta extra) se comprueba, si el token trae
    //    sid, que esa sesión sea del usuario y no esté revocada.
    const result = await db.query(
      `SELECT id, uuid, username, email, nombre_completo, rol, activo, bloqueado_hasta, ultimo_cambio_password,
              (SELECT s.revocado = false AND s.usuario_id = usuarios.id
                 FROM usuarios_sesiones s WHERE s.id = $2::integer) AS sesion_vigente
       FROM usuarios 
       WHERE id = $1`,
      [decoded.id, tieneSid ? decoded.sid : null],
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

    // 5b. Sesión reemplazada, revocada o inexistente (sesión única, logout, cambio de contraseña,
    //     desactivación) y access tokens SIN sid (emitidos antes de la sesión única: ya no valen,
    //     todos inician sesión una vez tras el despliegue). Va ANTES del chequeo de cambio de
    //     contraseña para que las demás estaciones reciban el code SESSION_REPLACED. Los demás 401
    //     conservan su mensaje y code.
    //     Única excepción: el token corto (15 min) que emite la verificación de correo, acotado con
    //     scp='set-password', solo vale en /auth/set-initial-password (alta de usuarios nuevos).
    const esTokenSetPassword = decoded.scp === 'set-password' && RUTA_SET_PASSWORD.test(req.originalUrl || '');
    if (!esTokenSetPassword && (!tieneSid || user.sesion_vigente !== true)) {
      throw new AppError(MENSAJE_SESION_REEMPLAZADA, 401, CODIGO_SESION_REEMPLAZADA);
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
      rol: (user.rol || '').toLowerCase(),
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
      `SELECT id, uuid, username, email, nombre_completo, rol, activo,
              (SELECT s.revocado = false AND s.usuario_id = usuarios.id
                 FROM usuarios_sesiones s WHERE s.id = $2::integer) AS sesion_vigente
       FROM usuarios 
       WHERE id = $1 AND activo = true`,
      [decoded.id, Number.isInteger(decoded.sid) ? decoded.sid : null],
    );

    if (result.rows.length > 0 && Number.isInteger(decoded.sid) && result.rows[0].sesion_vigente === true) {
      const user = result.rows[0];
      req.user = {
        id: user.id,
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        nombreCompleto: user.nombre_completo,
        rol: (user.rol || '').toLowerCase(),
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
  const isAdmin = req.user.rol === 'admin';

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
