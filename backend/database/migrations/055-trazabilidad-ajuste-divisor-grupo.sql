-- ============================================================================
-- MIGRACIÓN 055: Trazabilidad del ajuste de grupo por divisor (Fase 4)
-- Fecha: 2026-08-12
-- Motivo: simularAjusteDivisorPorGrupo (fases.controller.js) puede subir
--         unidades_programadas de un producto para que su grupo
--         (clasificarClaveAgrupacion: tipo_masa+forma+tamaño+multiplo_divisor)
--         alcance el múltiplo exacto del divisor compartido. Se dispara desde
--         3 puntos (aprobarMasaCore, confirmarPesaje, merge de OV en
--         sap.controller.js) — estas columnas permiten auditar cuál de los
--         3 aplicó el último ajuste y cuánto acumuló, separado del delta+2
--         manual/default que ya existía antes de esta fase.
-- ============================================================================

BEGIN;

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS origen_ajuste_divisor VARCHAR(20)
    CHECK (origen_ajuste_divisor IN ('APROBACION', 'PESAJE', 'MERGE_OV')),
  ADD COLUMN IF NOT EXISTS unidades_ajuste_grupal INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN productos_por_masa.origen_ajuste_divisor IS
  'Último punto de enganche (Fase 4) que ajustó unidades_programadas para '
  'completar el múltiplo del divisor compartido de su grupo. NULL = nunca '
  'se le aplicó un ajuste de grupo.';
COMMENT ON COLUMN productos_por_masa.unidades_ajuste_grupal IS
  'Paquetes acumulados específicamente por simularAjusteDivisorPorGrupo, '
  'separado del delta_ajuste manual/default ya existente.';

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'productos_por_masa'
  AND column_name IN ('origen_ajuste_divisor', 'unidades_ajuste_grupal')
ORDER BY column_name;

COMMIT;
