-- Migration 022: División parcial + tabla inventario MP
-- Fecha: 2026-03-03

-- 1. Agregar columnas de división parcial en productos_por_masa
ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS unidades_faltantes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS division_parcial   BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN productos_por_masa.unidades_faltantes IS 'Unidades que faltaron cortar respecto a unidades_ajustadas';
COMMENT ON COLUMN productos_por_masa.division_parcial   IS 'TRUE si la división fue parcial (faltantes > 0)';

-- 2. Crear tabla de inventario de materia prima sincronizado desde SAP
CREATE TABLE IF NOT EXISTS sap_inventario_mp (
  id              SERIAL PRIMARY KEY,
  item_code       VARCHAR(50)    NOT NULL UNIQUE,
  item_name       VARCHAR(200),
  uom             VARCHAR(20),
  stock_almp      NUMERIC(14,4)  DEFAULT 0,
  committed_almp  NUMERIC(14,4)  DEFAULT 0,
  ordered_almp    NUMERIC(14,4)  DEFAULT 0,
  costo_promedio  NUMERIC(14,4)  DEFAULT 0,
  ultimo_sync     TIMESTAMP      DEFAULT NOW(),
  created_at      TIMESTAMP      DEFAULT NOW(),
  updated_at      TIMESTAMP      DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sap_inventario_mp_item_code ON sap_inventario_mp (item_code);

COMMENT ON TABLE sap_inventario_mp IS 'Cache de stock de materia prima sincronizado desde SAP (bodega ALMP)';
