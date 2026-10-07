/**
 * Piezas compartidas de seguridad de cuentas: historial de contraseñas y
 * aplicación consistente de una contraseña nueva.
 *
 * Todas las funciones reciben el `client` de una transacción ya abierta
 * (BEGIN/COMMIT los maneja quien llama), para que el cambio sea atómico.
 */

const bcrypt = require('bcrypt');
const logger = require('../utils/logger');

/**
 * Verifica si newPassword coincide con la contraseña actual o con alguna
 * de las últimas 2 guardadas en el historial (ventana de "últimas 3").
 */
async function passwordFueUsadaAntes(client, userId, newPassword, currentHash) {
  if (await bcrypt.compare(newPassword, currentHash)) return true;
  const { rows } = await client.query(
    `SELECT password_hash FROM usuarios_historial_passwords
     WHERE usuario_id = $1
     ORDER BY fecha_creacion DESC
     LIMIT 2`,
    [userId],
  );
  for (const row of rows) {
    if (await bcrypt.compare(newPassword, row.password_hash)) return true;
  }
  return false;
}

/**
 * Guarda el hash que se está reemplazando en el historial y poda a las
 * 2 filas más recientes por usuario.
 */
async function guardarPasswordEnHistorial(client, userId, oldHash) {
  await client.query(
    `INSERT INTO usuarios_historial_passwords (usuario_id, password_hash)
     VALUES ($1, $2)`,
    [userId, oldHash],
  );
  await client.query(
    `DELETE FROM usuarios_historial_passwords
     WHERE usuario_id = $1
     AND id NOT IN (
       SELECT id FROM usuarios_historial_passwords
       WHERE usuario_id = $1
       ORDER BY fecha_creacion DESC
       LIMIT 2
     )`,
    [userId],
  );
}

/**
 * Revoca las sesiones (refresh tokens) vigentes de un usuario.
 * Si `conservarRefreshToken` es el refresh token de una sesión vigente DE ESE
 * usuario, esa sesión se conserva; si no coincide con ninguna (no existe, ya
 * estaba revocada o es de otro usuario) simplemente no excluye nada y se
 * revocan todas. Devuelve cuántas sesiones se revocaron.
 */
async function revocarSesionesUsuario(client, userId, conservarRefreshToken = null) {
  const conservar = typeof conservarRefreshToken === 'string' && conservarRefreshToken.length > 0
    ? conservarRefreshToken
    : null;
  const result = conservar
    ? await client.query(
      `UPDATE usuarios_sesiones SET revocado = true
       WHERE usuario_id = $1 AND revocado = false AND refresh_token <> $2`,
      [userId, conservar],
    )
    : await client.query(
      `UPDATE usuarios_sesiones SET revocado = true
       WHERE usuario_id = $1 AND revocado = false`,
      [userId],
    );
  return result.rowCount || 0;
}

/**
 * Comportamiento ÚNICO al cambiar la contraseña de una cuenta (cambio propio,
 * reset por token y reset por administrador):
 *   - guarda el hash anterior en usuarios_historial_passwords,
 *   - escribe el hash nuevo y actualiza ultimo_cambio_password y
 *     fecha_actualizacion,
 *   - reinicia intentos_fallidos = 0 y bloqueado_hasta = NULL (la persona
 *     acaba de demostrar control de la cuenta; arrastrar un bloqueo o intentos
 *     contra la contraseña vieja no tiene sentido),
 *   - revoca las sesiones (ver revocarSesionesUsuario).
 *
 * Opciones:
 *   limpiarTokenRecuperacion  — true en el reset por token (lo consume).
 *   conservarRefreshToken     — sesión a conservar (solo cambio propio).
 *
 * Devuelve { sesionesRevocadas }.
 */
async function aplicarNuevaPassword(client, {
  userId, nuevoHash, hashAnterior, limpiarTokenRecuperacion = false, conservarRefreshToken = null,
}) {
  await guardarPasswordEnHistorial(client, userId, hashAnterior);

  await client.query(
    `UPDATE usuarios
     SET password_hash = $1,
         ultimo_cambio_password = NOW(),
         fecha_actualizacion = NOW(),
         intentos_fallidos = 0,
         bloqueado_hasta = NULL${limpiarTokenRecuperacion ? `,
         token_recuperacion = NULL,
         token_recuperacion_expira = NULL` : ''}
     WHERE id = $2`,
    [nuevoHash, userId],
  );

  const sesionesRevocadas = await revocarSesionesUsuario(client, userId, conservarRefreshToken);
  return { sesionesRevocadas };
}

