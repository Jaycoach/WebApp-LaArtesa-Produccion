-- Migración 026: tabla pesaje_lotes_consumo
-- Registra la reserva de stock por lote al momento de guardar cada ingrediente pesado.
-- Reemplaza el campo único ingredientes_masa.lote para soportar split entre lotes.

CREATE TABLE IF NOT EXISTS pesaje_lotes_consumo (
  id              SERIAL PRIMARY KEY,
  ingrediente_id  INTEGER NOT NULL REFERENCES ingredientes_masa(id) ON DELETE CASCADE,
  masa_id         INTEGER NOT NULL REFERENCES masas_produccion(id)  ON DELETE CASCADE,
  item_code       VARCHAR(50)  NOT NULL,
  batch           VARCHAR(100) NOT NULL,
  cantidad_kg     NUMERIC(12,3) NOT NULL CHECK (cantidad_kg > 0),
  reservado_at    TIMESTAMP DEFAULT NOW(),
  usuario_id      INTEGER REFERENCES usuarios(id)
);

CREATE INDEX idx_plc_ingrediente ON pesaje_lotes_consumo(ingrediente_id);
CREATE INDEX idx_plc_masa        ON pesaje_lotes_consumo(masa_id);
CREATE INDEX idx_plc_item_batch  ON pesaje_lotes_consumo(item_code, batch);