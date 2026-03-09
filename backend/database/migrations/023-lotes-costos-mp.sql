-- Migration 023: Lotes de materia prima + costos de producción
-- Fecha: 2026-03-09

BEGIN;

-- 1. Tabla de lotes de materia prima sincronizados desde SAP (BatchNumberDetails)
CREATE TABLE IF NOT EXISTS sap_lotes_mp (
  id               SERIAL PRIMARY KEY,
  item_code        VARCHAR(50)   NOT NULL,
  item_name        VARCHAR(200),
  batch            VARCHAR(100)  NOT NULL,
  status           VARCHAR(50),
  admission_date   DATE,
  manufacturing_date DATE,
  expiration_date  DATE,
  ultimo_sync      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_code, batch)
);

CREATE INDEX IF NOT EXISTS idx_lotes_mp_item_code ON sap_lotes_mp(item_code);
CREATE INDEX IF NOT EXISTS idx_lotes_mp_expiration ON sap_lotes_mp(expiration_date);

COMMENT ON TABLE sap_lotes_mp IS 'Lotes de materia prima sincronizados desde SAP BatchNumberDetails';

-- 2. Columnas de costo en ingredientes_masa (costo al momento del pesaje)
ALTER TABLE ingredientes_masa
  ADD COLUMN IF NOT EXISTS costo_unitario_sap  NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_total_mp      NUMERIC(14,4) DEFAULT 0;

COMMENT ON COLUMN ingredientes_masa.costo_unitario_sap IS 'Costo promedio por kg/unidad tomado de sap_inventario_mp al momento del pesaje';
COMMENT ON COLUMN ingredientes_masa.costo_total_mp     IS 'costo_unitario_sap * cantidad_kilos al momento de confirmar pesaje';

-- 3. Tabla de costos de producción por masa
CREATE TABLE IF NOT EXISTS costos_masa (
  id                    SERIAL PRIMARY KEY,
  masa_id               INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE UNIQUE,
  costo_mp_total        NUMERIC(14,4) DEFAULT 0,  -- suma de costo_total_mp de todos los ingredientes
  costo_mo_total        NUMERIC(14,4) DEFAULT 0,  -- mano de obra (futuro)
  costo_cif_total       NUMERIC(14,4) DEFAULT 0,  -- costos indirectos (futuro)
  costo_total_masa      NUMERIC(14,4) DEFAULT 0,  -- suma de los tres anteriores
  kilos_masa_real       NUMERIC(10,3) DEFAULT 0,  -- kilos reales pesados
  costo_por_kilo        NUMERIC(14,4) DEFAULT 0,  -- costo_total_masa / kilos_masa_real
  fecha_calculo_mp      TIMESTAMP,                -- cuándo se calculó el costo MP (al confirmar pesaje)
  fecha_calculo_final   TIMESTAMP,                -- cuándo se calculó el costo final (al empacar)
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE costos_masa IS 'Resumen de costos de producción por masa. MP se calcula al confirmar pesaje. MOD/CIF se agregan en fases posteriores.';

-- 4. Columna de costo MP prorrateado en productos_por_masa
ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS costo_mp_unitario   NUMERIC(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_mp_total_prod NUMERIC(14,4) DEFAULT 0;

COMMENT ON COLUMN productos_por_masa.costo_mp_unitario   IS 'Costo MP por unidad producida = (costo_mp_total_masa / total_kilos_masa) * kilos_por_unidad';
COMMENT ON COLUMN productos_por_masa.costo_mp_total_prod IS 'costo_mp_unitario * unidades_programadas';

-- 5. Verificación
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sap_lotes_mp') THEN
    RAISE NOTICE '✓ sap_lotes_mp creada';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ingredientes_masa' AND column_name = 'costo_unitario_sap') THEN
    RAISE NOTICE '✓ ingredientes_masa: columnas de costo agregadas';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'costos_masa') THEN
    RAISE NOTICE '✓ costos_masa creada';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'productos_por_masa' AND column_name = 'costo_mp_unitario') THEN
    RAISE NOTICE '✓ productos_por_masa: columnas de costo agregadas';
  END IF;
END $$;

COMMIT;