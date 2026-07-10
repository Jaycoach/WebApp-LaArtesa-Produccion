-- =====================================================
-- Migración 045: Incluir es_repeticion en índice único
-- Fecha: 2026-07-10
-- Motivo: uq_masa_tipo_fecha solo distinguía por
--   fecha_produccion + tipo_masa, permitiendo que una
--   masa normal y una de repetición del mismo tipo/fecha
--   colisionaran como si fueran la misma. Ahora coexisten
--   como registros independientes, protegidas cada una
--   por su propia categoría.
-- =====================================================

BEGIN;

DROP INDEX IF EXISTS uq_masa_tipo_fecha;

CREATE UNIQUE INDEX uq_masa_tipo_fecha
  ON public.masas_produccion (fecha_produccion, tipo_masa, es_repeticion)
  WHERE (
    es_subdivision IS NOT TRUE
    AND es_adicional IS NOT TRUE
    AND masa_padre_id IS NULL
    AND estado::text = ANY (ARRAY['PLANIFICACION','PENDIENTE','APROBADA']::text[])
  );

DO $$
BEGIN
  RAISE NOTICE '✓ Migración 045 aplicada: uq_masa_tipo_fecha ahora incluye es_repeticion';
END $$;

COMMIT;
