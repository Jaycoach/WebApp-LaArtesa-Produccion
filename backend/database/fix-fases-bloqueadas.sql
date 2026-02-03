-- =====================================================
-- SCRIPT PARA CORREGIR FASES BLOQUEADAS
-- =====================================================
-- Este script corrige el problema donde las fases de PLANIFICACION
-- están al 100% EN_PROGRESO pero no están COMPLETADAS, lo que
-- impide el acceso a la fase de PESAJE.
--
-- Fecha: 2026-02-03
-- =====================================================

BEGIN;

-- 1. Actualizar todas las fases de PLANIFICACION que están EN_PROGRESO al 100%
--    y cambiarlas a COMPLETADA
UPDATE progreso_fases
SET estado = 'COMPLETADA',
    fecha_completado = CURRENT_TIMESTAMP
WHERE fase = 'PLANIFICACION'
  AND estado = 'EN_PROGRESO'
  AND porcentaje_completado = 100;

-- 2. Desbloquear las fases de PESAJE que están BLOQUEADAS
--    (solo si su correspondiente PLANIFICACION está COMPLETADA)
UPDATE progreso_fases pf_pesaje
SET estado = 'EN_PROGRESO',
    fecha_inicio = CURRENT_TIMESTAMP
WHERE pf_pesaje.fase = 'PESAJE'
  AND pf_pesaje.estado = 'BLOQUEADA'
  AND EXISTS (
    SELECT 1
    FROM progreso_fases pf_plan
    WHERE pf_plan.masa_id = pf_pesaje.masa_id
      AND pf_plan.fase = 'PLANIFICACION'
      AND pf_plan.estado = 'COMPLETADA'
  );

-- 3. Verificar los cambios realizados
SELECT
    m.codigo_masa,
    m.tipo_masa,
    m.nombre_masa,
    pf.fase,
    pf.estado,
    pf.porcentaje_completado
FROM progreso_fases pf
INNER JOIN masas_produccion m ON pf.masa_id = m.id
WHERE m.fecha_produccion >= '2026-02-03'
  AND pf.fase IN ('PLANIFICACION', 'PESAJE')
ORDER BY m.codigo_masa, pf.fase;

-- Resumen de cambios
SELECT
    'Fases de PLANIFICACION actualizadas a COMPLETADA: ' ||
    (SELECT COUNT(*) FROM progreso_fases WHERE fase = 'PLANIFICACION' AND estado = 'COMPLETADA') ||
    ' | Fases de PESAJE desbloqueadas: ' ||
    (SELECT COUNT(*) FROM progreso_fases WHERE fase = 'PESAJE' AND estado = 'EN_PROGRESO')
    AS resumen;

COMMIT;

-- =====================================================
-- SCRIPT COMPLETADO
-- =====================================================
