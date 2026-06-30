-- =============================================
-- Migración 040: confirmado_sap en pesaje_lotes_consumo
-- Fecha: 2026-06-30
-- Descripción: Marca las reservas de lotes como confirmadas una vez que
--   el consumo se postea exitosamente en SAP (InventoryGenExit), en vez
--   de eliminarlas. Evita doble descuento en el sync de sap_lotes_mp
--   (el sync resta "reservado" sin distinguir confirmado vs pendiente).
-- =============================================

BEGIN;

ALTER TABLE pesaje_lotes_consumo
  ADD COLUMN IF NOT EXISTS confirmado_sap BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmado_en  TIMESTAMP NULL;

COMMENT ON COLUMN pesaje_lotes_consumo.confirmado_sap IS
  'TRUE cuando el consumo ya se posteó exitosamente en SAP (InventoryGenExit). El sync de lotes excluye estas filas al calcular "reservado", evitando doble descuento.';
COMMENT ON COLUMN pesaje_lotes_consumo.confirmado_en IS
  'Timestamp de cuándo se confirmó el posteo en SAP.';

CREATE INDEX IF NOT EXISTS idx_pesaje_lotes_consumo_confirmado
  ON pesaje_lotes_consumo(confirmado_sap) WHERE confirmado_sap = false;

-- Verificación
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pesaje_lotes_consumo' AND column_name = 'confirmado_sap'
  ) THEN
    RAISE NOTICE '✓ pesaje_lotes_consumo.confirmado_sap agregada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se agregó la columna confirmado_sap';
  END IF;
END $$;

COMMIT;
