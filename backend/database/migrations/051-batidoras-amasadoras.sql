-- Migración 051: Normalizar catálogo de amasadoras y agregar Batidora 1/2 (B8)
--
-- Contexto: el frontend (AmasadoMasa.tsx) tenía las opciones del campo "Amasadora"
-- hardcodeadas ("Amasadora 1/2/3"), desincronizadas de los nombres reales en la
-- tabla `amasadoras` ("Amasadora Industrial 1/2", "Amasadora Grande",
-- "Amasadora Pastelería"). Se decide que la tabla `amasadoras` sea la única
-- fuente de verdad; el frontend deja de hardcodear y consulta un endpoint nuevo.
--
-- Reutiliza los IDs existentes (no rompe la FK registros_amasado.amasadora_id):
--   id=1: "Amasadora Industrial 1" -> "Amasadora 1"   (6 registros históricos, no se alteran)
--   id=2: "Amasadora Industrial 2" -> "Amasadora 2"   (4 registros históricos, no se alteran)
--   id=3: "Amasadora Grande"       -> "Amasadora 3"   (1 registro histórico, no se altera)
--   id=4: "Amasadora Pastelería"   -> "Batidora 1"    (0 registros históricos, confirmado)
--   id=5: (nueva fila)             -> "Batidora 2"
--
-- IMPORTANTE: registros_amasado.amasadora_nombre se guarda como snapshot en el
-- momento del registro (fases.controller.js), no como join en vivo. Renombrar
-- filas en `amasadoras` NO altera los históricos ya persistidos.
--
-- capacidad_kg = 50 para Batidora 1 y 2, confirmado por Jonathan (valor inicial,
-- corresponde a la capacidad que maneja la mayoría de masas).

BEGIN;

UPDATE amasadoras SET
  nombre = 'Amasadora 1',
  codigo = 'AMA-01',
  updated_at = NOW()
WHERE id = 1;

UPDATE amasadoras SET
  nombre = 'Amasadora 2',
  codigo = 'AMA-02',
  updated_at = NOW()
WHERE id = 2;

UPDATE amasadoras SET
  nombre = 'Amasadora 3',
  codigo = 'AMA-03',
  updated_at = NOW()
WHERE id = 3;

UPDATE amasadoras SET
  nombre = 'Batidora 1',
  codigo = 'BAT-01',
  capacidad_kg = 50.00,
  tipo = 'BATIDORA',
  observaciones = 'Renombrada desde Amasadora Pastelería (id=4, sin registros históricos previos)',
  updated_at = NOW()
WHERE id = 4;

INSERT INTO amasadoras (nombre, codigo, capacidad_kg, tipo, activa, observaciones)
VALUES ('Batidora 2', 'BAT-02', 50.00, 'BATIDORA', true, 'Agregada en B8 (Alcance Fixes 03-ago-2026)');

COMMIT;

-- Verificación post-migración (ejecutar manualmente):
-- SELECT id, nombre, codigo, capacidad_kg, tipo, activa FROM amasadoras ORDER BY id;