-- =============================================
-- MIGRACIÓN 052: Cantidad abierta por línea de OV + tipo de acción de cancelación
-- Fecha: 2026-08-09
-- Descripción: Permite distinguir, al cancelar una masa subdividida, si la
--   línea de OV debe cerrarse por completo (nadie más la usa) o solo
--   reducirse en la cantidad de la tanda cancelada (otras tandas activas
--   siguen usándola). cantidad_abierta_sap se carga desde RemainingOpenQuantity
--   de SAP en cada sincronización y se descuenta localmente con cada
--   cancelación parcial.
-- =============================================

BEGIN;

ALTER TABLE productos_por_masa_ov
  ADD COLUMN IF NOT EXISTS cantidad_abierta_sap INTEGER NULL;

COMMENT ON COLUMN productos_por_masa_ov.cantidad_abierta_sap IS
  'RemainingOpenQuantity de la línea en SAP al momento de la última sincronización. '
  'Se descuenta localmente en cada cancelación parcial (tanda subdividida). '
  'No se re-consulta en vivo contra SAP en cada cancelación — se confía en '
  'este valor local, refrescado en el próximo sync.';

UPDATE productos_por_masa_ov
SET cantidad_abierta_sap = unidades_pedidas
WHERE cantidad_abierta_sap IS NULL;

ALTER TABLE cancelaciones_ov_sap
  ADD COLUMN IF NOT EXISTS tipo_accion VARCHAR(20) NOT NULL DEFAULT 'CIERRE'
    CHECK (tipo_accion IN ('CIERRE', 'REDUCCION')),
  ADD COLUMN IF NOT EXISTS cantidad_reducida INTEGER NULL,
  ADD COLUMN IF NOT EXISTS cantidad_restante_sap INTEGER NULL;

COMMENT ON COLUMN cancelaciones_ov_sap.tipo_accion IS
  'CIERRE: línea cerrada completa en SAP (bost_Close), nadie más la usaba. '
  'REDUCCION: se redujo la Quantity porque otras tandas hermanas activas '
  'de una subdivisión aún la necesitan.';
COMMENT ON COLUMN cancelaciones_ov_sap.cantidad_reducida IS
  'Unidades descontadas de la línea en este evento (solo aplica a REDUCCION).';
COMMENT ON COLUMN cancelaciones_ov_sap.cantidad_restante_sap IS
  'Cantidad de la línea en SAP después de esta acción (0 si fue CIERRE).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'productos_por_masa_ov' AND column_name = 'cantidad_abierta_sap')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cancelaciones_ov_sap' AND column_name = 'tipo_accion')
  THEN
    RAISE NOTICE '✓ Migración 052 aplicada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: columnas no se crearon';
  END IF;
END $$;

COMMIT;
