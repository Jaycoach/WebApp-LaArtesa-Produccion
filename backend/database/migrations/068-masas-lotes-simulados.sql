-- ============================================================================
-- MIGRACIÓN 068: masas_lotes_simulados + productos_por_masa.tanda_simulada_letra
-- Fecha: 2026-08-24
-- Motivo: hoy el lote de una sub-masa (masas_produccion.lote_produccion con
--         sufijo -A/-B/...) solo se decide en confirmarPesaje, DESPUÉS de que
--         Empaque ya recibió el correo de alistamiento al aprobar — ese correo
--         no puede mostrar el lote real porque todavía no existe. Este cambio
--         simula el plan de subdivisión (BOM + tandas + lote por tanda) en el
--         momento de aprobar (y lo re-simula si el delta cambia), lo persiste
--         en masas_lotes_simulados, y ejecutarSubdivision() en confirmarPesaje
--         pasa a CONSUMIR ese plan (letras/lotes) en vez de generarlo de cero.
--
--         tanda_simulada_letra en productos_por_masa es informativo (para
--         mostrar en UI antes de que exista subdivisión física): cuando
--         agruparProductosEnTandas parte un producto entre dos tandas, esta
--         columna guarda la tanda con mayor fracción (no representa un split).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS masas_lotes_simulados (
  id                SERIAL PRIMARY KEY,
  masa_id           INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

  -- NULL cuando la masa no necesita subdivisión (una sola "tanda" = la masa
  -- completa, lote sin sufijo). 'A','B','C'... cuando sí hay subdivisión.
  tanda_letra       VARCHAR(4),
  lote_produccion   VARCHAR(50) NOT NULL,
  n_tandas_total    INTEGER NOT NULL,
  kg_estimado       NUMERIC(10,3),

  simulado_en       TIMESTAMP NOT NULL DEFAULT NOW(),
  simulado_por      INTEGER REFERENCES usuarios(id),

  UNIQUE (masa_id, tanda_letra)
);

CREATE INDEX IF NOT EXISTS idx_masas_lotes_simulados_masa ON masas_lotes_simulados(masa_id);

COMMENT ON TABLE masas_lotes_simulados IS
  'Plan de subdivisión simulado al aprobar/editar delta (BOM + tandas + lote por tanda), consumido por ejecutarSubdivision() al confirmar pesaje. Se reemplaza completo (DELETE+INSERT) cada vez que se re-simula.';

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS tanda_simulada_letra VARCHAR(4);

COMMENT ON COLUMN productos_por_masa.tanda_simulada_letra IS
  'Letra de tanda simulada (informativa, pre-subdivisión física) — mayor fracción cuando el producto quedó partido entre tandas en la simulación.';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE productos_por_masa DROP COLUMN IF EXISTS tanda_simulada_letra;
-- DROP TABLE IF EXISTS masas_lotes_simulados;
-- COMMIT;
