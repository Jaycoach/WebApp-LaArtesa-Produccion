-- ============================================================================
-- MIGRACIÓN 014: Limpiar sub-masas fantasma y resetear masa original
-- Fecha: 2026-02-26
-- Motivo: Las sub-masas 146, 147, 148, 149 fueron creadas sin ingredientes
--         ni productos debido al error "inconsistent types deduced for parameter $3"
--         en inicializarFasesMasa. La masa original 126 queda reseteada para
--         ejecutar la subdivisión correctamente con el código corregido.
-- ============================================================================

BEGIN;

-- 1. Eliminar fases de las sub-masas fantasma
DELETE FROM progreso_fases
WHERE masa_id IN (146, 147, 148, 149);

-- 2. Eliminar relaciones orden-masa de las sub-masas fantasma
DELETE FROM orden_masa_relacion
WHERE masa_id IN (146, 147, 148, 149);

-- 3. Eliminar ingredientes (por si acaso quedó algo)
DELETE FROM ingredientes_masa
WHERE masa_id IN (146, 147, 148, 149);

-- 4. Eliminar productos (por si acaso quedó algo)
DELETE FROM productos_por_masa
WHERE masa_id IN (146, 147, 148, 149);

-- 5. Eliminar las sub-masas fantasma
DELETE FROM masas_produccion
WHERE id IN (146, 147, 148, 149);

-- 6. Resetear la masa original 126 para que pueda volver a procesarse
UPDATE masas_produccion
SET
  fue_subdividida = FALSE,
  estado          = 'PLANIFICACION',
  fase_actual     = 'PLANIFICACION',
  updated_at      = NOW()
WHERE id = 126;

-- 7. Resetear la fase PLANIFICACION de la masa 126 a EN_PROGRESO
UPDATE progreso_fases
SET
  estado                = 'EN_PROGRESO',
  porcentaje_completado = 0,
  fecha_completado      = NULL,
  updated_at            = NOW()
WHERE masa_id = 126 AND fase = 'PLANIFICACION';

-- 8. Verificación final
SELECT
  id,
  codigo_masa,
  nombre_masa,
  estado,
  fue_subdividida,
  es_subdivision,
  subdivision_letra,
  masa_padre_id
FROM masas_produccion
WHERE id = 126 OR masa_padre_id = 126
ORDER BY id;

COMMIT;
