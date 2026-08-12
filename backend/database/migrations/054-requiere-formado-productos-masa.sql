-- ============================================================================
-- MIGRACIÓN 054: requiere_formado en productos_por_masa (snapshot desde SAP)
-- Fecha: 2026-08-12
-- Motivo: U_JZ_Formado (SAP) indica si un producto/SKU pasa por la fase de
--         Formado antes de Fermentación. Hoy requiere_formado solo existe en
--         catalogo_tipos_masa (todo el tipo de masa) — se necesita a nivel de
--         producto/SKU individual para enrutar por producto en División/
--         Formado (diseño y consumo: Fase 5, aparte de esta migración).
--         Columna creada aquí sin poblar todavía — solo sincronización SAP
--         (sap.service.js) queda lista en esta fase.
-- ============================================================================

BEGIN;

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS requiere_formado BOOLEAN NOT NULL DEFAULT FALSE;

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'productos_por_masa' AND column_name = 'requiere_formado';

COMMIT;
