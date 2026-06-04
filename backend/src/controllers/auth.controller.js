/**
 * Controlador de Autenticación
 * Maneja las peticiones HTTP de autenticación
 */

const authService = require('../services/auth.service');
const logger = require('../utils/logger');

class AuthController {
  /**
   * Registrar nuevo usuario
   * POST /api/auth/register
   */
  async register(req, res, next) {
    try {
      const {
        username, email, password, nombre_completo, rol,
      } = req.body;

      const result = await authService.register({
        username,
        email,
        password,
        nombre_completo,
        rol,
      });

      res.status(201).json({
        success: true,
        message: 'Usuario registrado exitosamente',
        data: result,
      });
    } catch (error) {
      logger.error('Error en registro:', error);
      next(error);
    }
  }

  /**
   * Login de usuario
   * POST /api/auth/login
   */
  async login(req, res, next) {
    try {
      const { username, password } = req.body;

      const result = await authService.login({ username, password });

      res.json({
        success: true,
        message: 'Login exitoso',
        data: result,
      });
    } catch (error) {
      logger.error('Error en login:', error);
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          message: error.message,
        });
      }
      next(error);
    }
  }

  /**
   * Refrescar access token
   * POST /api/auth/refresh
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token requerido',
        });
      }

      const tokens = await authService.refreshToken(refreshToken);

      res.json({
        success: true,
        message: 'Token refrescado exitosamente',
        data: tokens,
      });
    } catch (error) {
      logger.error('Error al refrescar token:', error);
      next(error);
    }
  }

  /**
   * Logout
   * POST /api/auth/logout
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token requerido',
        });
      }

      await authService.logout(refreshToken);

      res.json({
        success: true,
        message: 'Sesión cerrada exitosamente',
      });
    } catch (error) {
      logger.error('Error en logout:', error);
      next(error);
    }
  }

  /**
   * Solicitar recuperación de contraseña
   * POST /api/auth/forgot-password
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email requerido',
        });
      }

      const result = await authService.forgotPassword(email);

      res.json({
        success: true,
        message: result.message,
        // Solo incluir token en desarrollo
        ...(process.env.NODE_ENV === 'development' && { resetToken: result.resetToken }),
      });
    } catch (error) {
      logger.error('Error en forgot password:', error);
      next(error);
    }
  }

  /**
   * Resetear contraseña con token
   * POST /api/auth/reset-password
   */
  async resetPassword(req, res, next) {
    try {
      const { resetToken, newPassword } = req.body;

      if (!resetToken || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Token y nueva contraseña requeridos',
        });
      }

      const result = await authService.resetPassword(resetToken, newPassword);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error al resetear contraseña:', error);
      next(error);
    }
  }

  /**
   * Cambiar contraseña (autenticado)
   * POST /api/auth/change-password
   */
  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id; // Del middleware de autenticación

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Contraseña actual y nueva contraseña requeridas',
        });
      }

      const result = await authService.changePassword(userId, currentPassword, newPassword);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error al cambiar contraseña:', error);
      next(error);
    }
  }

  /**
   * Establecer contraseña inicial tras verificación de email
   * POST /api/auth/set-initial-password
   */
  async setInitialPassword(req, res, next) {
    try {
      const { newPassword } = req.body;
      const userId = req.user.id;

      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'La contraseña debe tener al menos 8 caracteres',
        });
      }

      const result = await authService.setInitialPassword(userId, newPassword);
      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error al establecer contraseña inicial:', error);
      next(error);
    }
  }

  /**
   * Obtener perfil del usuario autenticado
   * GET /api/auth/profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.id; // Del middleware de autenticación

      const profile = await authService.getProfile(userId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      logger.error('Error al obtener perfil:', error);
      next(error);
    }
  }

  /**
   * Actualizar perfil del usuario autenticado
   * PUT /api/auth/profile
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.id; // Del middleware de autenticación
      const { nombre_completo, email } = req.body;

      const updatedProfile = await authService.updateProfile(userId, {
        nombre_completo,
        email,
      });

      res.json({
        success: true,
        message: 'Perfil actualizado exitosamente',
        data: updatedProfile,
      });
    } catch (error) {
      logger.error('Error al actualizar perfil:', error);
      next(error);
    }
  }

  /**
   * Solicitar verificación de email (usuario existente sin verificar)
   * POST /api/auth/request-verification
   */
  async requestEmailVerification(req, res, next) {
    try {
      const { username, email } = req.body;

      if (!username || !email) {
        return res.status(400).json({
          success: false,
          message: 'Usuario y correo son requeridos',
        });
      }

      const result = await authService.requestEmailVerification(username, email);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error('Error en requestEmailVerification:', error);
      next(error);
    }
  }

  /**
   * Verificar si el token es válido
   * GET /api/auth/verify
   */
  async verifyToken(req, res, next) {
    try {
      // Si llegó aquí, el middleware de auth ya verificó el token
      res.json({
        success: true,
        message: 'Token válido',
        user: req.user,
      });
    } catch (error) {
      logger.error('Error al verificar token:', error);
      next(error);
    }
  }

  /**
   * Verificar email con token
   * GET /api/auth/verify-email?token=<token>
   */
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.query;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token de verificación requerido',
        });
      }

      const hashedToken = require('crypto')
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const result = await require('../database/connection').query(
        `UPDATE usuarios
         SET email_verificado = true,
             activo = true,
             token_verificacion = NULL,
             fecha_actualizacion = NOW()
         WHERE token_verificacion = $1
           AND email_verificado = false
         RETURNING id, username, email, nombre_completo, rol, debe_cambiar_password`,
        [hashedToken],
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Token inválido o ya utilizado',
        });
      }

      const user = result.rows[0];
      require('../utils/logger').info(`Email verificado: ${user.email}`);

      // Emitir accessToken para que el frontend pueda llamar set-initial-password
      const jwt = require('jsonwebtoken');
      const accessToken = jwt.sign(
        { id: user.id, username: user.username, email: user.email, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }, // token corto — solo para set-password
      );

      return res.json({
        success: true,
        message: '¡Correo verificado exitosamente! Ya puedes iniciar sesión.',
        data: {
          email: user.email,
          nombre: user.nombre_completo,
          debe_cambiar_password: user.debe_cambiar_password,
          accessToken: user.debe_cambiar_password ? accessToken : undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
