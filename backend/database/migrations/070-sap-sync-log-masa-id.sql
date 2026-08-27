-- ============================================================================
-- MIGRACIÓN 070: sap_sync_log.masa_id
-- Fecha: 2026-08-26
-- Motivo: cuando el Service Layer de SAP está caído por desconexión (no por
--         error de negocio), el pesaje debe poder confirmarse igual dejando
--         el consumo pendiente de sincronizar. Para listar y reintentar en
--         lote esas transmisiones pendientes (GET/POST /api/pesaje/sap-
--         pendientes) se necesita relacionar cada fila de sap_sync_log con
--         la masa de producción que la originó — hoy esa relación solo vive
--         dentro de request_payload (JSONB), no es consultable por índice.
-- ============================================================================

BEGIN;

ALTER TABLE sap_sync_log
    ADD COLUMN IF NOT EXISTS masa_id INTEGER REFERENCES masas_produccion(id);

CREATE INDEX IF NOT EXISTS idx_sap_sync_log_masa_id ON sap_sync_log(masa_id);

COMMENT ON COLUMN sap_sync_log.masa_id IS
  'Masa de producción asociada a la operación SAP (poblado por el flujo de pesaje; NULL para operaciones no ligadas a una masa, ej. OFs).';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir)
-- ============================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_sap_sync_log_masa_id;
-- ALTER TABLE sap_sync_log DROP COLUMN IF EXISTS masa_id;
-- COMMIT;
