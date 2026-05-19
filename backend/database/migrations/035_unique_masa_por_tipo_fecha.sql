-- Migration 035: UNIQUE parcial por (fecha_produccion::date, tipo_masa)
-- Previene duplicados de masas del mismo tipo en la misma fecha a nivel de BD
-- Solo aplica a masas principales (no subdivisiones, no adicionales)

CREATE UNIQUE INDEX IF NOT EXISTS uq_masa_tipo_fecha
  ON masas_produccion (DATE(fecha_produccion), tipo_masa)
  WHERE es_subdivision = false
    AND es_adicional = false
    AND masa_padre_id IS NULL
    AND estado NOT IN ('CANCELADA');
