-- ============================================================
-- MIGRACIÓN 020: Soporte para ajuste de unidades por múltiplo divisor
-- Fecha: 2026-03-02
-- Descripción:
--   - unidades_ajustadas: múltiplo superior de unidades_pedidas según divisor
--   - unidades_excedente: diferencia entre ajustadas y pedidas (para stock SAP futuro)
-- ============================================================

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS unidades_ajustadas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unidades_excedente INTEGER NOT NULL DEFAULT 0;

-- Actualizar registros existentes: calcular retroactivamente desde unidades_programadas
UPDATE productos_por_masa
SET
  unidades_ajustadas = CASE
    WHEN multiplo_divisor > 0 AND unidades_programadas % multiplo_divisor != 0
      THEN (FLOOR(unidades_programadas::float / multiplo_divisor) + 1) * multiplo_divisor
    ELSE unidades_programadas
  END,
  unidades_excedente = CASE
    WHEN multiplo_divisor > 0 AND unidades_programadas % multiplo_divisor != 0
      THEN ((FLOOR(unidades_programadas::float / multiplo_divisor) + 1) * multiplo_divisor) - unidades_programadas
    ELSE 0
  END;

-- Verificar resultado
SELECT
  sap_item_code,
  producto_nombre,
  unidades_pedidas,
  unidades_programadas,
  multiplo_divisor,
  unidades_ajustadas,
  unidades_excedente
FROM productos_por_masa
ORDER BY masa_id, sap_item_code
LIMIT 20;
