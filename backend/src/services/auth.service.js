/**
 * Servicio de Autenticación
 * Maneja toda la lógica de autenticación, registro, tokens, etc.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../database/connection');
const config = require('../config');
const logger = require('../utils/logger');
const { generarRefreshToken, generarAccessToken, verifyRefreshToken } = require('../utils/jwt');
const emailService = require('./email.service');
const {
  passwordFueUsadaAntes,
  guardarPasswordEnHistorial,
  aplicarNuevaPassword,
  registrarEventoSeguridad,
  motivoCambioObligatorio,
  EVENTO,
} = require('./securityHelpers');

/**
 * Inserta una sesión (refresh token) con la IP y el navegador de origen.
 * La IP/UA son trazabilidad, NO condición para iniciar sesión: si el INSERT falla por esos datos
 * (valor inválido para inet/texto) se reintenta SIN ellos, de modo que un encabezado raro nunca
 * haga fallar un login o un refresh. Una colisión real (23505) no se reintenta.
 * `transaccional`: dentro de BEGIN/COMMIT; el primer intento va en un SAVEPOINT para que su error
 * no aborte la transacción.
 * Devuelve el id de la fila insertada (será el claim `sid` del access token).
 */
async function insertarSesion(client, {
  userId, refreshToken, ip = null, userAgent = null,
}, transaccional = false) {
  const conMeta = `INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at, ip_address, user_agent)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
         RETURNING id`;
  const sinMeta = `INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')
         RETURNING id`;
  let resultado;
  try {
    if (transaccional) await client.query('SAVEPOINT sesion_meta');
    resultado = await client.query(conMeta, [userId, refreshToken, ip, userAgent]);
    if (transaccional) await client.query('RELEASE SAVEPOINT sesion_meta');
  } catch (error) {
    if (transaccional) await client.query('ROLLBACK TO SAVEPOINT sesion_meta');
    if (error.code === '23505') throw error;
    logger.warn(`No se pudo guardar IP/navegador de la sesión del usuario ${userId} (${error.message}); se guarda sin ellos`);
    resultado = await client.query(sinMeta, [userId, refreshToken]);
  }
  const sesionId = resultado.rows && resultado.rows[0] && resultado.rows[0].id;
  if (!sesionId) throw new Error('No se pudo registrar la sesión');
  return sesionId;
}

// Máximo de sesiones desplazadas que se detallan en la auditoría (el resto solo se cuenta)
const MAX_DESPLAZADAS_AUDITADAS = 20;

/**
 * Abre la sesión de un login exitoso (sesión única por usuario).
 *
 * Una sola transacción: bloquea la fila del usuario (dos logins simultáneos del mismo usuario se
 * serializan y la última en entrar deja EXACTAMENTE una sesión viva), revoca todas sus demás
 * sesiones vigentes (salvo que el interruptor de emergencia SINGLE_SESSION_PER_USER=false lo
 * desactive), inserta la nueva y firma el access token con su sid. Si algo falla: ROLLBACK y la
 * sesión previa sigue viva. La auditoría SESION_REEMPLAZADA va en SAVEPOINT: nunca revierte el login.
 * NO se usa en /auth/refresh (la rotación reemplaza una sesión por otra sin tocar las demás).
 */
