/**
 * Piezas compartidas de seguridad de cuentas: historial de contraseñas y
 * aplicación consistente de una contraseña nueva.
 *
 * Todas las funciones reciben el `client` de una transacción ya abierta
 * (BEGIN/COMMIT los maneja quien llama), para que el cambio sea atómico.
 */

const bcrypt = require('bcrypt');

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

module.exports = {
  passwordFueUsadaAntes,
  guardarPasswordEnHistorial,
  revocarSesionesUsuario,
  aplicarNuevaPassword,
};
