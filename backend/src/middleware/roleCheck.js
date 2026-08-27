/**
 * Middleware de Verificación de Roles
 * Verifica que el usuario tenga el rol adecuado para acceder a un recurso
 */

const logger = require('../utils/logger');
const db = require('../database/connection');
const { canModifyTarget, canAssignRole } = require('../utils/roleHierarchy');

/**
 * Jerarquía de roles (de mayor a menor privilegio)
 */
const roleHierarchy = {
  admin: 4,
  supervisor: 3,
  operador: 2,
  visualizador: 1,
};

/**
 * Verificar si un usuario tiene uno de los roles permitidos
 * @param {Array} allowedRoles - Array de roles permitidos
 */
const checkRole = (allowedRoles) => (req, res, next) => {
  try {
    // Verificar que el usuario esté autenticado
    if (!req.user || !req.user.rol) {
      logger.warn('Intento de acceso sin rol definido');
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: rol no definido',
      });
    }

    const userRole = (req.user.rol || '').toLowerCase();

    // Verificar si el rol del usuario está en los roles permitidos
    if (!allowedRoles.includes(userRole)) {
      logger.warn(`Usuario ${req.user.username} (${userRole}) intentó acceder a recurso que requiere roles: ${allowedRoles.join(', ')}`);
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: permisos insuficientes',
      });
    }

    // El usuario tiene el rol adecuado
    next();
  } catch (error) {
    logger.error('Error en verificación de roles:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar permisos',
    });
  }
};

/**
 * Verificar si un usuario tiene un rol con nivel igual o superior
 * @param {String} minimumRole - Rol mínimo requerido
 */
const checkMinimumRole = (minimumRole) => (req, res, next) => {
  try {
    if (!req.user || !req.user.rol) {
      logger.warn('Intento de acceso sin rol definido');
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: rol no definido',
      });
    }

    const userRole = (req.user.rol || '').toLowerCase();
    const userRoleLevel = roleHierarchy[userRole] || 0;
    const minimumRoleLevel = roleHierarchy[minimumRole] || 0;

    if (userRoleLevel < minimumRoleLevel) {
      logger.warn(`Usuario ${req.user.username} (${userRole}) intentó acceder a recurso que requiere rol mínimo: ${minimumRole}`);
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: permisos insuficientes',
      });
    }

    next();
  } catch (error) {
    logger.error('Error en verificación de rol mínimo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar permisos',
    });
  }
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
    const userRole = (req.user.rol || '').toLowerCase();
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
        message: 'Acceso denegado: solo puedes modificar tus propios recursos',
      });
    }

    next();
  } catch (error) {
    logger.error('Error al verificar permisos de modificación:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar permisos',
    });
  }
};

/**
 * Verifica que quien hace la petición pueda modificar al usuario objetivo
 * (:id de la ruta) según la jerarquía de roles real (ver utils/roleHierarchy).
 * Un admin puede modificar a cualquiera; cualquier otro rol solo puede
 * modificar a alguien de rango estrictamente inferior al suyo (nunca a un
 * par ni a un superior). Se consulta el rol REAL y actual del usuario
 * objetivo en BD — nunca el que venga en el body de la petición.
 */
const requireCanModifyTarget = async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!targetId) return next(); // la validación de :id se encarga de esto

    const result = await db.query('SELECT rol FROM usuarios WHERE id = $1', [targetId]);
    if (result.rows.length === 0) return next(); // 404 lo maneja el controller/servicio

    const targetRol = result.rows[0].rol;
    const requesterRol = req.user?.rol;

    if (!canModifyTarget(requesterRol, targetRol)) {
      logger.warn(`Usuario ${req.user.username} (${requesterRol}) intentó modificar a usuario id=${targetId} (${targetRol}) — jerarquía insuficiente`);
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos para modificar a un usuario con rol igual o superior al tuyo.',
      });
    }
    next();
  } catch (error) {
    logger.error('Error en requireCanModifyTarget:', error);
    return res.status(500).json({ success: false, message: 'Error al verificar permisos' });
  }
};

/**
 * Bloquea la asignación del rol admin a cualquiera que no venga de un
 * admin (crear o actualizar usuario). No decide nada sobre otros roles —
 * ver utils/roleHierarchy.canAssignRole.
 */
const preventRoleEscalation = (req, res, next) => {
  const { rol } = req.body;
  if (!rol) return next();

  if (!canAssignRole(req.user?.rol, rol)) {
    logger.warn(`Usuario ${req.user.username} (${req.user.rol}) intentó asignar el rol '${rol}' sin ser admin`);
    return res.status(403).json({
      success: false,
      message: 'Solo un administrador puede asignar el rol admin.',
    });
  }
  next();
};

module.exports = {
  checkRole,
  checkMinimumRole,
  isAdmin,
  isAdminOrSupervisor,
  canModifyResource,
  requireCanModifyTarget,
  preventRoleEscalation,
  roleHierarchy,
};
