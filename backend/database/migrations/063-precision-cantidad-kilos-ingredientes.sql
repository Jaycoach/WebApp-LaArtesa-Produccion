-- ============================================================================
-- MIGRACIÓN 063: precisión decimal en ingredientes_masa.cantidad_kilos
-- Fecha: 2026-08-24
-- Motivo: hallazgo adicional durante la validación en staging de la migración
--         062 (precisión decimal en pesaje). ingredientes_masa.cantidad_kilos
--         es NUMERIC(10,3) — solo guarda hasta el gramo (0.001 kg). Para
--         ingredientes traza del BOM por debajo de 0.5 g (ej. AJONJOLI NEGRO
--         en masa 2052/staging: cantidad_gramos = 0.12g, correcto, pero
--         cantidad_kilos quedó guardado como 0.000 por el redondeo de la
--         columna) esto rompe todo lo que se calcula a partir de
--         cantidad_kilos, no solo el consumo a SAP:
--           - pesaje.controller.js::getChecklist → cantidadRequerida = 0,
--             lo que deja lotes_consumo_sugerido vacío para ese ingrediente
--             (el autosugerido nunca llega a generarse, aunque los fixes de
--             la migración 062/commit de pesaje.controller.js ya estén).
--           - la misma cantidadRequerida=0 tapa la validación de sin_stock
--             para ese ingrediente (0 < stock_disponible siempre es falso).
--
--         cantidad_gramos (NUMERIC(10,2)) sí conserva el valor real porque
--         nunca tuvo este problema — el bug estaba solo en la columna kilos.
--         NUMERIC(10,6) iguala la precisión de sap_bom_componentes.cantidad,
--         de donde sale este valor originalmente.
--
--         Esta migración NO reconstruye datos históricos ya truncados (no hay
--         forma de recuperar el decimal perdido en filas viejas) — corrige la
--         columna hacia adelante. Los ingredientes traza ya truncados a 0.000
--         en masas viejas no pesadas se corrigen solos la próxima vez que esa
--         masa recorra PLANIFICACION (completarFase vuelve a calcular BOM).
-- ============================================================================

BEGIN;

ALTER TABLE ingredientes_masa
  ALTER COLUMN cantidad_kilos TYPE NUMERIC(12,6);

-- Backfill: filas ya truncadas a 0.000 por la columna vieja, pero con
-- cantidad_gramos > 0 (esa columna sí conservó el valor real porque nunca
-- tuvo este bug). Solo toca filas rotas — no pisa ninguna fila ya correcta.
UPDATE ingredientes_masa
SET cantidad_kilos = cantidad_gramos / 1000.0
WHERE cantidad_kilos = 0
  AND cantidad_gramos > 0;

-- Verificación
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'ingredientes_masa' AND column_name = 'cantidad_kilos';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE ingredientes_masa ALTER COLUMN cantidad_kilos TYPE NUMERIC(10,3);
-- COMMIT;
