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
CREATE OR REPLACE FUNCTION audit_session_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, detalles)
        VALUES (OLD.usuario_id, 'DELETE', 'usuarios_sesiones', 
                json_build_object('session_id', OLD.id, 'revocado', OLD.revocado));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND NEW.revocado = TRUE AND OLD.revocado = FALSE THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, detalles)
        VALUES (NEW.usuario_id, 'REVOKE_SESSION', 'usuarios_sesiones', 
                json_build_object('session_id', NEW.id));
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_audit_trigger
    AFTER UPDATE OR DELETE ON usuarios_sesiones
    FOR EACH ROW EXECUTE FUNCTION audit_session_changes();

EOF
cat /home/claude/artesa-backend/database/init/03-sessions.sql
Output

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
CREATE OR REPLACE FUNCTION audit_session_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, detalles)
        VALUES (OLD.usuario_id, 'DELETE', 'usuarios_sesiones', 
                json_build_object('session_id', OLD.id, 'revocado', OLD.revocado));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND NEW.revocado = TRUE AND OLD.revocado = FALSE THEN
        INSERT INTO auditoria (usuario_id, accion, tabla, detalles)
        VALUES (NEW.usuario_id, 'REVOKE_SESSION', 'usuarios_sesiones', 
                json_build_object('session_id', NEW.id));
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_audit_trigger
    AFTER UPDATE OR DELETE ON usuarios_sesiones
    FOR EACH ROW EXECUTE FUNCTION audit_session_changes();