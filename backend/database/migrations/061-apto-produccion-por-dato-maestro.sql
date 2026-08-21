-- ============================================================================
-- MIGRACIÓN 061: bloqueo de aprobación por producto — dato maestro incompleto
-- Fecha: 2026-08-21
-- Motivo: tamanio/forma/peso_masa_dividida/multiplo_divisor/sales_qty_per_pack
--         en sap_articulos reciben un fallback plausible (aplicarFallbacksAtributos/
--         resolverUnidadesPorPaquete en sap.service.js) para que los cálculos no
--         rompan por división por cero — pero eso significa que esas columnas
--         casi nunca quedan NULL, aunque SAP nunca haya tenido el UDF real
--         configurado. Se agrega una señal aparte, calculada sobre el UDF
--         CRUDO (sap_articulos.campos_incompletos), y el flag por producto
--         que usa aprobarMasaCore para permitir que la masa avance con los
--         productos aptos mientras deja marcados los que no.
--
--         dias_vencimiento no tiene fallback (queda NULL de verdad cuando
--         falta) — se incluye igual en campos_incompletos por consistencia
--         con el resto de la validación, no porque necesite el mismo truco.
--
--         requiere_formado (migración 060) queda EXCLUIDO a propósito de esta
--         validación — es un boolean con valor propio del producto (false es
--         una respuesta válida, no "falta el dato"), y excluirlo del chequeo
--         de aprobación evita el riesgo de ruteo de Formado señalado en la
--         investigación previa (fases.model.js:622-638: "se abre FORMADO si
--         AL MENOS UN producto de la masa lo requiere" — marcar mal ese campo
--         como incompleto podría hacer que toda la masa se salte Formado).
-- ============================================================================

BEGIN;

ALTER TABLE sap_articulos
  ADD COLUMN IF NOT EXISTS campos_incompletos TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS apto_produccion BOOLEAN NOT NULL DEFAULT TRUE;

-- Verificación
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE (table_name = 'sap_articulos' AND column_name = 'campos_incompletos')
   OR (table_name = 'productos_por_masa' AND column_name = 'apto_produccion');

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE productos_por_masa DROP COLUMN IF EXISTS apto_produccion;
-- ALTER TABLE sap_articulos DROP COLUMN IF EXISTS campos_incompletos;
-- COMMIT;
