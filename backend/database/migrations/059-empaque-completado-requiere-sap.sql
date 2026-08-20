-- =====================================================
-- Migración 059: Empaque COMPLETADO exige DocEntry real de SAP
-- Fecha: 2026-08-20
--
-- Bug real en producción (masas 1918, 1944, 1971, 1975): la fase EMPAQUE
-- podía quedar marcada COMPLETADA sin que se hubiera guardado el detalle
-- de unidades empacadas ni transmitido nada a SAP. El fix a nivel de
-- aplicación (completarEmpaque / EmpaqueMasa.tsx, mismo día) ya bloquea
-- esto en el controller, pero esa garantía depende de que TODO el código
-- que pueda tocar estas tablas (hoy y en el futuro: otros endpoints,
-- scripts, migraciones de datos, un psql manual) pase por esa misma
-- función. Esta migración mueve la regla a la base de datos para que sea
-- imposible de saltarse, venga de donde venga el UPDATE.
--
-- Evidencia de semántica de columnas (backend/src/controllers/empaque.controller.js):
--   - sap_doc_entry_entrada / sap_doc_num_entrada / sap_error_entrada
--     → paso 10, POST /InventoryGenEntries (líneas ~691-771). Es la ENTRADA
--       de PRODUCTO TERMINADO al almacén PROTERMI (comentario línea 691:
--       "Entrada de mercancía SAP (InventoryGenEntries)"; línea 745:
--       UPDATE ... SET sap_doc_entry_entrada = $1 ...).
--   - sap_doc_entry_salida / sap_doc_num_salida / sap_error_salida
--     → paso 11, POST /InventoryGenExits (líneas ~785-871). Es la SALIDA/
--       CONSUMO de MATERIALES DE EMPAQUE del almacén ALEMP (comentario
--       línea 785: "Salida de materiales de empaque SAP (InventoryGenExits)";
--       línea 821: UPDATE ... SET sap_doc_entry_salida = $1 ...).
--   No se encontró ningún escenario de negocio donde uno de los dos pueda
--   quedar NULL con estado COMPLETADO sin ser un bug: el propio guard de
--   idempotencia (líneas 520-533) solo considera el empaque "ya enviado"
--   cuando AMBOS (yaEntrada && yaSalida) están presentes, y el fix de
--   aplicación de esta misma sesión exige ambos DocEntry antes de marcar
--   COMPLETADO. Por eso el CHECK de abajo exige los dos sin excepción.
--
-- empaque_consumo_materiales: es detalle de CONSECUENCIA (una fila por
-- material consumido) de un envío de salida ya exitoso — se inserta en el
-- mismo bloque que escribe sap_doc_entry_salida (líneas ~825-840), con las
-- mismas líneas (docLines) que alimentan el POST a SAP. No puede haber
-- sap_doc_entry_salida NOT NULL sin sus filas de consumo correspondientes
-- (o viceversa) porque ambas se escriben en la misma transacción a partir
-- del mismo array. No agrega ninguna condición que el CHECK de
-- registros_empaque no cubra ya, así que NO se valida por separado aquí
-- (evita una segunda fuente de verdad redundante).
--
-- Diseño:
--   1. CHECK constraint sobre registros_empaque (una sola fila, columnas
--      en la misma tabla) — estado = 'COMPLETADO' exige ambos DocEntry.
--   2. Trigger BEFORE INSERT/UPDATE en progreso_fases (cruza con
--      registros_empaque) — fase = 'EMPAQUE' y estado = 'COMPLETADA' exige
--      que exista un registros_empaque en estado COMPLETADO con ambos
--      DocEntry para esa masa. Cubre el caso de que alguien marque
--      progreso_fases/masas_produccion como completados sin pasar por
--      completarEmpaque en absoluto (el CHECK de (1) no alcanza a cubrir
--      esto porque vive en otra tabla).
--
-- Se aplica de forma normal (sin NOT VALID): no hay datos de producción
-- que preservar (deploy a producción retenido hasta validar staging;
-- los datos actuales en staging son de prueba, sin valor de continuidad).
-- =====================================================

BEGIN;

