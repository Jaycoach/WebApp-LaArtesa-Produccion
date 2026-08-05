BEGIN;

CREATE TABLE IF NOT EXISTS cancelaciones_ov_sap (
  id                    SERIAL PRIMARY KEY,
  masa_id               INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
  sap_doc_entry         INTEGER NOT NULL,
  sap_doc_num           VARCHAR(20) NOT NULL,
  sap_line_num          INTEGER NOT NULL,
  sap_item_code         VARCHAR(50) NOT NULL,
  exitosa               BOOLEAN NOT NULL,
  mensaje_error         TEXT,
  cancelado_por         INTEGER NOT NULL REFERENCES usuarios(id),
  cancelado_en          TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cancelaciones_ov_sap IS
  'Auditoría de cierre de líneas de OV en SAP al cancelar una masa (B6, 2026-08-04). '
  'Una fila por línea que se intentó cerrar en SAP, con éxito o fallo.';

CREATE INDEX IF NOT EXISTS idx_cancelaciones_ov_masa ON cancelaciones_ov_sap(masa_id);
CREATE INDEX IF NOT EXISTS idx_cancelaciones_ov_doc_entry ON cancelaciones_ov_sap(sap_doc_entry);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cancelaciones_ov_sap') THEN
    RAISE NOTICE '✓ Tabla cancelaciones_ov_sap creada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se creó la tabla cancelaciones_ov_sap';
  END IF;
END $$;

COMMIT;