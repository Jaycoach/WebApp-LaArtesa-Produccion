-- ============================================================
-- 024: Subdivisión en aprobación + cantidad lotes + agua
-- ============================================================

-- 1. Cantidad disponible por lote en bodega ALMP
ALTER TABLE sap_lotes_mp
  ADD COLUMN IF NOT EXISTS cantidad_disponible NUMERIC(12,3) DEFAULT 0;

-- 2. Límite kg default en configuración
INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion, es_publica)
VALUES ('limite_kg_default', '90', 'NUMBER', 'PRODUCCION',
        'Límite máximo en kg para amasado de masa (tipos no TOSCANO)', false)
ON CONFLICT (clave) DO NOTHING;

-- 3. Ingredientes excluidos de validación de stock
INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion, es_publica)
VALUES ('ingredientes_excluir_stock_validacion', 'MP0007', 'STRING', 'PRODUCCION',
        'Item codes excluidos de validación de stock en pesaje (separados por coma)', false)
ON CONFLICT (clave) DO NOTHING;

-- 4. Costo del agua por litro
INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion, es_publica)
VALUES ('costo_agua_litro', '0', 'NUMBER', 'PRODUCCION',
        'Costo por litro de agua en COP (insumo propio, no se compra directamente)', false)
ON CONFLICT (clave) DO NOTHING;