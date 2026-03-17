-- =============================================
-- MIGRACIÓN 029: Insertar fila EMPAQUE en progreso_fases
-- para todas las masas existentes que no la tienen.
-- También amplía el CHECK constraint para admitir estado PENDIENTE.
-- =============================================
BEGIN;

-- 1. Ampliar check_estado_progreso para incluir PENDIENTE
ALTER TABLE progreso_fases DROP CONSTRAINT IF EXISTS check_estado_progreso;
ALTER TABLE progreso_fases
  ADD CONSTRAINT check_estado_progreso CHECK (
    estado IN ('BLOQUEADA', 'PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'REQUIERE_ATENCION')
  );

-- 2. Insertar fila EMPAQUE para masas que no la tienen
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
SELECT
  mp.id,
  'EMPAQUE',
  CASE
    WHEN mp.estado = 'COMPLETADA'
      THEN 'COMPLETADA'
    WHEN mp.fase_actual = 'EMPAQUE'
      AND EXISTS (
        SELECT 1 FROM progreso_fases pf2
        WHERE pf2.masa_id = mp.id AND pf2.fase = 'HORNEADO' AND pf2.estado = 'COMPLETADA'
      )
      THEN 'EN_PROGRESO'
    WHEN mp.estado IN ('APROBADA', 'EN_PROCESO', 'PENDIENTE')
      THEN 'PENDIENTE'
    ELSE 'BLOQUEADA'
  END,
  CASE WHEN mp.estado = 'COMPLETADA' THEN 100 ELSE 0 END
FROM masas_produccion mp
WHERE mp.estado NOT IN ('SUBDIVIDIDA', 'CANCELADA')
  AND NOT EXISTS (
    SELECT 1 FROM progreso_fases pf
    WHERE pf.masa_id = mp.id AND pf.fase = 'EMPAQUE'
  )
ON CONFLICT (masa_id, fase) DO NOTHING;

-- Verificación
SELECT estado, COUNT(*) FROM progreso_fases WHERE fase = 'EMPAQUE' GROUP BY estado ORDER BY estado;

COMMIT;
