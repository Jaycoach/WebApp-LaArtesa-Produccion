-- ============================================================
-- Migración 009: Fix auditoría CASCADE y función auditoria DELETE
-- Fecha: 2026-02-25
-- Descripción:
--   1. Cambia FK auditoria_cambios.masa_id a ON DELETE CASCADE
--      para que al eliminar una masa (forzar=true) no falle la auditoría
--   2. Corrige función auditoria_automatica() en evento DELETE:
--      usa masa_id_val := NULL para evitar violación de FK
-- Aplicado directamente en RDS el 2026-02-25 (este archivo lo documenta)
-- ============================================================

-- 1. Cambiar FK a ON DELETE CASCADE
ALTER TABLE auditoria_cambios
  DROP CONSTRAINT IF EXISTS auditoria_cambios_masa_id_fkey;

ALTER TABLE auditoria_cambios
  ADD CONSTRAINT auditoria_cambios_masa_id_fkey
  FOREIGN KEY (masa_id)
  REFERENCES masas_produccion(id)
  ON DELETE CASCADE;

-- 2. Corregir función auditoria_automatica() para evento DELETE
CREATE OR REPLACE FUNCTION auditoria_automatica()
RETURNS TRIGGER AS $$
DECLARE
  masa_id_val INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    masa_id_val := NULL;
  ELSIF TG_TABLE_NAME = 'masas_produccion' THEN
    masa_id_val := NEW.id;
  ELSE
    masa_id_val := NEW.masa_id;
  END IF;

  INSERT INTO auditoria_cambios (
    tabla_afectada,
    operacion,
    masa_id,
    datos_anteriores,
    datos_nuevos
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    masa_id_val,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
