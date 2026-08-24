-- ============================================================================
-- MIGRACIÓN 066: precisión decimal en sap_lotes_mp.cantidad_disponible
-- Fecha: 2026-08-24
-- Motivo (Hallazgo 7, validación manual en vivo sobre masa 2052/staging):
--         mismo patrón de raíz que los Hallazgos 2 y 6 de esta sesión, ahora
--         encontrado en el snapshot de inventario por lote. Tras sincronizar
--         y confirmar que sap_lotes_mp.ultimo_sync ya estaba fresco (fix del
--         Hallazgo 3), Orbit mostraba "1g disponible" para el lote 65361 de
--         AZUCAR (MP0015) y aun así SAP rechazó el intento de consumir
--         exactamente esa cantidad ("Insufficient quantity").
--
--         Causa raíz confirmada en DOS puntos independientes de escritura
--         de esta misma columna — ambos truncaban a 3 decimales en kg
--         (1 gramo de resolución) antes de guardar:
--           - backend/src/services/sap.service.js:1047 (sync vía Service
--             Layer REST): `parseFloat(row.Quantity).toFixed(3)`
--           - backend/scripts/hana_lotes_mp.py:67 (sync vía HANA directo,
--             usado por el cron): `round(float(quantity), 3)`
--         Un real de, por ejemplo, 0.6g quedaba redondeado hacia arriba a
--         "1g disponible" en ambos caminos — Orbit pedía exactamente ese
--         gramo completo y SAP lo rechazaba porque el remanente real seguía
--         siendo menor.
--
--         Ambos puntos ya se corrigieron a 6 decimales (misma precisión que
--         el resto de los fixes de esta sesión). Esta migración amplía la
--         columna para que ese dato ya no se pierda al guardarse.
-- ============================================================================

BEGIN;

ALTER TABLE sap_lotes_mp
  ALTER COLUMN cantidad_disponible TYPE NUMERIC(12,6);

-- Verificación
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'sap_lotes_mp' AND column_name = 'cantidad_disponible';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE sap_lotes_mp ALTER COLUMN cantidad_disponible TYPE NUMERIC(12,3);
-- COMMIT;
