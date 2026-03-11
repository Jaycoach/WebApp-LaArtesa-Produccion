-- =============================================
-- Migración 025: manage_batch_numbers en sap_inventario_mp
-- Fecha: 2026-03-11
-- Descripción: Agrega columna manage_batch_numbers para saber si un ítem
--   de materia prima maneja lotes SAP (ManageBatchNumbers = 'tYES').
--   Se sincroniza junto con el stock/costo en cada sincronización de inventario MP.
-- =============================================

BEGIN;

ALTER TABLE sap_inventario_mp
  ADD COLUMN IF NOT EXISTS manage_batch_numbers BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sap_inventario_mp.manage_batch_numbers
  IS 'TRUE si el ítem maneja lotes en SAP (ManageBatchNumbers = tYES). Se actualiza en cada sync de inventario MP.';

-- Verificación
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sap_inventario_mp' AND column_name = 'manage_batch_numbers'
  ) THEN
    RAISE NOTICE '✓ sap_inventario_mp.manage_batch_numbers agregada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se agregó la columna manage_batch_numbers';
  END IF;
END $$;

COMMIT;
