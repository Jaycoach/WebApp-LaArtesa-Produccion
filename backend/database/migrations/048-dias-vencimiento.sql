-- ============================================================================
-- MIGRACIÓN 048: Días Vencimiento (U_JZ_DiasExp)
-- Fecha: 2026-07-28
-- Motivo: Nuevo UDF U_JZ_DiasExp creado en SAP — días de vida útil del producto
--         desde aprobación de masa, usado para sugerir fecha de vencimiento en
--         Empaque. Mismo patrón que 046 (tamanio/forma) y 047 (peso_masa_dividida).
-- ============================================================================

BEGIN;

ALTER TABLE sap_articulos
  ADD COLUMN IF NOT EXISTS dias_vencimiento INTEGER;

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS dias_vencimiento INTEGER;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('sap_articulos','productos_por_masa') AND column_name = 'dias_vencimiento'
ORDER BY table_name;

COMMIT;
