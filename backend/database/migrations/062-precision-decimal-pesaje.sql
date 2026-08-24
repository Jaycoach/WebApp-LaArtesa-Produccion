-- ============================================================================
-- MIGRACIÓN 062: precisión decimal en pesaje_lotes_consumo.cantidad_kg
-- Fecha: 2026-08-24
-- Motivo: NUMERIC(12,3) solo guarda hasta el gramo (0.001 kg). Cualquier
--         ingrediente traza del BOM por debajo de 0.5 g (ej. AJONJOLI NEGRO,
--         BOM real de staging: 0.00001 kg) se redondeaba a 0.000 al insertar
--         la reserva de lote — violando el CHECK (cantidad_kg > 0) de la
--         misma tabla. Ese INSERT fallido no tenía manejo especial en
--         fases.model.js::updateIngredienteChecklist (solo 409/404 están
--         cubiertos), así que llegaba como excepción no controlada al
--         controller → 500 sin mensaje ("Server Error" vacío en frontend).
--         El ingrediente nunca quedaba insertado en ingredientes_masa/
--         pesaje_lotes_consumo, aunque los demás ingredientes de la misma
--         masa sí se guardaban en el mismo pesaje.
--
--         NUMERIC(12,6) iguala la precisión que ya trae sap_bom_componentes
--         .cantidad (6 decimales en kg) — evita que este mismo problema
--         reaparezca con otros ítems traza del BOM.
-- ============================================================================

BEGIN;

ALTER TABLE pesaje_lotes_consumo
  ALTER COLUMN cantidad_kg TYPE NUMERIC(12,6);

-- Verificación
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'pesaje_lotes_consumo' AND column_name = 'cantidad_kg';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE pesaje_lotes_consumo ALTER COLUMN cantidad_kg TYPE NUMERIC(12,3);
-- COMMIT;
