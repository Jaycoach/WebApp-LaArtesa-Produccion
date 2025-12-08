/**
 * Middleware de Verificación de Roles
 * Verifica que el usuario tenga el rol adecuado para acceder a un recurso
 */

const logger = require('../utils/logger');

/**
 * Jerarquía de roles (de mayor a menor privilegio)
 */
const roleHierarchy = {
  admin: 4,
  supervisor: 3,
  operador: 2,
  visualizador: 1
};

/**
 * Verificar si un usuario tiene uno de los roles permitidos
 * @param {Array} allowedRoles - Array de roles permitidos
 */
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      // Verificar que el usuario esté autenticado
      if (!req.user || !req.user.rol) {
        logger.warn('Intento de acceso sin rol definido');
        return res.status(403).json({
          success: false,
          message: 'Acceso denegado: rol no definido'
        });
      }
      
      const userRole = req.user.rol;
      
      // Verificar si el rol del usuario está en los roles permitidos
      if (!allowedRoles.includes(userRole)) {
        logger.warn(`Usuario ${req.user.username} (${userRole}) intentó acceder a recurso que requiere roles: ${allowedRoles.join(', ')}`);
        return res.status(403).json({
          success: false,
          message: 'Acceso denegado: permisos insuficientes'
        });
      }
      
      // El usuario tiene el rol adecuado
      next();
      
    } catch (error) {
      logger.error('Error en verificación de roles:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al verificar permisos'
      });
    }
  };
};

/**
 * Verificar si un usuario tiene un rol con nivel igual o superior
 * @param {String} minimumRole - Rol mínimo requerido
 */
const checkMinimumRole = (minimumRole) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.rol) {
        logger.warn('Intento de acceso sin rol definido');
        return res.status(403).json({
          success: false,
          message: 'Acceso denegado: rol no definido'
        });
      }
      
      const userRole = req.user.rol;
      const userRoleLevel = roleHierarchy[userRole] || 0;
      const minimumRoleLevel = roleHierarchy[minimumRole] || 0;
      
      if (userRoleLevel < minimumRoleLevel) {
        logger.warn(`Usuario ${req.user.username} (${userRole}) intentó acceder a recurso que requiere rol mínimo: ${minimumRole}`);
        return res.status(403).json({
          success: false,
          message: 'Acceso denegado: permisos insuficientes'
        });
      }
      
      next();
      
    } catch (error) {
      logger.error('Error en verificación de rol mínimo:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al verificar permisos'
      });
    }
  };
};

/**
 * Verificar si el usuario es administrador
 */
const isAdmin = checkRole(['admin']);

/**
 * Verificar si el usuario es administrador o supervisor
 */
const isAdminOrSupervisor = checkRole(['admin', 'supervisor']);

/**
 * Verificar si el usuario puede modificar un recurso
 * Los admins pueden modificar cualquier cosa
 * Los demás usuarios solo pueden modificar sus propios recursos
 */
const canModifyResource = (req, res, next) => {
  try {
    const userRole = req.user.rol;
    const userId = req.user.id;
    const resourceUserId = parseInt(req.params.id) || parseInt(req.body.usuario_id);
    
    // Los admins pueden modificar cualquier recurso
    if (userRole === 'admin') {
      return next();
    }
    
    // Los demás usuarios solo pueden modificar sus propios recursos
    if (userId !== resourceUserId) {
      logger.warn(`Usuario ${req.user.username} intentó modificar recurso de otro usuario`);
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: solo puedes modificar tus propios recursos'
      });
    }
    
    next();
    
  } catch (error) {
    logger.error('Error al verificar permisos de modificación:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar permisos'
    });
  }
};

module.exports = {
  checkRole,
  checkMinimumRole,
  isAdmin,
  isAdminOrSupervisor,
  canModifyResource,
  roleHierarchy
};