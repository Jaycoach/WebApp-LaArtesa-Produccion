-- =====================================================
-- Migración 031: Control de idempotencia en pesaje SAP
-- Tabla: masas_produccion
-- Agrega sap_doc_entry_pesaje y sap_doc_num_pesaje
-- para evitar crear múltiples InventoryGenExits en SAP
-- cuando el usuario presiona "Confirmar Pesaje" más
-- de una vez (lentitud de red, doble clic, etc.)
-- =====================================================

-- Columna con el DocEntry SAP del InventoryGenExits de pesaje
ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS sap_doc_entry_pesaje INTEGER DEFAULT NULL;

-- Columna con el DocNum SAP (visible en la UI de SAP Business One)
ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS sap_doc_num_pesaje VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN masas_produccion.sap_doc_entry_pesaje IS
  'DocEntry del InventoryGenExits creado en SAP al confirmar pesaje. '
  'Si NOT NULL, el consumo ya fue transmitido — no se debe crear otro.';

COMMENT ON COLUMN masas_produccion.sap_doc_num_pesaje IS
  'DocNum del InventoryGenExits en SAP (número visible en la UI de SAP). '
  'Se muestra al operario para trazabilidad y búsqueda en SAP Business One.';

-- Backfill desde sap_sync_log para masas que ya tienen pesaje transmitido
-- (protege masas existentes sin romper su estado)
UPDATE masas_produccion mp
SET
  sap_doc_entry_pesaje = sl.sap_docentry::INTEGER,
  sap_doc_num_pesaje   = sl.sap_docnum
FROM (
  -- Por cada masa, tomar el ÚLTIMO log exitoso de GOODS_ISSUE_PESAJE
  SELECT DISTINCT ON (
    (response_payload->>'masa_id')::INTEGER
  )
    (response_payload->>'masa_id')::INTEGER AS masa_id,
    sap_docentry,
    sap_docnum
  FROM sap_sync_log
  WHERE tipo_operacion = 'GOODS_ISSUE_PESAJE'
    AND estado = 'SUCCESS'
    AND sap_docentry IS NOT NULL
  ORDER BY (response_payload->>'masa_id')::INTEGER, id DESC
) sl
WHERE mp.id = sl.masa_id
  AND mp.sap_doc_entry_pesaje IS NULL;