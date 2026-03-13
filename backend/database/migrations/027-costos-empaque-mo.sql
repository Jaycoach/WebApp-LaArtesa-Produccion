-- ============================================================================
-- MIGRACIÓN 027: Costos de producción completos
-- Tablas: tipos_mano_obra, registros_mano_obra, configuracion_etiqueta
-- Columnas: productos_por_masa (costos finales), empaque_detalles (sub_masa_id)
--           sap_inventario_mp (costo_unitario)
-- Fix: HORNEADO → EMPAQUE en progreso_fases
-- ============================================================================
BEGIN;

-- 1. Tabla de tipos de mano de obra con costo/hora
CREATE TABLE IF NOT EXISTS tipos_mano_obra (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  descripcion TEXT,
  costo_hora  NUMERIC(14,2) NOT NULL DEFAULT 0,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

INSERT INTO tipos_mano_obra (nombre, descripcion, costo_hora) VALUES
  ('Operario Pesaje',      'Operario encargado del proceso de pesaje',        15000),
  ('Operario Amasado',     'Operario encargado del proceso de amasado',       15000),
  ('Operario División',    'Operario encargado del proceso de división',      15000),
  ('Operario Formado',     'Operario encargado del proceso de formado',       15000),
  ('Operario Fermentación','Operario encargado del proceso de fermentación',  15000),
  ('Operario Horneado',    'Operario encargado del proceso de horneado',      15000),
  ('Operario Empaque',     'Operario encargado del proceso de empaque',       15000),
  ('Supervisor',           'Supervisor de producción',                        25000)
ON CONFLICT DO NOTHING;

-- 2. Tabla de registros de mano de obra por fase
CREATE TABLE IF NOT EXISTS registros_mano_obra (
  id               SERIAL PRIMARY KEY,
  masa_id          INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
  fase             VARCHAR(30) NOT NULL,
  tipo_mo_id       INTEGER NOT NULL REFERENCES tipos_mano_obra(id),
  horas            NUMERIC(6,2) NOT NULL CHECK (horas > 0),
  costo_calculado  NUMERIC(14,4) NOT NULL DEFAULT 0,
  observaciones    TEXT,
  usuario_id       INTEGER REFERENCES usuarios(id),
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rmo_masa  ON registros_mano_obra(masa_id);
CREATE INDEX IF NOT EXISTS idx_rmo_fase  ON registros_mano_obra(masa_id, fase);

-- 3. Columnas de costo final en productos_por_masa
ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS costo_mo_total        NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_empaque_total   NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_indirecto_total NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_total_final     NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_unitario_final  NUMERIC(14,4) DEFAULT 0;

-- 4. sub_masa_id en empaque_detalles
ALTER TABLE empaque_detalles
  ADD COLUMN IF NOT EXISTS sub_masa_id INTEGER REFERENCES masas_produccion(id);

-- 5. costo_unitario en sap_inventario_mp (para precios de materiales de empaque)
ALTER TABLE sap_inventario_mp
  ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC(14,4) DEFAULT 0;

-- 6. Tabla configuracion_etiqueta
CREATE TABLE IF NOT EXISTS configuracion_etiqueta (
  id               SERIAL PRIMARY KEY,
  sap_item_code    VARCHAR(50) NOT NULL UNIQUE,
  nombre_producto  VARCHAR(200) NOT NULL,
  ingredientes_txt TEXT,
  alergenos_txt    TEXT,
  condiciones_txt  TEXT DEFAULT 'Mantener en lugar fresco y seco',
  registro_invima  VARCHAR(100),
  peso_neto_txt    VARCHAR(100),
  fabricante_txt   VARCHAR(200) DEFAULT 'La Artesa SAS – Bogotá, Colombia',
  activo           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- 7. Nuevas claves en configuracion_sistema
INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES
  ('costo_indirecto_por_kg', '0',
   'Costo indirecto fijo por kg producido en COP (arriendo, servicios, etc.)'),
  ('costo_depreciacion_por_kg', '0',
   'Costo de depreciación de maquinaria por kg producido en COP')
ON CONFLICT (clave) DO NOTHING;

-- 8. Fix: HORNEADO → EMPAQUE — asegurar que las filas EMPAQUE existan
--    en progreso_fases para todas las masas que aún no las tienen
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
  SELECT mp.id, 'EMPAQUE', 'BLOQUEADA', 0
  FROM masas_produccion mp
  WHERE NOT EXISTS (
    SELECT 1 FROM progreso_fases pf
    WHERE pf.masa_id = mp.id AND pf.fase = 'EMPAQUE'
  )
ON CONFLICT DO NOTHING;

-- 9. Columna costo_mo_total en masas_produccion (acumula MO de todas las fases)
ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS costo_mo_total NUMERIC(14,4) DEFAULT 0;

COMMIT;
