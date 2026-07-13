-- ============================================================================
-- MIGRACIÓN 046: Atributos SAP - Tamaño, Forma, Decoración, Peso máx. división
-- Fecha: 2026-07-13
-- Motivo: Nuevos UDF/UDT creados en SAP (U_JZ_Tamanio, U_JZ_Forma,
--         U_JZ_Decoracion, U_JZ_MaxDiv) para el punto 1.9 del alcance.
--         "Familia de ensamble" queda fuera — ya se resuelve vía tipo_masa
--         (ej. GOLD vs PERRO), confirmado en transcripción reunión 3-jul-2026.
-- ============================================================================

BEGIN;

-- 1. Tamaño y Forma — mismo patrón que gramaje/multiplo_divisor
ALTER TABLE sap_articulos
  ADD COLUMN IF NOT EXISTS tamanio VARCHAR(50),
  ADD COLUMN IF NOT EXISTS forma   VARCHAR(50);

-- 2. Snapshot en productos_por_masa (igual que gramaje_unitario, multiplo_divisor)
ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS tamanio VARCHAR(50),
  ADD COLUMN IF NOT EXISTS forma   VARCHAR(50);

-- 3. Decoración — es atributo de INGREDIENTE/componente, no de producto
--    (igual patrón que es_empaque, migración 015)
ALTER TABLE sap_bom_componentes
  ADD COLUMN IF NOT EXISTS es_decoracion BOOLEAN DEFAULT FALSE;

ALTER TABLE ingredientes_masa
  ADD COLUMN IF NOT EXISTS es_decoracion BOOLEAN DEFAULT FALSE;

-- 4. Peso máximo de división por tipo de masa (reemplaza límites hardcodeados
--    LIMITE_KG_TOSCANO=130 / LIMITE_KG_DEFAULT=90 en fases.controller.js)
--    NULL = usar default 90kg en código; valor = límite específico de Kevin.
ALTER TABLE catalogo_tipos_masa
  ADD COLUMN IF NOT EXISTS peso_maximo_division NUMERIC(10,2);

-- 5. Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'sap_articulos' AND column_name IN ('tamanio','forma')
ORDER BY column_name;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'productos_por_masa' AND column_name IN ('tamanio','forma')
ORDER BY column_name;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('sap_bom_componentes','ingredientes_masa') AND column_name = 'es_decoracion'
ORDER BY table_name;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'catalogo_tipos_masa' AND column_name = 'peso_maximo_division';

COMMIT;