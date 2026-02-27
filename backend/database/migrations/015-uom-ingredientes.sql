-- ============================================================================
-- MIGRACIÓN 015: Unidades de medida e ingredientes de empaque
-- Fecha: 2026-02-26
-- Motivo: Los componentes del BOM tienen distintas UoM (Kg, L, Und, R).
--         Solo los componentes con peso deben sumarse al límite de amasadora.
--         Los materiales de empaque (grupo SAP 182) se separan a su propia tabla.
-- ============================================================================

BEGIN;

-- 1. Agregar columnas a sap_bom_componentes
ALTER TABLE sap_bom_componentes
  ADD COLUMN IF NOT EXISTS uom           VARCHAR(20),   -- Kg, L, Und, R, etc.
  ADD COLUMN IF NOT EXISTS grupo_sap     INTEGER,       -- ItemsGroupCode de SAP
  ADD COLUMN IF NOT EXISTS es_empaque    BOOLEAN DEFAULT FALSE; -- TRUE si grupo 182

-- 2. Agregar columnas a ingredientes_masa
ALTER TABLE ingredientes_masa
  ADD COLUMN IF NOT EXISTS uom           VARCHAR(20),   -- Kg, L, Und, R, etc.
  ADD COLUMN IF NOT EXISTS es_empaque    BOOLEAN DEFAULT FALSE;

-- 3. Crear tabla empaque_por_masa
--    Almacena los materiales de empaque separados de los ingredientes de masa
CREATE TABLE IF NOT EXISTS empaque_por_masa (
  id                  SERIAL PRIMARY KEY,
  uuid                UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  masa_id             INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
  ingrediente_sap_code VARCHAR(50),
  ingrediente_nombre  VARCHAR(200) NOT NULL,
  uom                 VARCHAR(20),          -- Und, R, etc.
  cantidad            NUMERIC(14,4) NOT NULL DEFAULT 0,
  orden_visualizacion INTEGER DEFAULT 0,
  disponible          BOOLEAN DEFAULT FALSE,
  verificado          BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_empaque_masa ON empaque_por_masa(masa_id);

-- 4. Constraint único para evitar duplicados en empaque_por_masa
ALTER TABLE empaque_por_masa
  DROP CONSTRAINT IF EXISTS uq_empaque_masa_codigo;
ALTER TABLE empaque_por_masa
  ADD CONSTRAINT uq_empaque_masa_codigo
  UNIQUE (masa_id, ingrediente_sap_code);

-- 5. Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sap_bom_componentes'
  AND column_name IN ('uom', 'grupo_sap', 'es_empaque')
ORDER BY column_name;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ingredientes_masa'
  AND column_name IN ('uom', 'es_empaque')
ORDER BY column_name;

SELECT table_name FROM information_schema.tables
WHERE table_name = 'empaque_por_masa';

COMMIT;
