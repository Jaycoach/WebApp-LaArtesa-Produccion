-- 072-auditoria-usuario-productos-por-masa.sql
--
-- A4: auditoria_cambios nunca capturaba usuario_id para productos_por_masa,
-- ingredientes_masa ni progreso_fases. Investigacion (grep-first) encontro
-- que las ultimas 2 YA tienen columna para el actor (ingredientes_masa.usuario_peso,
-- progreso_fases.usuario_responsable, ambas pobladas por sus flujos reales) --
-- el gap ahi es solo que el trigger no las lee. productos_por_masa no tiene
-- ninguna columna de actor, asi que es la unica que necesita columna nueva.
--
-- Ver informe de diagnostico masas 840/842 (Division/Horneado/Empaque) para
-- contexto completo.

ALTER TABLE productos_por_masa
  ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id);

COMMENT ON COLUMN productos_por_masa.usuario_id IS
  'Actor del ultimo UPDATE que registro genuinamente una edicion humana '
  '(Division, correccion de Horneado, guardado de detalle de Empaque). '
  'NULL para updates de bookkeeping del sistema (recalculo de costos, '
  'sync SAP, subdivision automatica) -- no representan la accion de un '
  'usuario especifico.';

-- Reemplaza auditoria_automatica() para que capture el actor en las 3 tablas
-- que antes quedaban siempre con usuario_id NULL. Funcion compartida por
-- TODAS las tablas con trigger_auditoria_* (ver lista completa de triggers
-- antes de tocar esto de nuevo): productos_por_masa, ingredientes_masa,
-- progreso_fases, registros_amasado, registros_division, registros_formado,
-- registros_fermentacion, registros_horneado, masas_produccion.
CREATE OR REPLACE FUNCTION public.auditoria_automatica()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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

        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := OLD.usuario_id;
        END IF;
        IF tabla_nombre IN ('registros_formado', 'registros_fermentacion', 'registros_horneado') THEN
            usuario_nombre_val := OLD.usuario_nombre;
        END IF;
        IF tabla_nombre = 'productos_por_masa' THEN
            usuario_id_val := OLD.usuario_id;
        END IF;
        IF tabla_nombre = 'ingredientes_masa' THEN
            usuario_id_val := OLD.usuario_peso;
        END IF;
        IF tabla_nombre = 'progreso_fases' THEN
            usuario_id_val := OLD.usuario_responsable;
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
        IF tabla_nombre = 'productos_por_masa' THEN
            usuario_id_val := NEW.usuario_id;
        END IF;
        IF tabla_nombre = 'ingredientes_masa' THEN
            usuario_id_val := NEW.usuario_peso;
        END IF;
        IF tabla_nombre = 'progreso_fases' THEN
            usuario_id_val := NEW.usuario_responsable;
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
        IF tabla_nombre = 'productos_por_masa' THEN
            usuario_id_val := NEW.usuario_id;
        END IF;
        IF tabla_nombre = 'ingredientes_masa' THEN
            usuario_id_val := NEW.usuario_peso;
        END IF;
        IF tabla_nombre = 'progreso_fases' THEN
            usuario_id_val := NEW.usuario_responsable;
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
$function$;
