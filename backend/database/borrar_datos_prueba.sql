-- ============================================================
-- BORRADO COMPLETO DE DATOS DE PRUEBA
-- Ejecutar en orden — las FK en CASCADE se encargan del resto
-- ============================================================

BEGIN;

-- 1. Borrar progreso de fases (FK CASCADE desde masas_produccion)
DELETE FROM progreso_fases
WHERE masa_id IN (SELECT id FROM masas_produccion);

-- 2. Borrar productos por masa
DELETE FROM productos_por_masa
WHERE masa_id IN (SELECT id FROM masas_produccion);

-- 3. Borrar ingredientes de masa
DELETE FROM ingredientes_masa
WHERE masa_id IN (SELECT id FROM masas_produccion);

-- 4. Borrar relaciones orden-masa
DELETE FROM orden_masa_relacion
WHERE masa_id IN (SELECT id FROM masas_produccion);

-- 5. Borrar las masas
DELETE FROM masas_produccion;

-- 6. Borrar historial de sincronizaciones SAP (para poder re-sincronizar)
DELETE FROM sincronizaciones_sap;

-- 7. Verificar que quedó limpio
SELECT 'masas_produccion'     AS tabla, COUNT(*) AS registros FROM masas_produccion
UNION ALL
SELECT 'productos_por_masa'   AS tabla, COUNT(*) AS registros FROM productos_por_masa
UNION ALL
SELECT 'progreso_fases'       AS tabla, COUNT(*) AS registros FROM progreso_fases
UNION ALL
SELECT 'ingredientes_masa'    AS tabla, COUNT(*) AS registros FROM ingredientes_masa
UNION ALL
SELECT 'orden_masa_relacion'  AS tabla, COUNT(*) AS registros FROM orden_masa_relacion
UNION ALL
SELECT 'sincronizaciones_sap' AS tabla, COUNT(*) AS registros FROM sincronizaciones_sap;

COMMIT;
