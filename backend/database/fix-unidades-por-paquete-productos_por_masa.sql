-- =====================================================
-- SCRIPT: Backfill de unidades_por_paquete en productos_por_masa
-- =====================================================
-- Contexto (sesión 2026-08-20, sección 3.5/3.6 del resumen de sesión):
-- 97 sap_item_code en productos_por_masa quedaron con unidades_por_paquete
-- = 1 aunque SAP sí tiene el UDF U_JZ_PanesPorBolsa configurado
-- correctamente para la mayoría de ellos. Causa raíz: no existe ningún
-- mecanismo que propague sap_articulos.sales_qty_per_pack (que SÍ se
-- refresca en cada corrida del cron de sync BOM/inventario, 6:00/21:00)
-- hacia las filas YA EXISTENTES de productos_por_masa — solo se escribe
-- una vez, al crear la fila via sincronizar-ov (manual, por OV puntual).
--
-- sap_articulos es la fuente de verdad de master data aquí (su UPSERT
-- sí refresca sales_qty_per_pack en cada sync — sin bug, confirmado por
-- grep en sap.controller.js:1689 y :2051).
--
-- EXCLUSIÓN DE NEGOCIO (mismo criterio que el fix de costeo 3.2 — "el fix
-- aplica solo hacia adelante"): no se debe recalcular retroactivamente
-- productos_por_masa de masas ya COMPLETADAS, donde el valor histórico ya
-- alimentó un costeo real transmitido a SAP. AMBIGÜEDAD PENDIENTE DE
-- JONATHAN: ¿el corte correcto es solo `estado = 'COMPLETADA'` (terminal,
-- costeo ya cerrado — lo que usa este script) o también excluir masas con
-- `fase_actual = 'EMPAQUE'` aunque `estado` todavía no sea COMPLETADA
-- (empaque en progreso, costeo aún no finalizado)? Ver sección 3.6 del
-- resumen de sesión.
--
-- Fecha: 2026-08-20
-- Estado: SOLO VERIFICACIÓN LISTA PARA CORRER. El UPDATE queda comentado
-- al final — NO ejecutar sin aprobación explícita de Jonathan.
-- =====================================================

-- 1. Cuántas filas cambiarían y cuántas quedan excluidas por estar COMPLETADA
SELECT
  count(*) FILTER (WHERE mp.estado <> 'COMPLETADA')            AS filas_a_corregir,
  count(*) FILTER (WHERE mp.estado = 'COMPLETADA')              AS filas_completadas_excluidas,
  count(DISTINCT ppm.sap_item_code) FILTER (WHERE mp.estado <> 'COMPLETADA') AS productos_distintos_a_corregir
FROM productos_por_masa ppm
JOIN sap_articulos sa      ON sa.item_code = ppm.sap_item_code
JOIN masas_produccion mp   ON mp.id = ppm.masa_id
WHERE ppm.unidades_por_paquete <> sa.sales_qty_per_pack;

-- 2. Detalle fila por fila (para revisar antes de aprobar el UPDATE) —
--    incluye los 5 casos de conflicto/gap real de SAP (PANPAQ13, PANPAQ11,
--    PANPAQ05, PANPAQ26, PANPAQ20) SOLO SI sap_articulos ya trae un valor
--    distinto de 1 para ellos (no debería, ver hana_bom_completo.py — a
--    propósito sin fallback por nombre); si aparecen aquí, hay que
--    detenerse y confirmar con Diana antes de incluirlos en el UPDATE.
SELECT
  ppm.id            AS producto_masa_id,
  ppm.masa_id,
  mp.codigo_masa,
  mp.estado         AS estado_masa,
  mp.fase_actual,
  ppm.sap_item_code,
  ppm.producto_nombre,
  ppm.unidades_por_paquete AS actual_productos_por_masa,
  sa.sales_qty_per_pack    AS correcto_sap_articulos
FROM productos_por_masa ppm
JOIN sap_articulos sa      ON sa.item_code = ppm.sap_item_code
JOIN masas_produccion mp   ON mp.id = ppm.masa_id
WHERE ppm.unidades_por_paquete <> sa.sales_qty_per_pack
ORDER BY ppm.sap_item_code, mp.id;

-- =====================================================
-- UPDATE — NO EJECUTAR SIN APROBACIÓN EXPLÍCITA DE JONATHAN.
-- Excluye masas con estado = 'COMPLETADA' (costeo histórico ya cerrado).
-- Ajustar el WHERE si Jonathan confirma que también hay que excluir
-- fase_actual = 'EMPAQUE' con estado distinto de COMPLETADA (ver nota de
-- ambigüedad arriba).
-- =====================================================
-- BEGIN;
--
-- UPDATE productos_por_masa ppm
-- SET unidades_por_paquete = sa.sales_qty_per_pack
-- FROM sap_articulos sa, masas_produccion mp
-- WHERE ppm.sap_item_code = sa.item_code
--   AND ppm.masa_id = mp.id
--   AND ppm.unidades_por_paquete <> sa.sales_qty_per_pack
--   AND mp.estado <> 'COMPLETADA';
--
-- COMMIT;
-- =====================================================
