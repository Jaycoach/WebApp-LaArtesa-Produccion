-- ============================================================
-- Migración 032: Columnas SAP en registros_empaque
-- Permite rastrear DocEntry de entrada/salida SAP y errores
-- para detectar empaques completados con fallo en SAP.
-- ============================================================

-- 1. Columnas de trazabilidad SAP en registros_empaque
ALTER TABLE registros_empaque
  ADD COLUMN IF NOT EXISTS sap_doc_entry_entrada  INTEGER       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sap_doc_num_entrada     VARCHAR(20)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sap_doc_entry_salida    INTEGER       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sap_doc_num_salida      VARCHAR(20)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sap_error_entrada       TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sap_error_salida        TEXT          DEFAULT NULL;

-- 2. Índice para buscar rápido empaques con error SAP pendiente
CREATE INDEX IF NOT EXISTS idx_registros_empaque_sap_error
  ON registros_empaque (masa_id)
  WHERE sap_error_entrada IS NOT NULL OR sap_error_salida IS NOT NULL;

-- 3. Comentarios de columnas
COMMENT ON COLUMN registros_empaque.sap_doc_entry_entrada IS 'DocEntry InventoryGenEntries producto terminado → PROTERMI';
COMMENT ON COLUMN registros_empaque.sap_doc_num_entrada   IS 'DocNum InventoryGenEntries producto terminado';
COMMENT ON COLUMN registros_empaque.sap_doc_entry_salida  IS 'DocEntry InventoryGenExits materiales de empaque → ALMP';
COMMENT ON COLUMN registros_empaque.sap_doc_num_salida    IS 'DocNum InventoryGenExits materiales de empaque';
COMMENT ON COLUMN registros_empaque.sap_error_entrada     IS 'Mensaje de error SAP en entrada de mercancía (NULL = OK)';
COMMENT ON COLUMN registros_empaque.sap_error_salida      IS 'Mensaje de error SAP en salida de materiales de empaque (NULL = OK)';