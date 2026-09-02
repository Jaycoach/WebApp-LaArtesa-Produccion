-- ============================================================================
-- MIGRACIÓN 073: marcar planes de lotes huérfanos en masas_lotes_simulados
-- Fecha: 2026-09-02
--
-- Motivo (diagnóstico completo: masa 971/747 en producción, sesión
-- 2026-09-02): updateUnidadesProgramadas (PATCH
-- /api/masas/:masaId/productos/:productoId, masas.controller.js) no
-- verificaba masas_produccion.fue_subdividida antes de aceptar un ajuste de
-- delta. Una masa padre ya subdividida queda con fase_actual='PLANIFICACION'
-- a propósito (Fix B, sap.controller.js:696-711) y su propio
-- ingredientes_masa nunca tiene filas pesado=true (el pesaje real ocurre en
-- las sub-masas hijas) -- los dos guards que sí existían no detectaban este
-- caso. Resultado: se podía editar productos_por_masa del padre y disparar
-- simularPlanLotes()/guardarPlanLotes() (DELETE+INSERT completo de
-- masas_lotes_simulados) con datos que ya no reflejaban la producción
-- física real -- confirmado en producción con las masas 971 (2026-09-02) y
-- 747 (2026-08-29), ambas re-simuladas HORAS después de que sus sub-masas
-- ya estaban en EMPAQUE/COMPLETADA. El fix del guard de entrada va en
-- commit aparte (masas.controller.js, "Fix B" replicado); esta migración
-- solo atiende el DATO ya escrito, sin tocar el guard.
--
-- guardarPlanLotes() reemplaza masas_lotes_simulados completo (DELETE+INSERT)
-- cada vez que se re-simula, así que NO existe forma de recuperar el plan
-- original (5 tandas, en el caso de la masa 971) desde esta tabla -- se
-- perdió al sobrescribirse. Esta migración NO intenta reconstruirlo. Se
-- limita a dejar trazabilidad de que la fila ACTUAL de masas_lotes_simulados
-- para esas masas ya no representa la producción física real (sus sub-masas
-- reales, masas_produccion.masa_padre_id, fueron creadas ANTES de la última
-- re-simulación) -- no se borra nada, no se intenta "corregir" el número de
-- tandas.
--
-- Detección: misma query de auditoría del diagnóstico (masas con
-- fue_subdividida=true cuyo masas_lotes_simulados.simulado_en es posterior
-- a la creación de su primera sub-masa hija real).
-- ============================================================================

BEGIN;

ALTER TABLE masas_lotes_simulados
  ADD COLUMN IF NOT EXISTS plan_obsoleto BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE masas_lotes_simulados
  ADD COLUMN IF NOT EXISTS obsoleto_motivo TEXT;

COMMENT ON COLUMN masas_lotes_simulados.plan_obsoleto IS
  'TRUE si esta fila fue re-simulada (guardarPlanLotes) DESPUÉS de que la masa ya tenía sub-masas hijas reales creadas -- el plan ya no representa la producción física real. Ver migración 073 y updateUnidadesProgramadas (masas.controller.js) fue_subdividida guard.';

COMMENT ON COLUMN masas_lotes_simulados.obsoleto_motivo IS
  'Detalle de por qué plan_obsoleto=TRUE (fecha de re-simulación vs. fecha de creación de la primera sub-masa hija real).';

-- Marca (sin borrar) los casos huérfanos existentes HOY -- no reintenta
-- recalcular nada, solo dejar constancia. Si esta migración se corre de
-- nuevo más adelante, vuelve a marcar cualquier caso nuevo que aparezca
-- (idempotente: UPDATE por condición, no por lista fija de IDs).
UPDATE masas_lotes_simulados mls
SET plan_obsoleto = TRUE,
    obsoleto_motivo = format(
      'Plan re-simulado en %s, %s después de que la primera sub-masa hija real (masa_padre_id=%s) ya existía desde %s. Ver migración 073.',
      mls.simulado_en,
      (mls.simulado_en - primera_hija.creada),
      mls.masa_id,
      primera_hija.creada
    )
FROM (
  SELECT mp.id AS masa_id,
         (SELECT MIN(h.created_at) FROM masas_produccion h WHERE h.masa_padre_id = mp.id) AS creada
  FROM masas_produccion mp
  WHERE mp.fue_subdividida = true
) AS primera_hija
WHERE primera_hija.masa_id = mls.masa_id
  AND primera_hija.creada IS NOT NULL
  AND mls.simulado_en > primera_hija.creada
  AND mls.plan_obsoleto = FALSE;

-- Verificación
DO $$
DECLARE
  total_marcadas INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_marcadas FROM masas_lotes_simulados WHERE plan_obsoleto = TRUE;
  RAISE NOTICE '✓ Migración 073 aplicada: % fila(s) de masas_lotes_simulados marcadas como plan_obsoleto=TRUE', total_marcadas;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE masas_lotes_simulados DROP COLUMN IF EXISTS obsoleto_motivo;
-- ALTER TABLE masas_lotes_simulados DROP COLUMN IF EXISTS plan_obsoleto;
-- COMMIT;
