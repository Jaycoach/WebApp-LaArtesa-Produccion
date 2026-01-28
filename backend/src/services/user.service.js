/**
 * Servicio de Gestión de Usuarios
 * CRUD completo y gestión de usuarios
 */

const bcrypt = require('bcrypt');
const pool = require('../database/connection');
const logger = require('../utils/logger');

class UserService {
  /**
   * Listar todos los usuarios con paginación y filtros
   */
  async listUsers(filters = {}) {
    const {
      page = 1,
      limit = 10,
      search = '',
      rol = null,
      activo = null,
      sortBy = 'fecha_creacion',
      sortOrder = 'DESC',
    } = filters;

    const offset = (page - 1) * limit;
    const client = await pool.getClient();

    try {
      const whereConditions = [];
      const params = [];
      let paramCounter = 1;

      // Filtro de búsqueda
      if (search) {
        whereConditions.push(`(
          username ILIKE $${paramCounter} OR 
          email ILIKE $${paramCounter} OR 
          nombre_completo ILIKE $${paramCounter}
        )`);
        params.push(`%${search}%`);
        paramCounter++;
      }

      // Filtro por rol
      if (rol) {
        whereConditions.push(`rol = $${paramCounter}`);
        params.push(rol);
        paramCounter++;
      }

      // Filtro por estado activo
      if (activo !== null) {
        whereConditions.push(`activo = $${paramCounter}`);
        params.push(activo);
        paramCounter++;
      }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      // Validar campo de ordenamiento
      const validSortFields = ['username', 'email', 'nombre_completo', 'rol', 'fecha_creacion', 'ultimo_acceso'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'fecha_creacion';
      const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Contar total de usuarios
      const countResult = await client.query(
        `SELECT COUNT(*) as total FROM usuarios ${whereClause}`,
        params,
      );

      const total = parseInt(countResult.rows[0].total);

      // Obtener usuarios
      params.push(limit, offset);
      const result = await client.query(
        `SELECT 
          id, username, email, nombre_completo, rol, activo, 
          intentos_fallidos, bloqueado_hasta, 
          fecha_creacion, fecha_actualizacion, ultimo_acceso
         FROM usuarios 
         ${whereClause}
         ORDER BY ${sortField} ${sortDirection}
         LIMIT $${paramCounter} OFFSET $${paramCounter + 1}`,
        params,
      );

      return {
        users: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error al listar usuarios:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener usuario por ID
   */
  async getUserById(userId) {
    const client = await pool.getClient();

    try {
      const result = await client.query(
        `SELECT 
          id, username, email, nombre_completo, rol, activo, 
          intentos_fallidos, bloqueado_hasta, 
          fecha_creacion, fecha_actualizacion, ultimo_acceso
         FROM usuarios 
         WHERE id = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error al obtener usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Crear nuevo usuario (por admin)
   */
  async createUser(userData) {
    const {
      username, email, password, nombre_completo, rol = 'operador',
    } = userData;

    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Verificar si ya existe
      const userExists = await client.query(
        'SELECT id FROM usuarios WHERE username = $1 OR email = $2',
        [username, email],
      );

      if (userExists.rows.length > 0) {
        throw new Error('El usuario o email ya existe');
      }

      // Hash de contraseña
      const hashedPassword = await bcrypt.hash(password, 12);

      // Insertar usuario
      const result = await client.query(
        `INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, username, email, nombre_completo, rol, activo, fecha_creacion`,
        [username, email, hashedPassword, nombre_completo, rol],
      );

      await client.query('COMMIT');

      logger.info(`Usuario creado: ${username} por admin`);

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al crear usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Actualizar usuario
   */
  async updateUser(userId, updates) {
    const { nombre_completo, email, rol } = updates;

    const client = await pool.getClient();

    try {
      // Verificar si el usuario existe
      const userExists = await client.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [userId],
      );

      if (userExists.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Verificar si el email ya está en uso
      if (email) {
        const emailExists = await client.query(
          'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
          [email, userId],
        );

        if (emailExists.rows.length > 0) {
          throw new Error('El email ya está en uso');
        }
      }

      const result = await client.query(
        `UPDATE usuarios 
         SET nombre_completo = COALESCE($1, nombre_completo),
             email = COALESCE($2, email),
             rol = COALESCE($3, rol),
             fecha_actualizacion = NOW()
         WHERE id = $4
         RETURNING id, username, email, nombre_completo, rol, activo`,
        [nombre_completo, email, rol, userId],
      );

      logger.info(`Usuario actualizado: ID ${userId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Error al actualizar usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Eliminar usuario (soft delete)
   */
  async deleteUser(userId) {
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Verificar que el usuario existe
      const userExists = await client.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [userId],
      );

      if (userExists.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Desactivar usuario en lugar de eliminarlo
      await client.query(
        'UPDATE usuarios SET activo = false, fecha_actualizacion = NOW() WHERE id = $1',
        [userId],
      );

      // Revocar todas las sesiones
      await client.query(
        'UPDATE usuarios_sesiones SET revocado = true WHERE usuario_id = $1',
        [userId],
      );

      await client.query('COMMIT');

      logger.info(`Usuario desactivado: ID ${userId}`);

      return { message: 'Usuario desactivado exitosamente' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al eliminar usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Activar usuario
   */
  async activateUser(userId) {
    const client = await pool.getClient();

    try {
      const result = await client.query(
        `UPDATE usuarios 
         SET activo = true, fecha_actualizacion = NOW() 
         WHERE id = $1
         RETURNING id, username, activo`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      logger.info(`Usuario activado: ID ${userId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Error al activar usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Desactivar usuario
   */
  async deactivateUser(userId) {
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Desactivar usuario
      const result = await client.query(
        `UPDATE usuarios 
         SET activo = false, fecha_actualizacion = NOW() 
         WHERE id = $1
         RETURNING id, username, activo`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Revocar sesiones activas
      await client.query(
        'UPDATE usuarios_sesiones SET revocado = true WHERE usuario_id = $1',
        [userId],
      );

      await client.query('COMMIT');

      logger.info(`Usuario desactivado: ID ${userId}`);

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al desactivar usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resetear contraseña de usuario (por admin)
   */
  async resetUserPassword(userId, newPassword) {
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Verificar que el usuario existe
      const userExists = await client.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [userId],
      );

      if (userExists.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Hash de la nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Actualizar contraseña
      await client.query(
        'UPDATE usuarios SET password_hash = $1, fecha_actualizacion = NOW() WHERE id = $2',
        [hashedPassword, userId],
      );

      // Revocar todas las sesiones
      await client.query(
        'UPDATE usuarios_sesiones SET revocado = true WHERE usuario_id = $1',
        [userId],
      );

      // Resetear intentos fallidos
      await client.query(
        `UPDATE usuarios 
         SET intentos_fallidos = 0, bloqueado_hasta = NULL 
         WHERE id = $1`,
        [userId],
      );

      await client.query('COMMIT');

      logger.info(`Contraseña reseteada para usuario ID ${userId} por admin`);

      return { message: 'Contraseña reseteada exitosamente' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al resetear contraseña:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Desbloquear usuario
   */
  async unlockUser(userId) {
    const client = await pool.getClient();

    try {
      const result = await client.query(
        `UPDATE usuarios 
         SET intentos_fallidos = 0, 
             bloqueado_hasta = NULL,
             fecha_actualizacion = NOW()
         WHERE id = $1
         RETURNING id, username, bloqueado_hasta`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      logger.info(`Usuario desbloqueado: ID ${userId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Error al desbloquear usuario:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener actividad del usuario
   */
  async getUserActivity(userId, limit = 20) {
    const client = await pool.getClient();

    try {
      const result = await client.query(
        `SELECT id, accion, tabla, registro_id, detalles, fecha_creacion
         FROM auditoria 
         WHERE usuario_id = $1
         ORDER BY fecha_creacion DESC
         LIMIT $2`,
        [userId, limit],
      );

      return result.rows;
    } catch (error) {
      logger.error('Error al obtener actividad:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener estadísticas de usuarios
   */
  async getUserStats() {
    const client = await pool.getClient();

    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE activo = true) as activos,
          COUNT(*) FILTER (WHERE activo = false) as inactivos,
          COUNT(*) FILTER (WHERE bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()) as bloqueados,
          COUNT(*) FILTER (WHERE rol = 'admin') as admins,
          COUNT(*) FILTER (WHERE rol = 'supervisor') as supervisores,
          COUNT(*) FILTER (WHERE rol = 'operador') as operadores,
          COUNT(*) FILTER (WHERE rol = 'visualizador') as visualizadores
        FROM usuarios
      `);

      return result.rows[0];
    } catch (error) {
      logger.error('Error al obtener estadísticas:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new UserService();
