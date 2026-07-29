-- Migración 049: Ajustes de pesaje post-transmisión SAP
ALTER TABLE ingredientes_masa
  ADD COLUMN IF NOT EXISTS peso_confirmado_sap NUMERIC(10,2) DEFAULT NULL;

COMMENT ON COLUMN ingredientes_masa.peso_confirmado_sap IS
  'Peso real (g) transmitido a SAP la primera vez que se confirmó el pesaje. '
  'Se graba UNA SOLA VEZ (nunca se sobreescribe). Línea base para calcular '
  'ajustes posteriores sin importar cuántas veces el supervisor corrija peso_real.';

CREATE TABLE IF NOT EXISTS pesaje_ajustes_sap (
  id                    SERIAL PRIMARY KEY,
  masa_id               INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
  ingrediente_id        INTEGER NOT NULL REFERENCES ingredientes_masa(id) ON DELETE CASCADE,
  ingrediente_sap_code  VARCHAR(50),
  ingrediente_nombre    VARCHAR(200),
  peso_confirmado_sap_g NUMERIC(10,2) NOT NULL,
  ajustado_previo_g     NUMERIC(10,2) NOT NULL DEFAULT 0,
  peso_nuevo_g          NUMERIC(10,2) NOT NULL,
  delta_gramos          NUMERIC(10,2) NOT NULL,
  tipo                  VARCHAR(10) NOT NULL CHECK (tipo IN ('EXCEDENTE','FALTANTE')),
  lote                  VARCHAR(100),
  sap_doc_entry         INTEGER,
  sap_doc_num           VARCHAR(20),
  sap_error             TEXT,
  usuario_id            INTEGER REFERENCES usuarios(id),
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pesaje_ajustes_masa ON pesaje_ajustes_sap(masa_id);
CREATE INDEX IF NOT EXISTS idx_pesaje_ajustes_ingrediente ON pesaje_ajustes_sap(ingrediente_id);

COMMENT ON TABLE pesaje_ajustes_sap IS
  'Auditoría de ajustes SAP por ediciones de pesaje posteriores a la confirmación. '
  'Una fila = un documento SAP (GenExit o GenEntry) por un ingrediente. Solo las filas '
  'con sap_doc_entry NOT NULL cuentan como "ya enviadas" para el cálculo del próximo ajuste.';