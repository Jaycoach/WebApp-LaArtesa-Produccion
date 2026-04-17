-- =====================================================
-- Migración 033: Campo delta_ajuste en productos_por_masa
-- Tabla: productos_por_masa
-- Agrega delta_ajuste (INTEGER NULL) para distinguir
-- entre "nunca ajustado por el usuario" (NULL) y
-- "ajustado explícitamente a 0 o cualquier valor" (integer).
--
-- Contexto:
--   En la fase PLANIFICACION, el supervisor puede ajustar
--   las unidades programadas por producto sumando o restando
--   paquetes respecto a las unidades pedidas en SAP.
--   Al aprobar la masa, el backend aplica un delta por defecto
--   de +2 paquetes SOLO a los productos con delta_ajuste IS NULL
--   (nunca tocados). Si el usuario guardó explícitamente cualquier
--   valor (incluso 0), ese valor prevalece y no se toca al aprobar.
-- =====================================================

-- Campo principal: NULL = nunca ajustado manualmente
--                  0    = usuario guardó "sin ajuste"
--                  N    = usuario guardó +N o -N paquetes
ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS delta_ajuste INTEGER DEFAULT NULL;

COMMENT ON COLUMN productos_por_masa.delta_ajuste IS
  'Delta en paquetes guardado explícitamente por el supervisor en PLANIFICACION. '
  'NULL = nunca modificado (al aprobar se aplica +2 paq por defecto). '
  'Cualquier otro valor (incluido 0) = ajuste intencional del usuario, '
  'prevalece sobre el default al momento de aprobar la masa.';