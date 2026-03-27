-- =====================================================
-- 030-horneado-unidades-por-producto.sql
-- Soporte para registrar unidades terminadas por producto en horneado
-- y tabla de auditoría de modificaciones manuales
-- =====================================================

-- 1. Columna JSONB en registros_horneado para desglose por producto
ALTER TABLE registros_horneado
  ADD COLUMN IF NOT EXISTS unidades_terminadas_por_producto JSONB;

-- 2. Tabla de auditoría para ediciones retroactivas (campo a campo)
CREATE TABLE IF NOT EXISTS auditoria_modificaciones (
    id SERIAL PRIMARY KEY,
    tabla VARCHAR(100) NOT NULL,
    registro_id INTEGER NOT NULL,
    campo VARCHAR(200) NOT NULL,
    valor_anterior TEXT,
    valor_nuevo TEXT,
    motivo TEXT NOT NULL,
    usuario_id INTEGER REFERENCES usuarios(id),
    usuario_nombre VARCHAR(200),
    usuario_rol VARCHAR(50),
    masa_id INTEGER REFERENCES masas_produccion(id),
    fecha_cambio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_mod_masa_id ON auditoria_modificaciones(masa_id);
CREATE INDEX IF NOT EXISTS idx_audit_mod_tabla ON auditoria_modificaciones(tabla, registro_id);

COMMENT ON TABLE auditoria_modificaciones IS 'Auditoría campo a campo de modificaciones retroactivas';
