-- =============================================
-- MIGRACIÓN 013: Subdivisión automática de masas
-- por límite de capacidad de amasadoras
-- Fecha: 2026-02-26
-- =============================================

-- 1. Columnas de subdivisión en masas_produccion
ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS masa_padre_id   INTEGER REFERENCES masas_produccion(id),
  ADD COLUMN IF NOT EXISTS es_subdivision  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subdivision_letra VARCHAR(1),
  ADD COLUMN IF NOT EXISTS fue_subdividida BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_masas_padre ON masas_produccion(masa_padre_id);

COMMENT ON COLUMN masas_produccion.masa_padre_id    IS 'ID de la masa original que fue subdividida. NULL si es original.';
COMMENT ON COLUMN masas_produccion.es_subdivision   IS 'TRUE si esta masa es una subdivisión automática (tanda A o B)';
COMMENT ON COLUMN masas_produccion.subdivision_letra IS 'A o B — indica qué tanda es dentro de la subdivisión';
COMMENT ON COLUMN masas_produccion.fue_subdividida  IS 'TRUE si esta masa original fue dividida automáticamente en tandas';

-- 2. Límites de amasado en configuracion_sistema
INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion)
VALUES
  ('limite_kg_toscano', '130', 'NUMBER', 'PRODUCCION', 'Límite máximo en kg para amasado de masa tipo TOSCANO'),
  ('limite_kg_default',  '90', 'NUMBER', 'PRODUCCION', 'Límite máximo en kg para amasado del resto de tipos de masa')
ON CONFLICT (clave) DO NOTHING;

-- 3. Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'masas_produccion'
  AND column_name IN ('masa_padre_id','es_subdivision','subdivision_letra','fue_subdividida')
ORDER BY column_name;
