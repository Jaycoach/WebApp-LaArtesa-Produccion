-- ============================================================================
-- MIGRACIÓN 064: backfill completo de ingredientes_masa.cantidad_kilos
-- Fecha: 2026-08-24
-- Motivo: la migración 063 solo hizo backfill de filas truncadas a 0.000
--         exacto. Validando en vivo contra masa 2052 (staging) se confirmó
--         que TODA fila insertada antes de esta sesión quedó con
--         cantidad_kilos redondeado a 3 decimales (columna vieja
--         NUMERIC(10,3)) -- no solo las trazas que llegaban a 0 -- porque el
--         INSERT original (fases.controller.js::completarFase) calcula
--         cantidad_gramos = cantidad_kilos * 1000 en JS con precisión
--         completa ANTES de guardar, y es la columna DECIMAL(10,2) (2
--         decimales de gramo, sobra precisión) la que nunca perdió el dato.
--         Ej. real (masa 2052): AZUCAR cantidad_gramos=307.57 pero
--         cantidad_kilos quedó en 0.308 (redondeado), no 0.30757.
--
--         Este backfill es más amplio que el de la 063: recalcula
--         cantidad_kilos = cantidad_gramos / 1000 en TODA fila de
--         ingredientes_masa (no solo las que están en 0), usando
--         cantidad_gramos como fuente porque es la que siempre tuvo
--         precisión suficiente. es_empaque no aplica en esta tabla — los
--         materiales de empaque viven en empaque_por_masa, aparte.
--
--         Solo toca la columna "cantidad requerida" (snapshot del BOM) —
--         nunca peso_real (lo realmente pesado y ya transmitido a SAP en
--         pesajes completados), así que no reabre ningún envío a SAP ya
--         hecho.
-- ============================================================================

BEGIN;

UPDATE ingredientes_masa
SET cantidad_kilos = ROUND(cantidad_gramos / 1000.0, 6)
WHERE cantidad_gramos IS NOT NULL
  AND cantidad_kilos IS DISTINCT FROM ROUND(cantidad_gramos / 1000.0, 6);

-- Verificación
SELECT COUNT(*) AS filas_corregidas FROM ingredientes_masa
WHERE cantidad_kilos = ROUND(cantidad_gramos / 1000.0, 6);

COMMIT;

-- No aplica rollback específico — esta migración solo aumenta precisión de
-- un snapshot informativo, no hay valor previo "correcto" al cual volver.
