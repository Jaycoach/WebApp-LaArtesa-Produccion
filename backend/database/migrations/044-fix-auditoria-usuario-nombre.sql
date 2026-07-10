-- =====================================================
-- Migración 044: Fix trigger auditoria_automatica()
-- Fecha: 2026-07-10
-- Bug: la función asumía que registros_amasado y
--   registros_division tienen columna usuario_nombre,
--   igual que registros_formado/fermentacion/horneado.
--   No la tienen (solo usuario_id) -> error "record new
--   has no field usuario_nombre" al insertar/actualizar,
--   nunca antes disparado por tener 0 filas históricas.
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

        IF tabla_nombre IN ('productos_por_masa', 'ingredientes_masa', 'progreso_fases',
                            'registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            masa_id_val := OLD.masa_id;
        END IF;

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
  RAISE NOTICE '✓ Migración 044 aplicada: función auditoria_automatica() corregida';
END $$;

COMMIT;
