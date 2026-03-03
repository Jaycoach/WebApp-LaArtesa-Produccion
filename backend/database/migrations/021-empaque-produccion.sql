-- ============================================================
-- MIGRACIÓN 021: Módulo de Empaque
-- Sistema ARTESA — La Artesa SAS
-- Fecha: 2026-03-03
--
-- Cambios:
--   1. Ampliar CHECK constraints de masas_produccion para incluir EMPAQUE
--   2. Ampliar CHECK constraint de progreso_fases para incluir EMPAQUE
--   3. Crear tabla registros_empaque (cabecera)
--   4. Crear tabla empaque_detalles (por producto)
--   5. Insertar fase EMPAQUE en masas existentes con HORNEADO completado
-- ============================================================

BEGIN;

-- ============================================================
-- 1. masas_produccion — ampliar CHECK de fase_actual y estado
-- ============================================================

ALTER TABLE masas_produccion
  DROP CONSTRAINT IF EXISTS check_fase_actual;

ALTER TABLE masas_produccion
  ADD CONSTRAINT check_fase_actual CHECK (
    fase_actual IN (
      'PLANIFICACION','PESAJE','AMASADO','DIVISION',
      'FORMADO','FERMENTACION','HORNEADO','EMPAQUE'
    )
  );

ALTER TABLE masas_produccion
  DROP CONSTRAINT IF EXISTS check_estado_masa;

ALTER TABLE masas_produccion
  ADD CONSTRAINT check_estado_masa CHECK (
    estado IN (
      'PLANIFICACION','PESAJE','AMASADO','DIVISION',
      'FORMADO','FERMENTACION','HORNEADO','EN_PROCESO',
      'COMPLETADA','CANCELADA'
    )
  );

-- ============================================================
-- 2. progreso_fases — ampliar CHECK de fase
-- ============================================================

ALTER TABLE progreso_fases
  DROP CONSTRAINT IF EXISTS check_fase;

ALTER TABLE progreso_fases
  ADD CONSTRAINT check_fase CHECK (
    fase IN (
      'PLANIFICACION','PESAJE','AMASADO','DIVISION',
      'FORMADO','FERMENTACION','HORNEADO','EMPAQUE'
    )
  );

-- ============================================================
-- 3. Tabla registros_empaque (cabecera)
-- ============================================================

CREATE TABLE IF NOT EXISTS registros_empaque (
  id                 SERIAL PRIMARY KEY,
  uuid               UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
  masa_id            INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

  fecha_vencimiento  DATE NOT NULL,
  estado             VARCHAR(20) NOT NULL DEFAULT 'EN_PROGRESO',
  -- EN_PROGRESO | COMPLETADO

  -- Auditoría de usuario
  usuario_id         INTEGER REFERENCES usuarios(id),
  usuario_nombre     VARCHAR(200),
  observaciones      TEXT,

  -- Fechas
  fecha_registro     TIMESTAMP DEFAULT NOW(),
  fecha_completado   TIMESTAMP,
  fecha_actualizacion TIMESTAMP DEFAULT NOW(),

  CONSTRAINT check_estado_empaque CHECK (estado IN ('EN_PROGRESO','COMPLETADO')),
  UNIQUE (masa_id)
);

CREATE INDEX IF NOT EXISTS idx_registros_empaque_masa ON registros_empaque(masa_id);

COMMENT ON TABLE registros_empaque IS 'Cabecera del proceso de empaque por masa';

-- ============================================================
-- 4. Tabla empaque_detalles (por producto)
-- ============================================================

CREATE TABLE IF NOT EXISTS empaque_detalles (
  id                   SERIAL PRIMARY KEY,
  empaque_id           INTEGER NOT NULL REFERENCES registros_empaque(id) ON DELETE CASCADE,
  producto_masa_id     INTEGER NOT NULL REFERENCES productos_por_masa(id) ON DELETE CASCADE,

  unidades_empacadas   INTEGER NOT NULL DEFAULT 0,
  unidades_merma       INTEGER NOT NULL DEFAULT 0,

  fecha_actualizacion  TIMESTAMP DEFAULT NOW(),

  UNIQUE (empaque_id, producto_masa_id)
);

CREATE INDEX IF NOT EXISTS idx_empaque_detalles_empaque ON empaque_detalles(empaque_id);
CREATE INDEX IF NOT EXISTS idx_empaque_detalles_producto ON empaque_detalles(producto_masa_id);

COMMENT ON TABLE empaque_detalles IS 'Detalle de unidades empacadas y merma por producto en cada empaque';

-- ============================================================
-- 5. Insertar fase EMPAQUE en masas que ya tienen HORNEADO
--    Usar ON CONFLICT para evitar duplicados si se re-ejecuta
-- ============================================================

INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, created_at, updated_at)
SELECT
  mp.id,
  'EMPAQUE',
  CASE
    WHEN pf.estado = 'COMPLETADA' THEN 'BLOQUEADA'   -- HORNEADO completado → EMPAQUE disponible para iniciar
    ELSE 'BLOQUEADA'
  END,
  0,
  NOW(),
  NOW()
FROM masas_produccion mp
JOIN progreso_fases pf ON pf.masa_id = mp.id AND pf.fase = 'HORNEADO'
WHERE NOT EXISTS (
  SELECT 1 FROM progreso_fases pf2
  WHERE pf2.masa_id = mp.id AND pf2.fase = 'EMPAQUE'
)
ON CONFLICT (masa_id, fase) DO NOTHING;

-- ============================================================
-- 6. Verificación final
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'registros_empaque'
  ) THEN
    RAISE NOTICE '✓ Tabla registros_empaque creada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se creó registros_empaque';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'empaque_detalles'
  ) THEN
    RAISE NOTICE '✓ Tabla empaque_detalles creada correctamente';
  ELSE
    RAISE EXCEPTION '✗ Error: no se creó empaque_detalles';
  END IF;

  RAISE NOTICE '✓ Migración 021 completada — Módulo EMPAQUE listo';
END $$;

COMMIT;
