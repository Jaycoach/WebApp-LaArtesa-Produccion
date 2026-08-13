-- =====================================================
-- Migración 058: Fix auditoria_automatica() — FK violation en DELETE cascade
-- Fecha: 2026-08-13
-- Bug: DELETE FROM masas_produccion (sap.controller.js, forzar=true)
--   dispara ON DELETE CASCADE sobre productos_por_masa/ingredientes_masa/
--   progreso_fases/registros_*. El trigger auditoria_automatica() de cada
--   tabla hija intentaba INSERT INTO auditoria_cambios con
--   masa_id = OLD.masa_id, pero la fila padre en masas_produccion ya fue
--   eliminada en el mismo statement/transacción -> viola
--   auditoria_cambios_masa_id_fkey.
--
--   Esto ya había ocurrido en producción/staging (sap_sync_log id 1 y 2,
--   2026-02-25) y ya había sido corregido por la migración 009
--   (009_fix_auditoria_cascade.sql), que dejaba masa_id_val := NULL en
--   el branch DELETE. La migración 044 (2026-07-10, fix de
--   usuario_nombre en registros_amasado/registros_division) reescribió
--   la función completa tomando como base una versión anterior a la 009
--   y sin querer revirtió ese fix, reintroduciendo el bug.
--
--   Esta migración vuelve a quitar la asignación masa_id_val :=
--   OLD.masa_id del branch DELETE (queda en NULL, su default declarado),
--   sin tocar ninguna otra lógica de la 044 (usuario_nombre, UPDATE,
--   INSERT quedan intactos).
--
--   Trade-off aceptado (el mismo que ya aceptó la 009): los registros de
--   auditoría de un DELETE en cascada sobre tablas hijas quedan con
--   masa_id = NULL y no aparecen en v_auditoria_por_masa (que filtra
--   WHERE masa_id IS NOT NULL). datos_anteriores (to_jsonb(OLD), la fila
--   completa) se sigue guardando igual — es pérdida de granularidad de
--   filtrado, no de datos.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION auditoria_automatica()
RETURNS TRIGGER AS $$
DECLARE
    tabla_nombre VARCHAR(100);
    registro_id INTEGER;
    masa_id_val INTEGER := NULL;
    usuario_id_val INTEGER := NULL;
    usuario_nombre_val VARCHAR(200) := NULL;
    campos_modificados TEXT[] := NULL;
    datos_anteriores_json JSONB := NULL;
    datos_nuevos_json JSONB := NULL;
BEGIN
    tabla_nombre := TG_TABLE_NAME;

    IF (TG_OP = 'DELETE') THEN
        registro_id := OLD.id;
        datos_anteriores_json := to_jsonb(OLD);
        datos_nuevos_json := NULL;

        -- masa_id_val se deja en NULL (default declarado arriba) para DELETE.
        -- Si este DELETE es parte de un cascade disparado por
        -- DELETE FROM masas_produccion (sap.controller.js forzar=true),
        -- la fila padre ya no existe en este punto y OLD.masa_id violaria
        -- auditoria_cambios_masa_id_fkey. Mismo fix que la migración 009
        -- (2026-02-25), revertido sin querer por la 044 (2026-07-10).

        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := OLD.usuario_id;
        END IF;
        IF tabla_nombre IN ('registros_formado', 'registros_fermentacion', 'registros_horneado') THEN
            usuario_nombre_val := OLD.usuario_nombre;
        END IF;

    ELSIF (TG_OP = 'UPDATE') THEN
        registro_id := NEW.id;
        datos_anteriores_json := to_jsonb(OLD);
        datos_nuevos_json := to_jsonb(NEW);

        SELECT array_agg(key)
        INTO campos_modificados
        FROM (
            SELECT key
            FROM jsonb_each(datos_anteriores_json)
            WHERE value IS DISTINCT FROM datos_nuevos_json->key
        ) AS changed_keys;

        IF tabla_nombre IN ('productos_por_masa', 'ingredientes_masa', 'progreso_fases',
                            'registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            masa_id_val := NEW.masa_id;
        ELSIF tabla_nombre = 'masas_produccion' THEN
            masa_id_val := NEW.id;
        END IF;

        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := NEW.usuario_id;
        END IF;
        IF tabla_nombre IN ('registros_formado', 'registros_fermentacion', 'registros_horneado') THEN
            usuario_nombre_val := NEW.usuario_nombre;
        END IF;

    ELSIF (TG_OP = 'INSERT') THEN
        registro_id := NEW.id;
        datos_anteriores_json := NULL;
        datos_nuevos_json := to_jsonb(NEW);

        IF tabla_nombre IN ('productos_por_masa', 'ingredientes_masa', 'progreso_fases',
                            'registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            masa_id_val := NEW.masa_id;
        ELSIF tabla_nombre = 'masas_produccion' THEN
            masa_id_val := NEW.id;
        END IF;

        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := NEW.usuario_id;
        END IF;
        IF tabla_nombre IN ('registros_formado', 'registros_fermentacion', 'registros_horneado') THEN
            usuario_nombre_val := NEW.usuario_nombre;
        END IF;
    END IF;

    INSERT INTO auditoria_cambios (
        tabla, registro_id, masa_id, operacion,
        datos_anteriores, datos_nuevos, campos_modificados,
        usuario_id, usuario_nombre, fecha_cambio
    ) VALUES (
        tabla_nombre, registro_id, masa_id_val, TG_OP,
        datos_anteriores_json, datos_nuevos_json, campos_modificados,
        usuario_id_val, usuario_nombre_val, NOW()
    );

    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Verificación
DO $$
BEGIN
  RAISE NOTICE '✓ Migración 058 aplicada: masa_id_val ya no referencia OLD.masa_id en DELETE (evita FK violation en cascade desde masas_produccion)';
END $$;

COMMIT;
