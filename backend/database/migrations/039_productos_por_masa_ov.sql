-- =============================================
-- MIGRACIÓN 039: Tabla productos_por_masa_ov
-- Sistema ARTESA - La Artesa SAS
-- Fecha: 2026-05-29
-- Descripción: Tabla de trazabilidad OV por producto de masa.
--   Registra qué líneas de OV componen cada producto de una masa,
--   con seguimiento de unidades pedidas vs producidas por OV.
--   Permite control de idempotencia en sincronización y distribución
--   de producción entre OVs en empaque.
-- =============================================

BEGIN;

CREATE TABLE IF NOT EXISTS productos_por_masa_ov (
  id                  SERIAL PRIMARY KEY,
  uuid                UUID NOT NULL DEFAULT uuid_generate_v4(),

  -- FK al producto agregado de la masa (totales)
  producto_masa_id    INTEGER NOT NULL
                        REFERENCES productos_por_masa(id) ON DELETE CASCADE,

  -- FK directa a la masa (para queries sin JOIN adicional)
  masa_id             INTEGER NOT NULL
                        REFERENCES masas_produccion(id) ON DELETE CASCADE,

  -- Identificación exacta de la línea de OV en SAP
  sap_doc_entry       INTEGER NOT NULL,
  sap_doc_num         VARCHAR(20) NOT NULL,
  sap_line_num        INTEGER NOT NULL,
  sap_item_code       VARCHAR(50) NOT NULL,

  -- Cantidades
  unidades_pedidas    INTEGER NOT NULL DEFAULT 0,
  unidades_producidas INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),

  -- Idempotencia: una sola fila por línea de OV por masa
  CONSTRAINT uq_ppm_ov_masa_doc_line UNIQUE (masa_id, sap_doc_entry, sap_line_num)
);

COMMENT ON TABLE productos_por_masa_ov IS
  'Detalle de líneas de OV SAP que componen cada producto de una masa. '
  'Una fila por línea de OV. Permite trazabilidad completa OV→masa→empaque '
  'y control de idempotencia en re-sincronizaciones.';

COMMENT ON COLUMN productos_por_masa_ov.sap_line_num IS
  'LineNum de la línea dentro del documento de OV en SAP. '
  'Junto con sap_doc_entry identifica unívocamente la línea.';
COMMENT ON COLUMN productos_por_masa_ov.unidades_pedidas IS
  'Paquetes pedidos en esta línea de OV específica.';
COMMENT ON COLUMN productos_por_masa_ov.unidades_producidas IS
  'Paquetes distribuidos a esta OV en empaque. '
  'Se actualiza cuando el operario empaca por OV.';

CREATE INDEX IF NOT EXISTS idx_ppm_ov_producto_masa
  ON productos_por_masa_ov(producto_masa_id);
CREATE INDEX IF NOT EXISTS idx_ppm_ov_masa
  ON productos_por_masa_ov(masa_id);
CREATE INDEX IF NOT EXISTS idx_ppm_ov_doc_entry
  ON productos_por_masa_ov(sap_doc_entry);
CREATE INDEX IF NOT EXISTS idx_ppm_ov_item_code
  ON productos_por_masa_ov(sap_item_code);

CREATE TRIGGER trigger_update_ppm_ov_timestamp
  BEFORE UPDATE ON productos_por_masa_ov
  FOR EACH ROW EXECUTE FUNCTION update_masas_timestamp();

-- Agregar referencia a OV en empaque_detalles para trazabilidad
ALTER TABLE empaque_detalles
  ADD COLUMN IF NOT EXISTS ppm_ov_id INTEGER DEFAULT NULL
    REFERENCES productos_por_masa_ov(id) ON DELETE SET NULL;

COMMENT ON COLUMN empaque_detalles.ppm_ov_id IS
  'FK a productos_por_masa_ov — identifica qué OV específica se está empacando. '
  'NULL para detalles de masas anteriores al nuevo modelo.';

CREATE INDEX IF NOT EXISTS idx_empaque_detalles_ppm_ov
  ON empaque_detalles(ppm_ov_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'productos_por_masa_ov'
  ) THEN
    RAISE NOTICE '✓ Tabla productos_por_masa_ov creada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se creó la tabla productos_por_masa_ov';
  END IF;
END $$;

COMMIT;
