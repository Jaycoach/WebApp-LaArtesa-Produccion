-- =====================================================
-- Migración 071: Fix audit_session_changes() — columna inexistente
--   y valor de accion no permitido por check_accion
-- Fecha: 2026-08-27
--
-- Bug (evidencia: log de producción 2026-08-27T17:07:22Z, 6 ocurrencias):
--   ERROR: column "detalles" of relation "auditoria" does not exist
--   El trigger session_audit_trigger (backend/database/init/03-sessions.sql)
--   ejecuta audit_session_changes() en cada UPDATE/DELETE sobre
--   usuarios_sesiones. La función insertaba en una columna `detalles` que
--   nunca existió en `auditoria` (columnas reales: id, uuid, tabla,
--   registro_id NOT NULL, accion, usuario_id, usuario_nombre,
--   datos_anteriores, datos_nuevos, cambios jsonb, ip_address, user_agent,
--   fecha).
--
--   Esto rompe el INSERT del trigger SIEMPRE que una sesión se revoca o se
--   borra — no solo en reset-password (donde se detectó primero):
--
--   1. auth.service.js:resetPassword()      — UPDATE dentro de BEGIN/COMMIT.
--      El fallo del trigger hace ROLLBACK de TODA la transacción, incluido
--      el cambio de password_hash: el usuario recibe error y la contraseña
--      NO queda cambiada.
--   2. user.service.js:deleteUser()         — mismo patrón (desactivación
--      de usuario se revierte).
--   3. user.service.js:deactivateUser()     — mismo patrón.
--   4. user.service.js:resetUserPassword()  — mismo patrón (reset de
--      password por admin se revierte).
--   5. auth.service.js:refreshToken()       — UPDATE SIN transacción
--      explícita (autocommit por statement). El propio UPDATE de
--      revocación falla y lanza error: /api/auth/refresh está roto para
--      CUALQUIER intento (no solo un caso límite).
--   6. auth.service.js:logout()             — igual que refreshToken():
--      UPDATE sin transacción explícita, /api/auth/logout roto para
--      cualquier intento.
--   7. cleanup_expired_sessions() (rama DELETE del trigger) — función SQL
--      definida en 03-sessions.sql pero sin ningún caller en el código
--      actual (sin cron ni invocación manual encontrada) — bug latente,
--      no activo hoy.
--
--   Segundo bug independiente, descubierto al reproducir en staging antes
--   de escribir el fix (INSERT de prueba directo): el branch UPDATE
--   insertaba accion = 'REVOKE_SESSION', valor que NO está en la lista
--   permitida por auditoria.check_accion (INSERT, UPDATE, DELETE, LOGIN,
--   LOGOUT, ACCESS). Corregir solo la columna `detalles` -> `cambios` NO
--   habría sido suficiente: el INSERT seguiría fallando por la constraint.
--
-- Fix (opción elegida: corregir el trigger, no eliminarlo — ver reporte
--   de la tarea para la justificación: no hay otro mecanismo en la app
--   que audite revocación de sesiones en la tabla `auditoria`; eliminarlo
--   perdería ese rastro sin reemplazo, y el fix es de 2 líneas):
--   - `detalles` -> `cambios` (jsonb_build_object en vez de json_build_object,
--     coherente con el tipo de columna).
--   - Se agrega `registro_id` (NOT NULL) = id de la fila de
--     usuarios_sesiones afectada (mismo criterio que auditoria_automatica()).
--   - `accion` en el branch UPDATE pasa de 'REVOKE_SESSION' (no permitido)
--     a 'UPDATE' (permitido) — el detalle semántico de que fue una
--     revocación de sesión se conserva dentro de `cambios`
--     (evento: 'REVOKE_SESSION').
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION audit_session_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, cambios)
        VALUES (OLD.usuario_id, 'DELETE', 'usuarios_sesiones', OLD.id,
                jsonb_build_object('session_id', OLD.id, 'revocado', OLD.revocado));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND NEW.revocado = TRUE AND OLD.revocado = FALSE THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, cambios)
        VALUES (NEW.usuario_id, 'UPDATE', 'usuarios_sesiones', NEW.id,
                jsonb_build_object('evento', 'REVOKE_SESSION', 'session_id', NEW.id));
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verificación
DO $$
BEGIN
  RAISE NOTICE '✓ Migración 071 aplicada: audit_session_changes() usa columnas reales de auditoria (cambios, registro_id) y accion permitido por check_accion (UPDATE en vez de REVOKE_SESSION)';
END $$;

COMMIT;

-- =====================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir)
-- =====================================================
-- Restaura el comportamiento roto anterior a esta migración — NO
-- recomendado, solo para revertir en caso de necesidad puntual.
-- BEGIN;
-- CREATE OR REPLACE FUNCTION audit_session_changes()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     IF TG_OP = 'DELETE' THEN
--         INSERT INTO auditoria (usuario_id, accion, tabla, detalles)
--         VALUES (OLD.usuario_id, 'DELETE', 'usuarios_sesiones',
--                 json_build_object('session_id', OLD.id, 'revocado', OLD.revocado));
--         RETURN OLD;
--     ELSIF TG_OP = 'UPDATE' AND NEW.revocado = TRUE AND OLD.revocado = FALSE THEN
--         INSERT INTO auditoria (usuario_id, accion, tabla, detalles)
--         VALUES (NEW.usuario_id, 'REVOKE_SESSION', 'usuarios_sesiones',
--                 json_build_object('session_id', NEW.id));
--         RETURN NEW;
--     END IF;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- COMMIT;