// ---------------------------------------------------------------------------
// Auditoría de eventos de seguridad (auditoria_cambios)
// ---------------------------------------------------------------------------
// Se insertan desde la capa de servicio y NO con un trigger sobre `usuarios`:
// un trigger genérico (auditoria_automatica) volcaría la fila completa en
// datos_anteriores/datos_nuevos, incluido password_hash y los tokens de
// recuperación/verificación. Aquí solo se registra el hecho, los campos
// modificados y el motivo.

const EVENTO = {
  CAMBIO_PASSWORD: 'CAMBIO_PASSWORD',
  RESET_PASSWORD_TOKEN: 'RESET_PASSWORD_TOKEN',
  RESET_PASSWORD_ADMIN: 'RESET_PASSWORD_ADMIN',
  BLOQUEO_CUENTA_INTENTOS: 'BLOQUEO_CUENTA_INTENTOS',
  DESBLOQUEO_MANUAL: 'DESBLOQUEO_MANUAL',
};

// Claves que jamás deben llegar a un jsonb de auditoría (defensa en profundidad:
// los llamadores ya arman `detalles` a mano, esto atrapa un descuido futuro).
const CLAVE_SECRETA = /(pass|hash|token|secret|clave|credencial)/i;

function limpiarDetalles(detalles) {
  const limpio = {};
  Object.entries(detalles || {}).forEach(([clave, valor]) => {
    if (CLAVE_SECRETA.test(clave)) {
      logger.warn(`registrarEventoSeguridad: se descartó la clave "${clave}" de los detalles (parece un secreto)`);
      return;
    }
    limpio[clave] = valor;
  });
  return limpio;
}

/**
 * Registra un evento de seguridad sobre una cuenta en auditoria_cambios.
 *
 * Es BEST-EFFORT: si el INSERT falla se registra el error y se sigue — un fallo
 * de auditoría nunca debe revertir ni bloquear el cambio de seguridad (así fue el
 * incidente de la migración 071, donde un trigger de auditoría roto revertía los
 * resets de contraseña). Con `transaccional: true` el INSERT va dentro de un
 * SAVEPOINT para que su error no aborte la transacción que lo rodea.
 *
 * @param {object} db  client (dentro de transacción) o pool/client en autocommit
 * @param {object} evento
 * @param {string} evento.codigo            uno de EVENTO.*
 * @param {string} evento.descripcion       texto corto, sin secretos
 * @param {number} evento.usuarioObjetivoId cuenta afectada (registro_id)
 * @param {object} [evento.actor]           { id, nombre } de quien ejecuta la acción;
 *                                          sin actor = el sistema (ej. bloqueo por intentos)
 * @param {string[]} [evento.camposModificados]
 * @param {object} [evento.detalles]        datos NO sensibles (van a datos_nuevos)
 * @param {string} [evento.ip]
 * @param {string} [evento.userAgent]
 * @param {boolean} [evento.transaccional]
 */
async function registrarEventoSeguridad(db, {
  codigo, descripcion, usuarioObjetivoId, actor = null, camposModificados = [],
  detalles = {}, ip = null, userAgent = null, transaccional = false,
}) {
  const savepoint = 'auditoria_seguridad';
  try {
    if (transaccional) await db.query(`SAVEPOINT ${savepoint}`);
    await db.query(
      `INSERT INTO auditoria_cambios
         (tabla, registro_id, operacion, datos_nuevos, campos_modificados,
          usuario_id, usuario_nombre, ip_address, user_agent, motivo)
       VALUES ('usuarios', $1, 'UPDATE', $2::jsonb, $3::text[], $4, $5, $6, $7, $8)`,
      [
        Number(usuarioObjetivoId),
        JSON.stringify({ evento: codigo, ...limpiarDetalles(detalles) }),
        camposModificados,
        actor && actor.id ? Number(actor.id) : null,
        actor ? String(actor.nombre || '').slice(0, 200) || null : 'sistema',
        ip,
        userAgent,
        `${codigo}: ${descripcion}`,
      ],
    );
    if (transaccional) await db.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    if (transaccional) {
      try { await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch (e) { /* la transacción ya estaba abortada */ }
    }
    logger.error(`No se pudo registrar el evento de seguridad ${codigo} (usuario ${usuarioObjetivoId}): ${error.message}`);
  }
}

module.exports = {
  EVENTO,
  passwordFueUsadaAntes,
  guardarPasswordEnHistorial,
  revocarSesionesUsuario,
  aplicarNuevaPassword,
  registrarEventoSeguridad,
};
