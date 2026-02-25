-- =============================================
-- MIGRACIÓN 007: Integración de Paquetes SAP
-- Sistema ARTESA - La Artesa SAS
-- Fecha: 2026-02-24
-- Descripción: Agrega campos para almacenar datos
--   de paquetes provenientes de Órdenes de Venta SAP.
--   cantidad_paquetes = Quantity * SalPackUn (lo que
--   Empaque debe recibir al final de la producción).
-- =============================================

BEGIN;

-- =============================================
-- 1. TABLA: productos_por_masa
--    Agregar campos de paquetes SAP
-- =============================================

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS sap_item_code        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS unidades_por_paquete  NUMERIC(10,4) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cantidad_paquetes     NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sap_doc_entry         INTEGER,
  ADD COLUMN IF NOT EXISTS sap_doc_num           VARCHAR(20);

-- Comentarios para documentar el propósito de cada campo
COMMENT ON COLUMN productos_por_masa.sap_item_code        IS 'Código del artículo en SAP (ItemCode de OITM)';
COMMENT ON COLUMN productos_por_masa.unidades_por_paquete IS 'Unidades por paquete según SAP (SalPackUn de OITM)';
COMMENT ON COLUMN productos_por_masa.cantidad_paquetes    IS 'Total paquetes a entregar = Quantity * SalPackUn (dato para Empaque)';
COMMENT ON COLUMN productos_por_masa.sap_doc_entry        IS 'DocEntry de la Orden de Venta SAP origen';
COMMENT ON COLUMN productos_por_masa.sap_doc_num          IS 'DocNum de la Orden de Venta SAP origen';
COMMENT ON COLUMN productos_por_masa.unidades_pedidas     IS 'Quantity de OV SAP: paquetes pedidos por el cliente';
COMMENT ON COLUMN productos_por_masa.unidades_programadas IS 'Paquetes programados a producir (ajustable por merma)';

-- Índice para búsquedas por código SAP
CREATE INDEX IF NOT EXISTS idx_productos_sap_item_code
  ON productos_por_masa(sap_item_code);

-- Restricción única: un artículo SAP no puede repetirse en la misma masa
-- (permite ON CONFLICT en el sincronizador)
ALTER TABLE productos_por_masa
  ADD CONSTRAINT IF NOT EXISTS uq_masa_sap_item_code
  UNIQUE (masa_id, sap_item_code);

-- =============================================
-- 2. TABLA: masas_produccion
--    Agregar campos de resumen SAP
-- =============================================

ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS fecha_sap_referencia  DATE,
  ADD COLUMN IF NOT EXISTS total_ordenes         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_productos       INTEGER DEFAULT 0;

COMMENT ON COLUMN masas_produccion.fecha_sap_referencia IS 'Fecha de DocDate de las OVs SAP sincronizadas';
COMMENT ON COLUMN masas_produccion.total_ordenes        IS 'Cantidad de OVs SAP agrupadas en esta masa';
COMMENT ON COLUMN masas_produccion.total_productos      IS 'Cantidad de productos distintos en esta masa';

-- =============================================
-- 3. VERIFICACIÓN FINAL
-- =============================================

DO $$
BEGIN
  -- Verificar columnas en productos_por_masa
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'productos_por_masa'
      AND column_name = 'cantidad_paquetes'
  ) THEN
    RAISE NOTICE '✓ productos_por_masa: campos de paquetes SAP agregados correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se crearon los campos en productos_por_masa';
  END IF;

  -- Verificar columnas en masas_produccion
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'masas_produccion'
      AND column_name = 'fecha_sap_referencia'
  ) THEN
    RAISE NOTICE '✓ masas_produccion: campos de resumen SAP agregados correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se crearon los campos en masas_produccion';
  END IF;
END $$;

COMMIT;