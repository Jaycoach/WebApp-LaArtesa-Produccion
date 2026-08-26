-- ============================================================================
-- MIGRACIÓN 069: usuarios_historial_passwords
-- Fecha: 2026-08-26
-- Motivo: impedir que un usuario reutilice una de sus últimas 3 contraseñas
--         (la actual en usuarios.password_hash + las 2 anteriores aquí) al
--         cambiarla, en cualquiera de los 3 flujos de cambio: changePassword
--         (autoservicio), resetPassword (recuperación por email),
--         setInitialPassword (usuarios nuevos / vencimiento cada 3 meses).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS usuarios_historial_passwords (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    password_hash   VARCHAR(255) NOT NULL,
    fecha_creacion  TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historial_passwords_usuario
    ON usuarios_historial_passwords(usuario_id, fecha_creacion DESC);

COMMENT ON TABLE usuarios_historial_passwords IS
  'Historial de las últimas 2 contraseñas reemplazadas por usuario (más la actual en usuarios.password_hash, dan la ventana de las últimas 3). Podado a 2 filas por usuario_id en cada cambio exitoso.';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir)
-- ============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS usuarios_historial_passwords;
-- COMMIT;
