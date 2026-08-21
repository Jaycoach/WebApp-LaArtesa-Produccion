-- ============================================================================
-- MIGRACIÓN 060: requiere_formado en sap_articulos (dato maestro per-producto)
-- Fecha: 2026-08-21
-- Motivo: U_JZ_Formado (SAP) hoy solo se lee al vuelo durante sincronizarDesdeOV
--         (sap.service.js:559, sap.controller.js:1024-1027) y aterriza en
--         productos_por_masa.requiere_formado (migración 054) — dato POR MASA,
--         no reutilizable como maestro. Se agrega la misma columna a
--         sap_articulos para que sincronizarInventarioMP (único dueño de
--         sap_articulos desde 3f4796d, sección 3.9) la resuelva igual que
--         tamanio/forma/peso_masa_dividida/dias_vencimiento — insumo para el
--         futuro bloqueo de aprobación por dato maestro incompleto (Tarea B,
--         sesión 2026-08-21, diseño sin implementar todavía).
--         El flujo de OV (sap.service.js:559, sap.controller.js:1024-1027)
--         NO se toca — sigue leyendo U_JZ_Formado al vuelo como hoy. Esta
--         columna es un dato adicional consolidado en sap_articulos, no un
--         reemplazo del campo existente en productos_por_masa.
-- ============================================================================

BEGIN;

ALTER TABLE sap_articulos
  ADD COLUMN IF NOT EXISTS requiere_formado BOOLEAN NOT NULL DEFAULT FALSE;

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'sap_articulos' AND column_name = 'requiere_formado';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE sap_articulos DROP COLUMN IF EXISTS requiere_formado;
-- COMMIT;
