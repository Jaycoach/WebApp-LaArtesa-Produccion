-- =====================================================
-- 09-auditoria-automatica.sql
-- Sistema de auditoría automática con triggers
-- Registra automáticamente INSERT, UPDATE, DELETE en tablas críticas
-- =====================================================

-- =====================================================
-- FUNCIÓN: Auditar cambios automáticamente
-- =====================================================
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
    -- Nombre de la tabla
    tabla_nombre := TG_TABLE_NAME;

    -- Determinar operación y datos
    IF (TG_OP = 'DELETE') THEN
        registro_id := OLD.id;
        datos_anteriores_json := to_jsonb(OLD);
        datos_nuevos_json := NULL;

        -- Intentar obtener masa_id si existe
        IF tabla_nombre IN ('productos_por_masa', 'ingredientes_masa', 'progreso_fases',
                            'registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            masa_id_val := OLD.masa_id;
        END IF;

        -- Intentar obtener usuario_id si existe
        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := OLD.usuario_id;
            usuario_nombre_val := OLD.usuario_nombre;
        END IF;

    ELSIF (TG_OP = 'UPDATE') THEN
        registro_id := NEW.id;
        datos_anteriores_json := to_jsonb(OLD);
        datos_nuevos_json := to_jsonb(NEW);

        -- Calcular campos modificados
        SELECT array_agg(key)
        INTO campos_modificados
        FROM (
            SELECT key
            FROM jsonb_each(datos_anteriores_json)
            WHERE value IS DISTINCT FROM datos_nuevos_json->key
        ) AS changed_keys;

        -- Intentar obtener masa_id si existe
        IF tabla_nombre IN ('productos_por_masa', 'ingredientes_masa', 'progreso_fases',
                            'registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            masa_id_val := NEW.masa_id;
        ELSIF tabla_nombre = 'masas_produccion' THEN
            masa_id_val := NEW.id;
        END IF;

        -- Intentar obtener usuario_id si existe
        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := NEW.usuario_id;
            usuario_nombre_val := NEW.usuario_nombre;
        END IF;

    ELSIF (TG_OP = 'INSERT') THEN
        registro_id := NEW.id;
        datos_anteriores_json := NULL;
        datos_nuevos_json := to_jsonb(NEW);

        -- Intentar obtener masa_id si existe
        IF tabla_nombre IN ('productos_por_masa', 'ingredientes_masa', 'progreso_fases',
                            'registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            masa_id_val := NEW.masa_id;
        ELSIF tabla_nombre = 'masas_produccion' THEN
            masa_id_val := NEW.id;
        END IF;

        -- Intentar obtener usuario_id si existe
        IF tabla_nombre IN ('registros_amasado', 'registros_division', 'registros_formado',
                            'registros_fermentacion', 'registros_horneado') THEN
            usuario_id_val := NEW.usuario_id;
            usuario_nombre_val := NEW.usuario_nombre;
        END IF;
    END IF;

    -- Insertar registro de auditoría
    INSERT INTO auditoria_cambios (
        tabla,
        registro_id,
        masa_id,
        operacion,
        datos_anteriores,
        datos_nuevos,
        campos_modificados,
        usuario_id,
        usuario_nombre,
        fecha_cambio
    ) VALUES (
        tabla_nombre,
        registro_id,
        masa_id_val,
        TG_OP,
        datos_anteriores_json,
        datos_nuevos_json,
        campos_modificados,
        usuario_id_val,
        usuario_nombre_val,
        NOW()
    );

    -- Retornar el registro apropiado
    IF (TG_OP = 'DELETE') THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auditoria_automatica() IS 'Función de auditoría automática para registrar cambios en tablas críticas';

-- =====================================================
-- TRIGGERS: Aplicar auditoría a tablas críticas
-- =====================================================

-- Tabla: masas_produccion
DROP TRIGGER IF EXISTS trigger_auditoria_masas_produccion ON masas_produccion;
CREATE TRIGGER trigger_auditoria_masas_produccion
AFTER INSERT OR UPDATE OR DELETE ON masas_produccion
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: productos_por_masa
DROP TRIGGER IF EXISTS trigger_auditoria_productos_por_masa ON productos_por_masa;
CREATE TRIGGER trigger_auditoria_productos_por_masa
AFTER INSERT OR UPDATE OR DELETE ON productos_por_masa
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: ingredientes_masa
DROP TRIGGER IF EXISTS trigger_auditoria_ingredientes_masa ON ingredientes_masa;
CREATE TRIGGER trigger_auditoria_ingredientes_masa
AFTER INSERT OR UPDATE OR DELETE ON ingredientes_masa
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: progreso_fases
DROP TRIGGER IF EXISTS trigger_auditoria_progreso_fases ON progreso_fases;
CREATE TRIGGER trigger_auditoria_progreso_fases
AFTER INSERT OR UPDATE OR DELETE ON progreso_fases
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: registros_amasado
DROP TRIGGER IF EXISTS trigger_auditoria_registros_amasado ON registros_amasado;
CREATE TRIGGER trigger_auditoria_registros_amasado
AFTER INSERT OR UPDATE OR DELETE ON registros_amasado
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: registros_division
DROP TRIGGER IF EXISTS trigger_auditoria_registros_division ON registros_division;
CREATE TRIGGER trigger_auditoria_registros_division
AFTER INSERT OR UPDATE OR DELETE ON registros_division
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: registros_formado
DROP TRIGGER IF EXISTS trigger_auditoria_registros_formado ON registros_formado;
CREATE TRIGGER trigger_auditoria_registros_formado
AFTER INSERT OR UPDATE OR DELETE ON registros_formado
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: registros_fermentacion
DROP TRIGGER IF EXISTS trigger_auditoria_registros_fermentacion ON registros_fermentacion;
CREATE TRIGGER trigger_auditoria_registros_fermentacion
AFTER INSERT OR UPDATE OR DELETE ON registros_fermentacion
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: registros_horneado
DROP TRIGGER IF EXISTS trigger_auditoria_registros_horneado ON registros_horneado;
CREATE TRIGGER trigger_auditoria_registros_horneado
AFTER INSERT OR UPDATE OR DELETE ON registros_horneado
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: configuracion_sistema (cambios de configuración)
DROP TRIGGER IF EXISTS trigger_auditoria_configuracion_sistema ON configuracion_sistema;
CREATE TRIGGER trigger_auditoria_configuracion_sistema
AFTER INSERT OR UPDATE OR DELETE ON configuracion_sistema
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: catalogo_tipos_masa (cambios en catálogo)
DROP TRIGGER IF EXISTS trigger_auditoria_catalogo_tipos_masa ON catalogo_tipos_masa;
CREATE TRIGGER trigger_auditoria_catalogo_tipos_masa
AFTER INSERT OR UPDATE OR DELETE ON catalogo_tipos_masa
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- Tabla: programas_horneo (cambios en programas)
DROP TRIGGER IF EXISTS trigger_auditoria_programas_horneo ON programas_horneo;
CREATE TRIGGER trigger_auditoria_programas_horneo
AFTER INSERT OR UPDATE OR DELETE ON programas_horneo
FOR EACH ROW EXECUTE FUNCTION auditoria_automatica();

-- =====================================================
-- VISTAS: Consultas útiles de auditoría
-- =====================================================

-- Vista: Cambios recientes por masa
CREATE OR REPLACE VIEW v_auditoria_por_masa AS
SELECT
    ac.id,
    ac.masa_id,
    mp.codigo_masa,
    mp.tipo_masa,
    ac.tabla,
    ac.registro_id,
    ac.operacion,
    ac.campos_modificados,
    ac.usuario_nombre,
    ac.fecha_cambio,
    ac.datos_anteriores,
    ac.datos_nuevos
FROM auditoria_cambios ac
LEFT JOIN masas_produccion mp ON ac.masa_id = mp.id
WHERE ac.masa_id IS NOT NULL
ORDER BY ac.fecha_cambio DESC;

COMMENT ON VIEW v_auditoria_por_masa IS 'Vista de auditoría agrupada por masa de producción';

-- Vista: Cambios por usuario
CREATE OR REPLACE VIEW v_auditoria_por_usuario AS
SELECT
    ac.usuario_id,
    ac.usuario_nombre,
    COUNT(*) as total_cambios,
    COUNT(CASE WHEN ac.operacion = 'INSERT' THEN 1 END) as inserciones,
    COUNT(CASE WHEN ac.operacion = 'UPDATE' THEN 1 END) as actualizaciones,
    COUNT(CASE WHEN ac.operacion = 'DELETE' THEN 1 END) as eliminaciones,
    MIN(ac.fecha_cambio) as primer_cambio,
    MAX(ac.fecha_cambio) as ultimo_cambio
FROM auditoria_cambios ac
WHERE ac.usuario_id IS NOT NULL
GROUP BY ac.usuario_id, ac.usuario_nombre
ORDER BY total_cambios DESC;

COMMENT ON VIEW v_auditoria_por_usuario IS 'Resumen de cambios por usuario';

-- Vista: Cambios recientes (últimas 24 horas)
CREATE OR REPLACE VIEW v_auditoria_reciente AS
SELECT
    ac.id,
    ac.tabla,
    ac.registro_id,
    ac.operacion,
    ac.usuario_nombre,
    ac.fecha_cambio,
    CASE
        WHEN ac.masa_id IS NOT NULL THEN mp.codigo_masa
        ELSE NULL
    END as masa_codigo
FROM auditoria_cambios ac
LEFT JOIN masas_produccion mp ON ac.masa_id = mp.id
WHERE ac.fecha_cambio >= NOW() - INTERVAL '24 hours'
ORDER BY ac.fecha_cambio DESC;

COMMENT ON VIEW v_auditoria_reciente IS 'Cambios de las últimas 24 horas';

-- =====================================================
-- FUNCIÓN: Obtener historial de cambios de un registro
-- =====================================================
CREATE OR REPLACE FUNCTION obtener_historial_registro(
    p_tabla VARCHAR(100),
    p_registro_id INTEGER
)
RETURNS TABLE (
    id INTEGER,
    operacion VARCHAR(20),
    campos_modificados TEXT[],
    usuario_nombre VARCHAR(200),
    fecha_cambio TIMESTAMP,
    datos_anteriores JSONB,
    datos_nuevos JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ac.id,
        ac.operacion,
        ac.campos_modificados,
        ac.usuario_nombre,
        ac.fecha_cambio,
        ac.datos_anteriores,
        ac.datos_nuevos
    FROM auditoria_cambios ac
    WHERE ac.tabla = p_tabla
      AND ac.registro_id = p_registro_id
    ORDER BY ac.fecha_cambio ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_historial_registro IS 'Obtiene el historial completo de cambios de un registro específico';

-- =====================================================
-- FUNCIÓN: Purgar auditoría antigua
-- =====================================================
CREATE OR REPLACE FUNCTION purgar_auditoria_antigua(dias INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    registros_eliminados INTEGER;
BEGIN
    DELETE FROM auditoria_cambios
    WHERE fecha_cambio < NOW() - (dias || ' days')::INTERVAL;

    GET DIAGNOSTICS registros_eliminados = ROW_COUNT;

    RETURN registros_eliminados;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purgar_auditoria_antigua IS 'Purga registros de auditoría antiguos (por defecto más de 90 días)';

-- =====================================================
-- ÍNDICES adicionales para mejorar consultas de auditoría
-- =====================================================

-- Índice compuesto para búsquedas por tabla y fecha
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_fecha
ON auditoria_cambios(tabla, fecha_cambio DESC);

-- Índice para búsquedas por usuario y fecha
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_fecha
ON auditoria_cambios(usuario_id, fecha_cambio DESC)
WHERE usuario_id IS NOT NULL;

-- Índice para operaciones específicas
CREATE INDEX IF NOT EXISTS idx_auditoria_operacion
ON auditoria_cambios(operacion, fecha_cambio DESC);

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
