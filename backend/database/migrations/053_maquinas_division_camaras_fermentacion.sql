-- ============================================================
-- Migración 053: Máquinas de división (Lissete, 12-ago-2026) +
-- catálogo de cámaras de fermentación (nuevo, no existía)
-- ============================================================

BEGIN;

-- 1. Máquinas de división — agregar a las existentes (Conic, Divisora Manual)
--    Capacidad 90 kg en todas por no venir especificada por Lissete.
INSERT INTO maquinas_corte (nombre, tipo, capacidad_kg, activa, observaciones)
VALUES
  ('Formadora 1',       'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Formadora 2',       'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Boleadora 1',       'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Divisora 1',        'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Konig 1',           'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Manual',            'MANUAL',     90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Formadora de pita', 'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Multidrop',         'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026'),
  ('Unifiller',         'AUTOMATICA', 90.00, TRUE, 'Agregada UAT — Lissete 12-ago-2026')
ON CONFLICT (nombre) DO NOTHING;

-- 2. Catálogo de cámaras de fermentación (nuevo)
CREATE TABLE IF NOT EXISTS camaras_fermentacion (
    id            SERIAL PRIMARY KEY,
    uuid          UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    nombre        VARCHAR(100) NOT NULL UNIQUE,
    tipo          VARCHAR(50), -- AMBIENTE, FRIO, CRECIMIENTO
    activa        BOOLEAN DEFAULT TRUE,
    observaciones TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO camaras_fermentacion (nombre, tipo)
VALUES
  ('Pijama',                  'AMBIENTE'),
  ('Cuarto de crecimiento 1', 'CRECIMIENTO'),
  ('Cuarto Frio',             'FRIO')
ON CONFLICT (nombre) DO NOTHING;

-- 3. Referenciar la cámara en el registro de fermentación
ALTER TABLE registros_fermentacion
  ADD COLUMN IF NOT EXISTS camara_id INTEGER REFERENCES camaras_fermentacion(id),
  ADD COLUMN IF NOT EXISTS camara_nombre VARCHAR(100);

COMMENT ON COLUMN registros_fermentacion.camara_id IS
  'Cámara física usada para esta fermentación — catálogo camaras_fermentacion';

-- 4. Verificación
SELECT 'maquinas_corte' AS tabla, COUNT(*) FROM maquinas_corte
UNION ALL
SELECT 'camaras_fermentacion', COUNT(*) FROM camaras_fermentacion;

COMMIT;
