-- Migration 036: corregir índice único masa por tipo+fecha
-- Problema: es_adicional y es_subdivision pueden ser NULL (no satisfacen = false)
-- Solución: usar IS NOT TRUE en lugar de = false, y fijar NOT NULL con default

-- 1. Garantizar NOT NULL con default en las columnas booleanas
ALTER TABLE masas_produccion
  ALTER COLUMN es_subdivision SET NOT NULL,
  ALTER COLUMN es_subdivision SET DEFAULT false,
  ALTER COLUMN es_adicional SET NOT NULL,
  ALTER COLUMN es_adicional SET DEFAULT false;

-- 2. Normalizar NULLs existentes
UPDATE masas_produccion SET es_subdivision = false WHERE es_subdivision IS NULL;
UPDATE masas_produccion SET es_adicional = false WHERE es_adicional IS NULL;

-- 3. Recrear el índice con condición robusta
DROP INDEX IF EXISTS uq_masa_tipo_fecha;

CREATE UNIQUE INDEX uq_masa_tipo_fecha
  ON masas_produccion (DATE(fecha_produccion), tipo_masa)
  WHERE es_subdivision IS NOT TRUE
    AND es_adicional IS NOT TRUE
    AND masa_padre_id IS NULL
    AND estado <> 'CANCELADA';
