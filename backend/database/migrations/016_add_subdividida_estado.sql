-- =============================================
-- MIGRACIÓN 016: Agregar estado SUBDIVIDIDA a masas_produccion
-- Fecha: 2026-02-27
-- Contexto: Las masas que se subdividen automáticamente quedaban
--           marcadas como CANCELADA (incorrecto). Se introduce el
--           estado SUBDIVIDIDA para distinguirlas correctamente.
-- =============================================

BEGIN;

-- 1. Eliminar constraint existente (puede o no existir)
ALTER TABLE masas_produccion
DROP CONSTRAINT IF EXISTS check_estado_masa;

-- 2. Agregar constraint actualizado incluyendo SUBDIVIDIDA
ALTER TABLE masas_produccion
ADD CONSTRAINT check_estado_masa CHECK (
  estado IN (
    'PLANIFICACION',
    'PESAJE',
    'AMASADO',
    'DIVISION',
    'FORMADO',
    'FERMENTACION',
    'HORNEADO',
    'COMPLETADA',
    'CANCELADA',
    'SUBDIVIDIDA'
  )
);

-- 3. Corregir masas que quedaron CANCELADA por subdivisión incorrecta
UPDATE masas_produccion
SET estado = 'SUBDIVIDIDA',
    updated_at = NOW()
WHERE fue_subdividida = TRUE
  AND estado = 'CANCELADA';

-- 4. Verificación
SELECT
  estado,
  fue_subdividida,
  COUNT(*) AS total
FROM masas_produccion
WHERE estado IN ('CANCELADA', 'SUBDIVIDIDA')
   OR fue_subdividida = TRUE
GROUP BY estado, fue_subdividida
ORDER BY estado;

COMMIT;
