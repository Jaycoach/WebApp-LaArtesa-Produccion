-- =============================================
-- Migración 042: Auditoría de usuario en catalogo_tipos_masa
-- Fecha: 2026-07-01
-- Descripción: Agrega trazabilidad de qué usuario realizó el último
--   ajuste de configuración (unidades_pan_por_paquete, dias_vida_util,
--   requiere_formado) sobre un tipo de masa.
-- =============================================

BEGIN;

ALTER TABLE catalogo_tipos_masa
  ADD COLUMN IF NOT EXISTS usuario_id     INTEGER NULL,
  ADD COLUMN IF NOT EXISTS usuario_nombre VARCHAR(150) NULL;

COMMENT ON COLUMN catalogo_tipos_masa.usuario_id     IS 'usuario_id que realizó el último ajuste de configuración';
COMMENT ON COLUMN catalogo_tipos_masa.usuario_nombre IS 'Nombre completo del usuario que realizó el último ajuste (snapshot, mismo patrón que registros_empaque)';

COMMIT;
