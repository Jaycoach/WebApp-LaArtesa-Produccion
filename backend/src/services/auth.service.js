/**
 * Servicio de Autenticación
 * Maneja toda la lógica de autenticación, registro, tokens, etc.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../database/connection');
const logger = require('../utils/logger');
const { generateTokens, verifyRefreshToken } = require('../utils/jwt');

class AuthService {
  /**
   * Registrar nuevo usuario
   */
  async register(userData) {
    const {
      username, email, password, nombre_completo, rol = 'operador',
    } = userData;

    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Verificar si el usuario ya existe
      const userExists = await client.query(
        'SELECT id FROM usuarios WHERE username = $1 OR email = $2',
        [username, email],
      );

      if (userExists.rows.length > 0) {
        throw new Error('El usuario o email ya existe');
      }

      // Hash de la contraseña
      const hashedPassword = await bcrypt.hash(password, 12);

      // Insertar usuario
      const result = await client.query(
        `INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, ultimo_cambio_password)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)
         RETURNING id, username, email, nombre_completo, rol, activo, fecha_creacion`,
        [username, email, hashedPassword, nombre_completo, rol, true],
      );

      const user = result.rows[0];

      // Generar tokens
      const tokens = generateTokens(user);

      // Guardar refresh token en la base de datos
      await client.query(
        `INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, tokens.refreshToken],
      );

      await client.query('COMMIT');

      logger.info(`Nuevo usuario registrado: ${username}`);

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nombre_completo: user.nombre_completo,
          rol: user.rol,
          activo: user.activo,
        },
        ...tokens,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error en registro:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Login de usuario
   */
  async login(credentials) {
    const { username, password } = credentials;

    const client = await pool.getClient();

    try {
      // Buscar usuario
      const result = await client.query(
        `SELECT id, username, email, password_hash, nombre_completo, rol, activo, 
                intentos_fallidos, bloqueado_hasta
         FROM usuarios 
         WHERE username = $1 OR email = $1`,
        [username],
      );

      if (result.rows.length === 0) {
        throw new Error('Credenciales inválidas');
      }

      const user = result.rows[0];

      // Verificar si está bloqueado
      if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
        throw new Error(`Cuenta bloqueada hasta ${user.bloqueado_hasta}`);
      }

      // Verificar si está activo
      if (!user.activo) {
        throw new Error('Cuenta desactivada');
      }

      // Verificar contraseña
      const isValidPassword = await bcrypt.compare(password, user.password_hash);

      if (!isValidPassword) {
        // Incrementar intentos fallidos
        await client.query(
          `UPDATE usuarios 
           SET intentos_fallidos = intentos_fallidos + 1,
               bloqueado_hasta = CASE 
                 WHEN intentos_fallidos >= 4 THEN NOW() + INTERVAL '30 minutes'
                 ELSE bloqueado_hasta
               END
           WHERE id = $1`,
          [user.id],
        );

        throw new Error('Credenciales inválidas');
      }

      // Reset intentos fallidos y actualizar último login
      await client.query(
        `UPDATE usuarios
         SET intentos_fallidos = 0,
             bloqueado_hasta = NULL,
             ultimo_acceso = NOW()
         WHERE id = $1`,
        [user.id],
      );

      // Generar tokens
      const tokens = generateTokens(user);

      // Guardar refresh token
      await client.query(
        `INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, tokens.refreshToken],
      );

      logger.info(`Usuario ${username} inició sesión`);

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nombre_completo: user.nombre_completo,
          rol: user.rol,
        },
        ...tokens,
      };
    } catch (error) {
      logger.error('Error en login:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Refrescar access token
   */
  async refreshToken(refreshToken) {
    const client = await pool.getClient();

    try {
      // Verificar refresh token
      const decoded = verifyRefreshToken(refreshToken);

      // Verificar que el token exista en la BD y no haya expirado
      const tokenResult = await client.query(
        `SELECT usuario_id, expires_at 
         FROM usuarios_sesiones 
         WHERE refresh_token = $1 AND revocado = false`,
        [refreshToken],
      );

      if (tokenResult.rows.length === 0) {
        throw new Error('Token inválido o revocado');
      }

      const session = tokenResult.rows[0];

      if (new Date(session.expires_at) < new Date()) {
        throw new Error('Token expirado');
      }

      // Obtener datos del usuario
      const userResult = await client.query(
        `SELECT id, username, email, nombre_completo, rol, activo
         FROM usuarios 
         WHERE id = $1 AND activo = true`,
        [session.usuario_id],
      );

      if (userResult.rows.length === 0) {
        throw new Error('Usuario no encontrado o desactivado');
      }

      const user = userResult.rows[0];

      // Generar nuevos tokens
      const tokens = generateTokens(user);

      // Revocar el token anterior
      await client.query(
        `UPDATE usuarios_sesiones 
         SET revocado = true 
         WHERE refresh_token = $1`,
        [refreshToken],
      );

      // Guardar nuevo refresh token
      await client.query(
        `INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, tokens.refreshToken],
      );

      logger.info(`Token refrescado para usuario ${user.username}`);

      return tokens;
    } catch (error) {
      logger.error('Error al refrescar token:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Logout - Revocar refresh token
   */
  async logout(refreshToken) {
    const client = await pool.getClient();

    try {
      await client.query(
        `UPDATE usuarios_sesiones 
         SET revocado = true 
         WHERE refresh_token = $1`,
        [refreshToken],
      );

      logger.info('Usuario cerró sesión');

      return { message: 'Sesión cerrada exitosamente' };
    } catch (error) {
      logger.error('Error en logout:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Solicitar recuperación de contraseña
   */
  async forgotPassword(email) {
    const client = await pool.getClient();

    try {
      // Buscar usuario
      const result = await client.query(
        'SELECT id, email, nombre_completo FROM usuarios WHERE email = $1 AND activo = true',
        [email],
      );

      if (result.rows.length === 0) {
        // Por seguridad, no revelar si el email existe
        return { message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña' };
      }

      const user = result.rows[0];

      // Generar token de recuperación
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // Guardar token en la BD (válido por 1 hora)
      await client.query(
        `UPDATE usuarios 
         SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour'
         WHERE id = $2`,
        [hashedToken, user.id],
      );

      logger.info(`Token de recuperación generado para ${email}`);

      // TODO: Enviar email con el token
      // Por ahora, devolver el token (SOLO PARA DESARROLLO)
      return {
        message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña',
        resetToken, // REMOVER EN PRODUCCIÓN
      };
    } catch (error) {
      logger.error('Error en forgot password:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resetear contraseña con token
   */
  async resetPassword(resetToken, newPassword) {
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Hash del token recibido
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // Buscar usuario con el token válido
      const result = await client.query(
        `SELECT id, email 
         FROM usuarios 
         WHERE reset_token = $1 
         AND reset_token_expires > NOW()
         AND activo = true`,
        [hashedToken],
      );

      if (result.rows.length === 0) {
        throw new Error('Token inválido o expirado');
      }

      const user = result.rows[0];

      // Hash de la nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Actualizar contraseña y limpiar token
      await client.query(
        `UPDATE usuarios 
         SET password_hash = $1,
             reset_token = NULL,
             reset_token_expires = NULL,
             fecha_actualizacion = NOW()
         WHERE id = $2`,
        [hashedPassword, user.id],
      );

      // Revocar todas las sesiones activas
      await client.query(
        'UPDATE usuarios_sesiones SET revocado = true WHERE usuario_id = $1',
        [user.id],
      );

      await client.query('COMMIT');

      logger.info(`Contraseña reseteada para ${user.email}`);

      return { message: 'Contraseña actualizada exitosamente' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al resetear contraseña:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cambiar contraseña (estando autenticado)
   */
  async changePassword(userId, currentPassword, newPassword) {
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Obtener contraseña actual
      const result = await client.query(
        'SELECT password_hash FROM usuarios WHERE id = $1',
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      const user = result.rows[0];

      // Verificar contraseña actual
      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

      if (!isValidPassword) {
        throw new Error('Contraseña actual incorrecta');
      }

      // Hash de la nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Actualizar contraseña
      await client.query(
        'UPDATE usuarios SET password_hash = $1, fecha_actualizacion = NOW() WHERE id = $2',
        [hashedPassword, userId],
      );

      await client.query('COMMIT');

      logger.info(`Contraseña cambiada para usuario ID ${userId}`);

      return { message: 'Contraseña actualizada exitosamente' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al cambiar contraseña:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener perfil de usuario
   */
  async getProfile(userId) {
    const client = await pool.getClient();

    try {
      const result = await client.query(
        `SELECT id, username, email, nombre_completo, rol, activo,
                fecha_creacion, fecha_actualizacion, ultimo_acceso as ultimo_login
         FROM usuarios
         WHERE id = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error al obtener perfil:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Actualizar perfil de usuario
   */
  async updateProfile(userId, updates) {
    const client = await pool.getClient();

    try {
      const { nombre_completo, email } = updates;

      // Verificar si el email ya está en uso por otro usuario
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
             fecha_actualizacion = NOW()
         WHERE id = $3
         RETURNING id, username, email, nombre_completo, rol`,
        [nombre_completo, email, userId],
      );

      logger.info(`Perfil actualizado para usuario ID ${userId}`);

      return result.rows[0];
    } catch (error) {
      logger.error('Error al actualizar perfil:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new AuthService();