-- ============================================================
-- 1. CHECK constraint — registros_empaque.estado = 'COMPLETADO'
--    exige DocEntry real de entrada Y salida
-- ============================================================

ALTER TABLE registros_empaque
  DROP CONSTRAINT IF EXISTS check_empaque_completado_requiere_sap;

ALTER TABLE registros_empaque
  ADD CONSTRAINT check_empaque_completado_requiere_sap CHECK (
    estado <> 'COMPLETADO'
    OR (sap_doc_entry_entrada IS NOT NULL AND sap_doc_entry_salida IS NOT NULL)
  );

-- ============================================================
-- 2. Trigger — progreso_fases (fase EMPAQUE → COMPLETADA) exige
--    registros_empaque COMPLETADO con ambos DocEntry para la misma masa
-- ============================================================

CREATE OR REPLACE FUNCTION fn_validar_empaque_completado_sap()
RETURNS TRIGGER AS $$
DECLARE
  v_estado_empaque    VARCHAR(20);
  v_doc_entry_entrada INTEGER;
  v_doc_entry_salida  INTEGER;
BEGIN
  -- Solo nos interesa la transición hacia EMPAQUE=COMPLETADA
  IF NEW.fase IS DISTINCT FROM 'EMPAQUE' OR NEW.estado IS DISTINCT FROM 'COMPLETADA' THEN
    RETURN NEW;
  END IF;

  -- Si ya estaba COMPLETADA y solo cambian otros campos (observaciones,
  -- porcentaje, etc.), no re-validar en cada UPDATE posterior.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'COMPLETADA' THEN
    RETURN NEW;
  END IF;

  SELECT estado, sap_doc_entry_entrada, sap_doc_entry_salida
    INTO v_estado_empaque, v_doc_entry_entrada, v_doc_entry_salida
    FROM registros_empaque
    WHERE masa_id = NEW.masa_id;

  IF v_estado_empaque IS NULL THEN
    RAISE EXCEPTION 'No se puede marcar EMPAQUE como COMPLETADA para la masa % : no existe registro de empaque (registros_empaque) para esta masa.', NEW.masa_id;
  END IF;

  IF v_estado_empaque <> 'COMPLETADO' THEN
    RAISE EXCEPTION 'No se puede marcar EMPAQUE como COMPLETADA para la masa % : registros_empaque.estado = ''%'' (se esperaba COMPLETADO).', NEW.masa_id, v_estado_empaque;
  END IF;

  IF v_doc_entry_entrada IS NULL OR v_doc_entry_salida IS NULL THEN
    RAISE EXCEPTION 'No se puede marcar EMPAQUE como COMPLETADA para la masa % : falta DocEntry real de SAP (entrada=%, salida=%).', NEW.masa_id, v_doc_entry_entrada, v_doc_entry_salida;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validar_empaque_completado_sap ON progreso_fases;

CREATE TRIGGER trg_validar_empaque_completado_sap
  BEFORE INSERT OR UPDATE ON progreso_fases
  FOR EACH ROW
  EXECUTE FUNCTION fn_validar_empaque_completado_sap();

-- ============================================================
-- 3. Verificación
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_empaque_completado_requiere_sap'
      AND conrelid = 'registros_empaque'::regclass
  ) THEN
    RAISE EXCEPTION '✗ Error: no se creó check_empaque_completado_requiere_sap';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validar_empaque_completado_sap'
  ) THEN
    RAISE EXCEPTION '✗ Error: no se creó trg_validar_empaque_completado_sap';
  END IF;

  RAISE NOTICE '✓ Migración 059 aplicada: EMPAQUE COMPLETADO exige DocEntry real de SAP (CHECK en registros_empaque + trigger en progreso_fases)';
END $$;

COMMIT;

-- =====================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- =====================================================
-- BEGIN;
--
-- DROP TRIGGER IF EXISTS trg_validar_empaque_completado_sap ON progreso_fases;
-- DROP FUNCTION IF EXISTS fn_validar_empaque_completado_sap();
--
-- ALTER TABLE registros_empaque
--   DROP CONSTRAINT IF EXISTS check_empaque_completado_requiere_sap;
--
-- COMMIT;
