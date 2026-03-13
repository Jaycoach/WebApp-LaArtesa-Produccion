-- =============================================
-- MIGRACIÓN 028: Unidades por paquete, vida útil y fecha vencimiento
-- Sistema ARTESA - La Artesa SAS
-- Fecha: 2026-03-13
-- =============================================
BEGIN;

-- 1. catalogo_tipos_masa: unidades de pan por paquete y días de vida útil
ALTER TABLE catalogo_tipos_masa
  ADD COLUMN IF NOT EXISTS unidades_pan_por_paquete NUMERIC(6,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dias_vida_util            INTEGER      NOT NULL DEFAULT 5;

-- Poblar desde nombre_masa automáticamente (X2, X4, X6, X8, X10, X12)
UPDATE catalogo_tipos_masa SET unidades_pan_por_paquete = 2  WHERE nombre_masa ILIKE '%X2%';
UPDATE catalogo_tipos_masa SET unidades_pan_por_paquete = 4  WHERE nombre_masa ILIKE '%X4%';
UPDATE catalogo_tipos_masa SET unidades_pan_por_paquete = 6  WHERE nombre_masa ILIKE '%X6%';
UPDATE catalogo_tipos_masa SET unidades_pan_por_paquete = 8  WHERE nombre_masa ILIKE '%X8%';
UPDATE catalogo_tipos_masa SET unidades_pan_por_paquete = 10 WHERE nombre_masa ILIKE '%X10%';
UPDATE catalogo_tipos_masa SET unidades_pan_por_paquete = 12 WHERE nombre_masa ILIKE '%X12%';

-- 2. productos_por_masa: override por producto + costo por pan individual
ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS unidades_pan_por_paquete NUMERIC(6,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS costo_pan_unitario        NUMERIC(14,4)         DEFAULT 0;

-- Poblar desde nombre de producto
UPDATE productos_por_masa SET unidades_pan_por_paquete = 2  WHERE producto_nombre ILIKE '%X2%';
UPDATE productos_por_masa SET unidades_pan_por_paquete = 4  WHERE producto_nombre ILIKE '%X4%';
UPDATE productos_por_masa SET unidades_pan_por_paquete = 6  WHERE producto_nombre ILIKE '%X6%';
UPDATE productos_por_masa SET unidades_pan_por_paquete = 8  WHERE producto_nombre ILIKE '%X8%';
UPDATE productos_por_masa SET unidades_pan_por_paquete = 10 WHERE producto_nombre ILIKE '%X10%';
UPDATE productos_por_masa SET unidades_pan_por_paquete = 12 WHERE producto_nombre ILIKE '%X12%';

-- 3. registros_horneado: campo para que el operario registre la fecha de vencimiento
ALTER TABLE registros_horneado
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_sugerida DATE;

COMMIT;
