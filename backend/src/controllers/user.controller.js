/**
 * Controlador de Gestión de Usuarios
 * Maneja las peticiones HTTP para usuarios
 */

const userService = require('../services/user.service');
const logger = require('../utils/logger');

class UserController {
  /**
   * Listar usuarios con paginación y filtros
   * GET /api/users
   */
  async listUsers(req, res, next) {
    try {
      const filters = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 10,
        search: req.query.search || '',
        rol: req.query.rol || null,
        activo: req.query.activo !== undefined ? req.query.activo === 'true' : null,
        sortBy: req.query.sortBy || 'created_at',
        sortOrder: req.query.sortOrder || 'DESC',
      };

      const result = await userService.listUsers(filters);

      res.json({
        success: true,
        data: { users: result.users },
        pagination: result.pagination,
      });
    } catch (error) {
      logger.error('Error al listar usuarios:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Obtener usuario por ID
   * GET /api/users/:id
   */
  async getUserById(req, res, next) {
    try {
      const { id } = req.params;

      const user = await userService.getUserById(id);

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      logger.error('Error al obtener usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Crear nuevo usuario
   * POST /api/users
   */
  async createUser(req, res, next) {
    try {
      const {
        username, email, password, nombre_completo, rol,
      } = req.body;

      const user = await userService.createUser({
        username,
        email,
        password,
        nombre_completo,
        rol,
      });

      res.status(201).json({
        success: true,
        message: 'Usuario creado exitosamente',
        data: user,
      });
    } catch (error) {
      logger.error('Error al crear usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Actualizar usuario
   * PUT /api/users/:id
   */
  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const { nombre_completo, email, rol } = req.body;

      const user = await userService.updateUser(id, {
        nombre_completo,
        email,
        rol,
      });

      res.json({
        success: true,
        message: 'Usuario actualizado exitosamente',
        data: user,
      });
    } catch (error) {
      logger.error('Error al actualizar usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
        'No puedes dejar el sistema sin ningún administrador activo.',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Eliminar usuario (soft delete)
   * DELETE /api/users/:id
   */
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;

      // Prevenir que un usuario se elimine a sí mismo
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'No puedes eliminarte a ti mismo',
        });
      }

      const result = await userService.deleteUser(id);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error al eliminar usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
        'No puedes dejar el sistema sin ningún administrador activo.',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Activar usuario
   * POST /api/users/:id/activate
   */
  async activateUser(req, res, next) {
    try {
      const { id } = req.params;

      const user = await userService.activateUser(id);

      res.json({
        success: true,
        message: 'Usuario activado exitosamente',
        data: user,
      });
    } catch (error) {
      logger.error('Error al activar usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Desactivar usuario
   * POST /api/users/:id/deactivate
   */
  async deactivateUser(req, res, next) {
    try {
      const { id } = req.params;

      // Prevenir que un usuario se desactive a sí mismo
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'No puedes desactivarte a ti mismo',
        });
      }

      const user = await userService.deactivateUser(id);

      res.json({
        success: true,
        message: 'Usuario desactivado exitosamente',
        data: user,
      });
    } catch (error) {
      logger.error('Error al desactivar usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
        'No puedes dejar el sistema sin ningún administrador activo.',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Resetear contraseña de usuario
   * POST /api/users/:id/reset-password
   */
  async resetUserPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Nueva contraseña requerida',
        });
      }

      const result = await userService.resetUserPassword(id, newPassword);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error al resetear contraseña:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Desbloquear usuario
   * POST /api/users/:id/unlock
   */
  async unlockUser(req, res, next) {
    try {
      const { id } = req.params;

      const user = await userService.unlockUser(id);

      res.json({
        success: true,
        message: 'Usuario desbloqueado exitosamente',
        data: user,
      });
    } catch (error) {
      logger.error('Error al desbloquear usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Obtener actividad de usuario
   * GET /api/users/:id/activity
   */
  async getUserActivity(req, res, next) {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit) || 20;

      const activity = await userService.getUserActivity(id, limit);

      res.json({
        success: true,
        data: activity,
      });
    } catch (error) {
      logger.error('Error al obtener actividad:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Obtener estadísticas de usuarios
   * GET /api/users/stats
   */
  async getUserStats(req, res, next) {
    try {
      const stats = await userService.getUserStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Error al obtener estadísticas:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Obtener usuarios pendientes de aprobación (activo=false)
   * GET /api/users/pending
   */
  async getPendingUsers(req, res, next) {
    try {
      const result = await require('../database/connection').query(
        `SELECT id, username, email, nombre_completo, rol, activo, email_verificado, fecha_creacion
         FROM usuarios
         WHERE activo = false
         ORDER BY fecha_creacion DESC`,
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      logger.error('Error al obtener usuarios pendientes:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  /**
   * Aprobar usuario — activa acceso tras verificación de email
   * POST /api/users/:id/approve
   * Permite admin y supervisor (a diferencia de /activate que es solo admin)
   */
  async approveUser(req, res, next) {
    try {
      const { id } = req.params;
      const result = await require('../database/connection').query(
        `UPDATE usuarios
         SET activo = true, fecha_actualizacion = NOW(), actualizado_por = $2
         WHERE id = $1
         RETURNING id, username, email, nombre_completo, rol`,
        [id, req.user.id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      }
      logger.info(`Usuario ${result.rows[0].username} aprobado por ${req.user.username}`);
      res.json({ success: true, message: 'Usuario aprobado exitosamente', data: result.rows[0] });
    } catch (error) {
      logger.error('Error al aprobar usuario:', error);
      const businessErrors = [
        'Usuario no encontrado',
        'El usuario o email ya existe',
        'El email ya está en uso',
      ];
      if (businessErrors.includes(error.message)) {
        return res.status(400).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
}

module.exports = new UserController();
