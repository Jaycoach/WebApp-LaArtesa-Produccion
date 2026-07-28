-- ============================================================================
-- MIGRACIÓN 047: Peso Masa Dividida (U_JZ_PesMasDiv)
-- Fecha: 2026-07-28
-- Motivo: Nuevo UDF U_JZ_PesMasDiv creado en SAP — peso UNITARIO por producto
--         a usar en División, reemplaza a gramaje_unitario para ese propósito
--         (gramaje_unitario se conserva, es dato BOM ya usado en Formado/costeo).
--         Mismo patrón que migración 046 (tamanio/forma).
-- ============================================================================

BEGIN;

ALTER TABLE sap_articulos
  ADD COLUMN IF NOT EXISTS peso_masa_dividida NUMERIC(10,2);

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS peso_masa_dividida NUMERIC(10,2);

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('sap_articulos','productos_por_masa') AND column_name = 'peso_masa_dividida'
ORDER BY table_name;

COMMIT;