async function abrirSesionLogin(client, user, { ip = null, userAgent = null } = {}) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [user.id]);

    let desplazadas = [];
    if (config.security.singleSessionPerUser) {
      const revocadas = await client.query(
        `UPDATE usuarios_sesiones SET revocado = true
         WHERE usuario_id = $1 AND revocado = false
         RETURNING host(ip_address) AS ip, user_agent`,
        [user.id],
      );
      desplazadas = revocadas.rows || [];
    }

    const refreshToken = generarRefreshToken(user);
    const sesionId = await insertarSesion(client, {
      userId: user.id, refreshToken, ip, userAgent,
    }, true);
    const accessToken = generarAccessToken(user, sesionId);

    if (desplazadas.length > 0) {
      const recorta = (ua) => (ua ? String(ua).slice(0, 150) : null);
      await registrarEventoSeguridad(client, {
        codigo: EVENTO.SESION_REEMPLAZADA,
        descripcion: `${desplazadas.length} sesión(es) cerrada(s) por un nuevo inicio de sesión`,
        usuarioObjetivoId: user.id,
        actor: { id: user.id, nombre: user.nombre_completo || user.username },
        camposModificados: ['usuarios_sesiones.revocado'],
        detalles: {
          sesiones_cerradas: desplazadas.length,
          desplazadas: desplazadas.slice(0, MAX_DESPLAZADAS_AUDITADAS)
            .map((s) => ({ ip: s.ip || null, navegador: recorta(s.user_agent) })),
          desplazadas_omitidas: Math.max(0, desplazadas.length - MAX_DESPLAZADAS_AUDITADAS),
          nuevo_login: { ip: ip || null, navegador: recorta(userAgent) },
        },
        ip,
        userAgent,
        transaccional: true,
      });
    }

    await client.query('COMMIT');
    return { accessToken, refreshToken, expiresIn: config.jwt.expiresIn };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) { /* conexión ya caída */ }
    throw error;
  }
}

/**
 * Registra un intento de login fallido con lo necesario para investigarlo:
 * username intentado, IP real, navegador y motivo. NUNCA recibe ni registra la
 * contraseña. Username y user-agent los escribe quien ataca: se limpian de
 * caracteres de control y se serializan entre comillas para que no puedan
 * falsear líneas del log.
 */
