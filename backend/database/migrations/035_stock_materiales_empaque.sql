-- 035: Agrega stock_disponible a sap_bom_componentes para materiales de empaque
-- Permite mostrar stock por ítem de empaque sin depender de sap_inventario_mp
-- (los EMP* no están en sap_inventario_mp, solo en sap_bom_componentes)

ALTER TABLE sap_bom_componentes
  ADD COLUMN IF NOT EXISTS stock_disponible NUMERIC(12,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_sync_stock TIMESTAMP DEFAULT NULL;

COMMENT ON COLUMN sap_bom_componentes.stock_disponible IS 'Stock en ALMP sincronizado desde SAP para ítems de empaque';
COMMENT ON COLUMN sap_bom_componentes.ultimo_sync_stock IS 'Última sincronización de stock desde SAP';
