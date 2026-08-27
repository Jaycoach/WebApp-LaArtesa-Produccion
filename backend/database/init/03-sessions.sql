-- Script para crear tabla de sesiones de usuarios
-- Este script se ejecuta después de init.sql y seed.sql

-- Tabla de sesiones de usuarios (para manejo de refresh tokens)
CREATE TABLE IF NOT EXISTS usuarios_sesiones (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    revocado BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- Índices para optimización
CREATE INDEX IF NOT EXISTS idx_usuarios_sesiones_usuario ON usuarios_sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_sesiones_token ON usuarios_sesiones(refresh_token);
CREATE INDEX IF NOT EXISTS idx_usuarios_sesiones_expires ON usuarios_sesiones(expires_at);
CREATE INDEX IF NOT EXISTS idx_usuarios_sesiones_revocado ON usuarios_sesiones(revocado);

-- Función para limpiar sesiones expiradas
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    DELETE FROM usuarios_sesiones
    WHERE expires_at < NOW() OR revocado = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Comentarios
COMMENT ON TABLE usuarios_sesiones IS 'Sesiones activas de usuarios con refresh tokens';
COMMENT ON COLUMN usuarios_sesiones.refresh_token IS 'Token de refresco JWT';
COMMENT ON COLUMN usuarios_sesiones.revocado IS 'Indica si el token ha sido revocado';

-- Trigger para auditoría de sesiones
--
-- NOTA (2026-08-27, ver migración 071): las columnas de INSERT y el valor
-- de `accion` de esta función ya reflejan el fix de la migración 071
-- (columna `detalles` no existe en `auditoria` -> se usa `cambios` +
-- `registro_id`; `accion = 'REVOKE_SESSION'` no está permitido por
-- auditoria.check_accion -> se usa 'UPDATE', con el detalle semántico
-- dentro de `cambios`). Una base de datos NUEVA que corra este archivo
-- de cero ya nace con la versión corregida; una base EXISTENTE necesita
-- la migración 071 para llegar al mismo estado.
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

CREATE TRIGGER session_audit_trigger
    AFTER UPDATE OR DELETE ON usuarios_sesiones
    FOR EACH ROW EXECUTE FUNCTION audit_session_changes();
