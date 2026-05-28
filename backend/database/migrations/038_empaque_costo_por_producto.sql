-- ============================================================
-- Migración 038: Trazabilidad de consumo de empaque por producto
-- ============================================================

CREATE TABLE IF NOT EXISTS empaque_consumo_materiales (
  id                   SERIAL PRIMARY KEY,
  masa_id              INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
  producto_masa_id     INTEGER NOT NULL REFERENCES productos_por_masa(id) ON DELETE CASCADE,
  item_code_comp       VARCHAR(50) NOT NULL,
  item_name_comp       VARCHAR(200),
  cantidad_consumida   NUMERIC(14,4) NOT NULL DEFAULT 0,
  uom                  VARCHAR(20),
  costo_unitario_mat   NUMERIC(14,4) DEFAULT 0,
  costo_total_mat      NUMERIC(14,4) DEFAULT 0,
  sap_doc_entry_salida INTEGER DEFAULT NULL,
  sap_doc_num_salida   VARCHAR(20) DEFAULT NULL,
  created_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecm_masa_id          ON empaque_consumo_materiales(masa_id);
CREATE INDEX IF NOT EXISTS idx_ecm_producto_masa_id ON empaque_consumo_materiales(producto_masa_id);

COMMENT ON TABLE empaque_consumo_materiales IS
  'Consumo real de materiales de empaque por producto_masa_id. Una fila por (producto, material).';

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS costo_empaque_real NUMERIC(14,4) DEFAULT 0;

COMMENT ON COLUMN productos_por_masa.costo_empaque_real IS
  'Costo de empaque calculado desde BOM real x precio x unidades empacadas (no prorrateado por kilos)';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empaque_consumo_materiales') THEN
    RAISE NOTICE 'OK empaque_consumo_materiales creada';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos_por_masa' AND column_name='costo_empaque_real') THEN
    RAISE NOTICE 'OK productos_por_masa.costo_empaque_real agregada';
  END IF;
END $$;
