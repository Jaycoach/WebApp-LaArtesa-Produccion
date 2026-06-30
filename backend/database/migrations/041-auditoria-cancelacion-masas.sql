-- =============================================
-- Migración 041: Auditoría de cancelación de masas + liberación de reservas
-- Fecha: 2026-06-30
-- Descripción: Agrega trazabilidad de quién/cuándo cancela una masa
--   (mismo patrón que aprobado_por/aprobado_en). Agrega liberado_en en
--   pesaje_lotes_consumo para marcar reservas liberadas sin SAP-confirmar,
--   SIN eliminar el registro (se conserva para auditoría/reportes de OV).
-- =============================================

BEGIN;

ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS cancelado_por INTEGER NULL,
  ADD COLUMN IF NOT EXISTS cancelado_en TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT NULL;

COMMENT ON COLUMN masas_produccion.cancelado_por IS 'usuario_id que canceló la masa (mismo patrón que aprobado_por)';
COMMENT ON COLUMN masas_produccion.cancelado_en  IS 'Timestamp de cancelación';
COMMENT ON COLUMN masas_produccion.motivo_cancelacion IS 'Motivo ingresado por el usuario al cancelar';

ALTER TABLE pesaje_lotes_consumo
  ADD COLUMN IF NOT EXISTS liberado_en TIMESTAMP NULL;

COMMENT ON COLUMN pesaje_lotes_consumo.liberado_en IS
  'Timestamp en que se liberó la reserva por cancelación de masa (sin llegar a confirmarse en SAP). El registro NUNCA se elimina — se conserva para auditoría y para reportes de OVs canceladas. El sync de lotes excluye estas filas al calcular "reservado".';

COMMIT;
