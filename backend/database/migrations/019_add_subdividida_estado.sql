BEGIN;

ALTER TABLE masas_produccion 
DROP CONSTRAINT IF EXISTS check_estado_masa;

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

UPDATE masas_produccion
SET estado = 'SUBDIVIDIDA'
WHERE fue_subdividida = TRUE
  AND estado = 'CANCELADA';

COMMIT;