function registrarFalloLogin(username, motivo, meta = {}) {
  try {
    const limpiar = (valor, max) => String(valor ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
    const user = JSON.stringify(limpiar(username, 100));
    const ua = JSON.stringify(limpiar(meta.userAgent, 150) || 'desconocido');
    logger.warn(`Login fallido username=${user} ip=${meta.ip || 'desconocida'} motivo=${motivo} ua=${ua}`);
  } catch (e) { /* el log nunca debe alterar el resultado del login */ }
}

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

      // Generar token de verificación de email
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const hashedVerificationToken = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');

      // Insertar usuario con token de verificación (activo=false hasta verificar)
      const result = await client.query(
        `INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo,
                               email_verificado, token_verificacion, ultimo_cambio_password)
         VALUES ($1, $2, $3, $4, $5, false, false, $6, NULL)
         RETURNING id, username, email, nombre_completo, rol, activo, fecha_creacion`,
        [username, email, hashedPassword, nombre_completo, rol, hashedVerificationToken],
      );

      const user = result.rows[0];

      await client.query('COMMIT');

      // Enviar email de verificación (fuera de la transacción — no bloquea el registro)
      emailService.sendVerificationEmail({
        to: user.email,
        nombre: user.nombre_completo,
        token: verificationToken, // token sin hash — el hash va en DB
      }).catch(err => logger.error('Error enviando email de verificación:', err));

      logger.info(`Nuevo usuario registrado (pendiente verificación): ${username}`);

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nombre_completo: user.nombre_completo,
          rol: user.rol,
          activo: false,
          email_verificado: false,
        },
        message: 'Registro exitoso. Revisa tu correo para verificar tu cuenta.',
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
  async login(credentials, meta = {}) {
    const { username, password } = credentials;
    const { ip = null, userAgent = null } = meta;

    const client = await pool.getClient();

    try {
      // Buscar usuario
      const result = await client.query(
        `SELECT id, username, email, password_hash, nombre_completo, rol, activo,
                email_verificado, intentos_fallidos, bloqueado_hasta,
                debe_cambiar_password,
                (ultimo_cambio_password < NOW() - INTERVAL '3 months') AS password_expirada,
                (ultimo_cambio_password > fecha_creacion + INTERVAL '1 second') AS cambio_posterior_alta,
                (bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= NOW()) AS bloqueo_vencido
         FROM usuarios
         WHERE username = $1 OR email = $1`,
        [username],
      );

      if (result.rows.length === 0) {
        registrarFalloLogin(username, 'usuario_inexistente', meta);
        throw new Error('Credenciales inválidas');
      }

      const user = result.rows[0];

      // Si el bloqueo ya venció, el contador de intentos parte de cero: sin esto
      // intentos_fallidos arrastra el valor del bloqueo anterior (>= umbral) y un
      // solo error nuevo reactiva otro bloqueo completo.
      if (user.bloqueo_vencido) {
        await client.query(
          `UPDATE usuarios
           SET intentos_fallidos = 0,
               bloqueado_hasta = NULL
           WHERE id = $1
             AND bloqueado_hasta IS NOT NULL
             AND bloqueado_hasta <= NOW()`,
          [user.id],
        );
        user.intentos_fallidos = 0;
        user.bloqueado_hasta = null;
      }

      // Verificar si está bloqueado
      if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
        registrarFalloLogin(username, 'cuenta_bloqueada', meta);
        throw new Error(`Cuenta bloqueada hasta ${user.bloqueado_hasta}`);
      }

      // Verificar si está activo
      if (!user.activo) {
        registrarFalloLogin(username, 'cuenta_desactivada', meta);
        throw new Error('Cuenta desactivada');
      }

      // Verificar email verificado
      if (!user.email_verificado) {
        registrarFalloLogin(username, 'email_no_verificado', meta);
        const err = new Error('Debes verificar tu correo antes de iniciar sesión');
        err.code = 'EMAIL_NOT_VERIFIED';
        throw err;
      }

      // Verificar contraseña
      const isValidPassword = await bcrypt.compare(password, user.password_hash);

      if (!isValidPassword) {
        // Incrementar intentos fallidos
        const fallo = await client.query(
          `UPDATE usuarios 
           SET intentos_fallidos = intentos_fallidos + 1,
               bloqueado_hasta = CASE 
                 WHEN intentos_fallidos + 1 >= $2 THEN NOW() + make_interval(mins => $3)
                 ELSE bloqueado_hasta
               END
           WHERE id = $1
           RETURNING intentos_fallidos, bloqueado_hasta`,
          [user.id, config.security.maxLoginAttempts, config.security.lockoutDuration],
        );

        registrarFalloLogin(username, 'password_incorrecta', meta);

        const estado = fallo.rows && fallo.rows[0];
        if (estado && estado.bloqueado_hasta && estado.intentos_fallidos >= config.security.maxLoginAttempts) {
          await registrarEventoSeguridad(client, {
            codigo: EVENTO.BLOQUEO_CUENTA_INTENTOS,
            descripcion: `cuenta bloqueada ${config.security.lockoutDuration} min tras ${estado.intentos_fallidos} intentos fallidos de login`,
            usuarioObjetivoId: user.id,
            camposModificados: ['intentos_fallidos', 'bloqueado_hasta'],
            detalles: {
              username: user.username,
              intentos_fallidos: estado.intentos_fallidos,
              duracion_minutos: config.security.lockoutDuration,
            },
            ip,
            userAgent,
          });
        }
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

      // Vencimiento de contraseña (3 meses): reutiliza el flujo de
      // "establecer contraseña" que ya usan los usuarios nuevos (sin pedir
      // la contraseña anterior, porque el login ya la validó)
      let debeCambiarPassword = user.debe_cambiar_password;
      if (user.password_expirada && !user.debe_cambiar_password) {
        await client.query(
          'UPDATE usuarios SET debe_cambiar_password = true WHERE id = $1',
          [user.id],
        );
        debeCambiarPassword = true;
        logger.info(`Contraseña vencida (>3 meses) para usuario ${username}, forzando cambio`);
      }

      // Abrir la sesión (sesión única: cierra las demás) y generar los tokens
      const tokens = await abrirSesionLogin(client, user, { ip, userAgent });

      logger.info(`Usuario ${username} inició sesión`);

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nombre_completo: user.nombre_completo,
          rol: user.rol,
          debe_cambiar_password: debeCambiarPassword,
          // Por qué debe cambiarla (ALTA | TEMPORAL | VENCIMIENTO): la pantalla de cambio lo explica
          motivo_cambio_password: debeCambiarPassword
            ? motivoCambioObligatorio({
              passwordExpirada: user.password_expirada,
              cambioPosteriorAlta: user.cambio_posterior_alta,
            })
            : null,
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
   * Refrescar access token (rotación del refresh token)
   *
   * Todo ocurre en UNA transacción: se inserta la sesión nueva y recién entonces se revoca la
   * vieja. Si algo falla (colisión, error de BD) se hace ROLLBACK y la sesión vieja sigue viva:
   * el usuario nunca queda sin sesión por un refresh fallido.
   * La sesión vieja se bloquea con FOR UPDATE: de dos refresh simultáneos con el mismo token,
   * uno gana; el otro espera, ve la sesión ya revocada y falla limpio ('Token inválido o revocado').
   */
  async refreshToken(refreshToken, meta = {}) {
    const { ip = null, userAgent = null } = meta;
    const client = await pool.getClient();
    let enTransaccion = false;

    try {
      // Verificar firma/expiración del refresh token (no toca la BD)
      verifyRefreshToken(refreshToken);

      await client.query('BEGIN');
      enTransaccion = true;

      // Verificar que el token exista en la BD, no esté revocado ni haya expirado
      const tokenResult = await client.query(
        `SELECT usuario_id, expires_at
         FROM usuarios_sesiones
         WHERE refresh_token = $1 AND revocado = false
         FOR UPDATE`,
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

      // Generar nuevos tokens. La rotación NO revoca las demás sesiones del usuario (solo
      // reemplaza la presentada); el access nuevo lleva el sid de la fila nueva.
      const nuevoRefresh = generarRefreshToken(user);

      // 1) Guardar la sesión nueva (conserva la trazabilidad de IP y navegador)
      const sesionId = await insertarSesion(client, {
        userId: user.id, refreshToken: nuevoRefresh, ip, userAgent,
      }, true);
      const tokens = {
        accessToken: generarAccessToken(user, sesionId),
        refreshToken: nuevoRefresh,
        expiresIn: config.jwt.expiresIn,
      };

      // 2) Solo entonces revocar la anterior
      await client.query(
        `UPDATE usuarios_sesiones
         SET revocado = true
         WHERE refresh_token = $1`,
        [refreshToken],
      );

      await client.query('COMMIT');
      enTransaccion = false;

      logger.info(`Token refrescado para usuario ${user.username}`);

      return tokens;
    } catch (error) {
      if (enTransaccion) {
        try { await client.query('ROLLBACK'); } catch (e) { /* conexión ya caída */ }
      }
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
         SET token_recuperacion = $1, token_recuperacion_expira = NOW() + INTERVAL '1 hour'
         WHERE id = $2`,
        [hashedToken, user.id],
      );

      logger.info(`Token de recuperación generado para ${email}`);

      // Enviar email con el token (fuera de la transacción)
      emailService.sendPasswordResetEmail({
        to: user.email,
        nombre: user.nombre_completo,
        token: resetToken,
      }).catch(err => logger.error('Error enviando email de recuperación:', err));

      return {
        message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña',
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
  async resetPassword(resetToken, newPassword, meta = {}) {
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Hash del token recibido
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      // Buscar usuario con el token válido
      const result = await client.query(
        `SELECT id, email, username, nombre_completo, password_hash
         FROM usuarios
         WHERE token_recuperacion = $1
         AND token_recuperacion_expira > NOW()
         AND activo = true`,
        [hashedToken],
      );

      if (result.rows.length === 0) {
        throw new Error('Token inválido o expirado');
      }

      const user = result.rows[0];

      // No permitir reutilizar una de las últimas 3 contraseñas
      if (await passwordFueUsadaAntes(client, user.id, newPassword, user.password_hash)) {
        throw new Error('No puedes reutilizar una de tus últimas 3 contraseñas');
      }

      // Hash de la nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Historial, hash nuevo, contador/bloqueo en cero, token consumido y
      // todas las sesiones revocadas (mismo comportamiento que los otros flujos)
      const { sesionesRevocadas } = await aplicarNuevaPassword(client, {
        userId: user.id,
        nuevoHash: hashedPassword,
        hashAnterior: user.password_hash,
        limpiarTokenRecuperacion: true,
      });

      await registrarEventoSeguridad(client, {
        codigo: EVENTO.RESET_PASSWORD_TOKEN,
        descripcion: `contraseña restablecida con token de recuperación (sesiones revocadas: ${sesionesRevocadas})`,
        usuarioObjetivoId: user.id,
        actor: { id: user.id, nombre: user.nombre_completo || user.username },
        camposModificados: ['password_hash', 'ultimo_cambio_password', 'intentos_fallidos', 'bloqueado_hasta'],
        detalles: { via: 'token_recuperacion', sesiones_revocadas: sesionesRevocadas },
        ip: meta.ip,
        userAgent: meta.userAgent,
        transaccional: true,
      });

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
   *
   * Sesiones: al cambiar la contraseña se revocan los refresh tokens de TODAS las
   * demás sesiones del usuario (otras estaciones/navegadores con la clave vieja).
   * La sesión desde la que se cambia solo se conserva si es identificable: el
   * access token (JWT) no lleva id de sesión, así que el cliente debe enviar su
   * propio refresh token en `ctx.refreshToken`. Si no lo envía, o no corresponde
   * a una sesión vigente de este usuario, se revocan todas y esa persona deberá
   * iniciar sesión de nuevo cuando venza su access token (24 h).
   * Nota: un access token ya emitido sigue siendo válido hasta que expire; la
   * revocación corta la capacidad de RENOVARLO, no invalida JWTs en vuelo.
   */
  async changePassword(userId, currentPassword, newPassword, ctx = {}) {
    const { refreshToken: refreshTokenActual = null, ip = null, userAgent = null } = ctx;
    const client = await pool.getClient();

    try {
      await client.query('BEGIN');

      // Obtener contraseña actual
      const result = await client.query(
        'SELECT username, nombre_completo, password_hash FROM usuarios WHERE id = $1',
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

      // No permitir reutilizar una de las últimas 3 contraseñas
      if (await passwordFueUsadaAntes(client, userId, newPassword, user.password_hash)) {
        throw new Error('No puedes reutilizar una de tus últimas 3 contraseñas');
      }

      // Hash de la nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Historial, hash nuevo, contador/bloqueo en cero y sesiones revocadas
      // (salvo la actual si es identificable) — igual que los otros flujos
      const { sesionesRevocadas, sesionConservada } = await aplicarNuevaPassword(client, {
        userId,
        nuevoHash: hashedPassword,
        hashAnterior: user.password_hash,
        conservarRefreshToken: refreshTokenActual,
      });

      await registrarEventoSeguridad(client, {
        codigo: EVENTO.CAMBIO_PASSWORD,
        descripcion: `el usuario cambió su contraseña (sesiones revocadas: ${sesionesRevocadas})`,
        usuarioObjetivoId: userId,
        actor: { id: userId, nombre: user.nombre_completo || user.username },
        camposModificados: ['password_hash', 'ultimo_cambio_password', 'intentos_fallidos', 'bloqueado_hasta'],
        detalles: { sesiones_revocadas: sesionesRevocadas, sesion_actual_conservada: sesionConservada },
        ip,
        userAgent,
        transaccional: true,
      });

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
   * Establecer contraseña inicial (usuario recién verificado, sin requerir contraseña actual)
   */
  async setInitialPassword(userId, newPassword, ctx = {}) {
    const client = await pool.getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT id, username, nombre_completo, debe_cambiar_password, password_hash,
                (ultimo_cambio_password < NOW() - INTERVAL '3 months') AS password_expirada,
                (ultimo_cambio_password > fecha_creacion + INTERVAL '1 second') AS cambio_posterior_alta
         FROM usuarios WHERE id = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      if (!result.rows[0].debe_cambiar_password) {
        throw new Error('Esta acción no está permitida para este usuario');
      }

      const currentHash = result.rows[0].password_hash;
      const motivo = motivoCambioObligatorio({
        passwordExpirada: result.rows[0].password_expirada,
        cambioPosteriorAlta: result.rows[0].cambio_posterior_alta,
      });

      // No permitir reutilizar una de las últimas 3 contraseñas
      if (await passwordFueUsadaAntes(client, userId, newPassword, currentHash)) {
        throw new Error('No puedes reutilizar una de tus últimas 3 contraseñas');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Guardar la contraseña que se reemplaza en el historial
      await guardarPasswordEnHistorial(client, userId, currentHash);

      // NO revoca sesiones: la persona sigue en su sesión tras el cambio obligatorio
      await client.query(
        `UPDATE usuarios
         SET password_hash = $1,
             debe_cambiar_password = false,
             ultimo_cambio_password = NOW(),
             fecha_actualizacion = NOW()
         WHERE id = $2`,
        [hashedPassword, userId],
      );

      // El evento distingue alta, clave temporal de un admin y vencimiento (sin secretos)
      await registrarEventoSeguridad(client, {
        codigo: EVENTO[`CAMBIO_OBLIGATORIO_${motivo}`],
        descripcion: `el usuario completó el cambio de contraseña obligatorio (${motivo.toLowerCase()})`,
        usuarioObjetivoId: userId,
        actor: { id: userId, nombre: result.rows[0].nombre_completo || result.rows[0].username },
        camposModificados: ['password_hash', 'ultimo_cambio_password', 'debe_cambiar_password'],
        detalles: { motivo },
        ip: ctx.ip || null,
        userAgent: ctx.userAgent || null,
        transaccional: true,
      });

      await client.query('COMMIT');
      logger.info(`Contraseña inicial establecida para usuario ID ${userId}`);
      return { message: 'Contraseña establecida exitosamente' };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error al establecer contraseña inicial:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Solicitar verificación de email para usuario existente sin verificar
   */
  async requestEmailVerification(username, email) {
    const client = await pool.getClient();

    try {
      // Buscar usuario por username
      const result = await client.query(
        `SELECT id, username, nombre_completo, email_verificado
         FROM usuarios
         WHERE username = $1`,
        [username],
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      const user = result.rows[0];

      if (user.email_verificado) {
        throw new Error('Este usuario ya tiene el correo verificado');
      }

      // Verificar que el email no esté en uso por otro usuario
      const emailExists = await client.query(
        'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
        [email, user.id],
      );

      if (emailExists.rows.length > 0) {
        throw new Error('Ese correo ya está registrado en otro usuario');
      }

      // Generar token de verificación
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      // Actualizar email y token en DB
      await client.query(
        `UPDATE usuarios
         SET email = $1,
             token_verificacion = $2,
             email_verificado = false,
             fecha_actualizacion = NOW()
         WHERE id = $3`,
        [email, hashedToken, user.id],
      );

      // Enviar email de verificación
      await emailService.sendVerificationEmail({
        to: email,
        nombre: user.nombre_completo,
        token: rawToken,
      });

      logger.info(`Verificación de email solicitada para ${username} → ${email}`);

      return { message: 'Correo de verificación enviado' };
    } catch (error) {
      logger.error('Error en requestEmailVerification:', error);
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
