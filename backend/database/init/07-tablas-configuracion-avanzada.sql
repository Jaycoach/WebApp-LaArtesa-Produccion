-- =====================================================
-- 07-tablas-configuracion-avanzada.sql
-- Tablas de configuración para FORMADO, FERMENTACIÓN y HORNEADO
-- Basado en reuniones 11/12/2025 y 23/01/2026
-- =====================================================

-- =====================================================
-- TABLA: catalogo_tipos_masa
-- Mapeo entre códigos SAP y tipos de masa
-- CRÍTICO: Necesario para agrupar órdenes por masa
-- =====================================================
CREATE TABLE IF NOT EXISTS catalogo_tipos_masa (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    codigo_sap VARCHAR(50) UNIQUE NOT NULL,
    tipo_masa VARCHAR(100) NOT NULL,
    nombre_masa VARCHAR(200) NOT NULL,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,

    -- Configuración de fases
    requiere_reposo_pre_division BOOLEAN DEFAULT FALSE,
    tiempo_reposo_division_minutos INTEGER,
    requiere_formado BOOLEAN DEFAULT FALSE,
    requiere_camara_frio BOOLEAN DEFAULT FALSE,

    -- Configuración de fermentación
    tiempo_fermentacion_estandar_minutos INTEGER DEFAULT 40,

    -- Metadatos
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Índices
    CONSTRAINT check_reposo_division CHECK (
        (requiere_reposo_pre_division = FALSE) OR
        (requiere_reposo_pre_division = TRUE AND tiempo_reposo_division_minutos > 0)
    )
);

CREATE INDEX idx_catalogo_tipos_masa_codigo_sap ON catalogo_tipos_masa(codigo_sap);
CREATE INDEX idx_catalogo_tipos_masa_tipo_masa ON catalogo_tipos_masa(tipo_masa);
CREATE INDEX idx_catalogo_tipos_masa_activo ON catalogo_tipos_masa(activo);

COMMENT ON TABLE catalogo_tipos_masa IS 'Catálogo de tipos de masa con relación a códigos SAP';
COMMENT ON COLUMN catalogo_tipos_masa.codigo_sap IS 'Código del producto en SAP';
COMMENT ON COLUMN catalogo_tipos_masa.tipo_masa IS 'Tipo de masa (árabe, gold, brioche, etc.)';
COMMENT ON COLUMN catalogo_tipos_masa.requiere_formado IS 'Indica si la masa pasa por formado';
COMMENT ON COLUMN catalogo_tipos_masa.requiere_camara_frio IS 'Indica si requiere cámara de frío después de fermentación';

-- =====================================================
-- TABLA: maquinas_formado
-- Catálogo de máquinas formadoras
-- =====================================================
CREATE TABLE IF NOT EXISTS maquinas_formado (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    tipo VARCHAR(50) DEFAULT 'FORMADORA', -- FORMADORA, MANUAL
    capacidad_kg DECIMAL(10, 2),
    activa BOOLEAN DEFAULT TRUE,
    observaciones TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_maquinas_formado_activa ON maquinas_formado(activa);

COMMENT ON TABLE maquinas_formado IS 'Catálogo de máquinas de formado';

-- =====================================================
-- TABLA: registros_formado
-- Registros de proceso de formado
-- =====================================================
CREATE TABLE IF NOT EXISTS registros_formado (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
    maquina_formado_id INTEGER REFERENCES maquinas_formado(id),
    maquina_nombre VARCHAR(100),

    -- Tiempos
    fecha_inicio TIMESTAMP,
    fecha_fin TIMESTAMP,
    duracion_minutos INTEGER,

    -- Usuario responsable
    usuario_id INTEGER REFERENCES usuarios(id),
    usuario_nombre VARCHAR(200),

    -- Observaciones
    observaciones TEXT,

    -- Metadatos
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_registros_formado_masa_id ON registros_formado(masa_id);
CREATE INDEX idx_registros_formado_usuario_id ON registros_formado(usuario_id);

COMMENT ON TABLE registros_formado IS 'Registros del proceso de formado';

-- =====================================================
-- TABLA: especificaciones_formado
-- Especificaciones de medidas para formado
-- =====================================================
CREATE TABLE IF NOT EXISTS especificaciones_formado (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    tipo_masa VARCHAR(100) NOT NULL,
    producto_codigo VARCHAR(50),
    producto_nombre VARCHAR(200),

    -- Medidas esperadas
    largo_cm DECIMAL(5, 2),
    ancho_cm DECIMAL(5, 2),
    alto_cm DECIMAL(5, 2),
    diametro_cm DECIMAL(5, 2),

    -- Tolerancias
    tolerancia_cm DECIMAL(5, 2) DEFAULT 1.0,

    -- Metadatos
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_especificaciones_formado_tipo_masa ON especificaciones_formado(tipo_masa);
CREATE INDEX idx_especificaciones_formado_activo ON especificaciones_formado(activo);

COMMENT ON TABLE especificaciones_formado IS 'Especificaciones de medidas para el proceso de formado';

-- =====================================================
-- TABLA: registros_fermentacion
-- Registros de fermentación (cámara y frío)
-- =====================================================
CREATE TABLE IF NOT EXISTS registros_fermentacion (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Cámara de fermentación
    hora_entrada_camara TIMESTAMP,
    hora_salida_camara_sugerida TIMESTAMP,
    hora_salida_camara_real TIMESTAMP,
    tiempo_fermentacion_minutos INTEGER,
    temperatura_camara DECIMAL(5, 2),
    humedad_camara DECIMAL(5, 2),

    -- Cámara de frío (condicional)
    requiere_camara_frio BOOLEAN DEFAULT FALSE,
    hora_entrada_frio TIMESTAMP,
    hora_salida_frio TIMESTAMP,
    tiempo_frio_minutos INTEGER,
    temperatura_frio DECIMAL(5, 2),

    -- Usuario responsable
    usuario_id INTEGER REFERENCES usuarios(id),
    usuario_nombre VARCHAR(200),

    -- Observaciones
    observaciones TEXT,

    -- Metadatos
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT check_salida_camara CHECK (
        hora_salida_camara_real IS NULL OR
        hora_salida_camara_real >= hora_entrada_camara
    ),
    CONSTRAINT check_camara_frio CHECK (
        (requiere_camara_frio = FALSE) OR
        (requiere_camara_frio = TRUE AND hora_entrada_frio IS NOT NULL)
    )
);

CREATE INDEX idx_registros_fermentacion_masa_id ON registros_fermentacion(masa_id);
CREATE INDEX idx_registros_fermentacion_usuario_id ON registros_fermentacion(usuario_id);

COMMENT ON TABLE registros_fermentacion IS 'Registros del proceso de fermentación';
COMMENT ON COLUMN registros_fermentacion.hora_salida_camara_sugerida IS 'Hora calculada automáticamente según tiempo estándar';
COMMENT ON COLUMN registros_fermentacion.hora_salida_camara_real IS 'Hora real en que se sacó (puede diferir de la sugerida)';

-- =====================================================
-- TABLA: tipos_horno
-- Catálogo de hornos disponibles
-- =====================================================
CREATE TABLE IF NOT EXISTS tipos_horno (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL UNIQUE, -- "Rotativo 1", "Rotativo 2", "Rotativo 3", "Piso"
    codigo VARCHAR(50) UNIQUE NOT NULL,
    tipo VARCHAR(50) NOT NULL, -- ROTATIVO, PISO
    capacidad_bandejas INTEGER,
    tiene_damper BOOLEAN DEFAULT TRUE,
    tiene_control_automatico BOOLEAN DEFAULT TRUE,
    activo BOOLEAN DEFAULT TRUE,
    observaciones TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tipos_horno_activo ON tipos_horno(activo);
CREATE INDEX idx_tipos_horno_tipo ON tipos_horno(tipo);

COMMENT ON TABLE tipos_horno IS 'Catálogo de hornos disponibles en la planta';
COMMENT ON COLUMN tipos_horno.tiene_damper IS 'Indica si el horno tiene sistema de extracción de vapor (damper)';

-- =====================================================
-- TABLA: programas_horneo
-- Programas de horneado configurables (hasta 40 programas)
-- =====================================================
CREATE TABLE IF NOT EXISTS programas_horneo (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    numero_programa INTEGER UNIQUE NOT NULL CHECK (numero_programa BETWEEN 1 AND 40),
    nombre VARCHAR(100),
    descripcion TEXT,

    -- Temperaturas (en °C)
    temperatura_inicial DECIMAL(5, 2) NOT NULL,
    temperatura_media DECIMAL(5, 2),
    temperatura_final DECIMAL(5, 2) NOT NULL,

    -- Tiempos (en minutos desde inicio)
    tiempo_temperatura_media INTEGER, -- A qué minuto cambiar a temp media
    tiempo_total_minutos INTEGER NOT NULL,

    -- Damper (extracción de vapor)
    usa_damper BOOLEAN DEFAULT FALSE,
    tiempo_inicio_damper INTEGER, -- A qué minuto abrir damper
    tiempo_fin_damper INTEGER, -- A qué minuto cerrar damper

    -- Aplicación
    tipo_masa_sugerido VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,

    -- Metadatos
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT check_damper CHECK (
        (usa_damper = FALSE) OR
        (usa_damper = TRUE AND tiempo_inicio_damper IS NOT NULL AND tiempo_fin_damper IS NOT NULL)
    ),
    CONSTRAINT check_tiempos_damper CHECK (
        (tiempo_inicio_damper IS NULL OR tiempo_fin_damper IS NULL) OR
        (tiempo_inicio_damper < tiempo_fin_damper AND tiempo_fin_damper <= tiempo_total_minutos)
    )
);

CREATE INDEX idx_programas_horneo_numero ON programas_horneo(numero_programa);
CREATE INDEX idx_programas_horneo_activo ON programas_horneo(activo);

COMMENT ON TABLE programas_horneo IS 'Programas de horneado pre-configurados para los hornos';

-- =====================================================
-- TABLA: registros_horneado
-- Registros del proceso de horneado
-- =====================================================
CREATE TABLE IF NOT EXISTS registros_horneado (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Horno utilizado
    tipo_horno_id INTEGER NOT NULL REFERENCES tipos_horno(id),
    horno_nombre VARCHAR(100),

    -- Programa utilizado
    programa_horneo_id INTEGER REFERENCES programas_horneo(id),
    numero_programa INTEGER,

    -- Tiempos reales
    hora_entrada TIMESTAMP NOT NULL,
    hora_cambio_temperatura TIMESTAMP,
    hora_salida TIMESTAMP,
    tiempo_total_minutos INTEGER,

    -- Temperaturas reales registradas
    temperatura_inicial_real DECIMAL(5, 2),
    temperatura_media_real DECIMAL(5, 2),
    temperatura_final_real DECIMAL(5, 2),

    -- Damper real
    uso_damper_real BOOLEAN,
    tiempo_inicio_damper_real INTEGER,
    tiempo_fin_damper_real INTEGER,

    -- Control de calidad
    calidad_color VARCHAR(50), -- PERFECTO, CLARO, OSCURO
    calidad_coccion VARCHAR(50), -- PERFECTO, CRUDO, SOBRE_COCIDO

    -- Usuario responsable
    usuario_id INTEGER REFERENCES usuarios(id),
    usuario_nombre VARCHAR(200),

    -- Observaciones
    observaciones TEXT,

    -- Metadatos
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT check_hora_salida CHECK (
        hora_salida IS NULL OR hora_salida > hora_entrada
    )
);

CREATE INDEX idx_registros_horneado_masa_id ON registros_horneado(masa_id);
CREATE INDEX idx_registros_horneado_horno_id ON registros_horneado(tipo_horno_id);
CREATE INDEX idx_registros_horneado_usuario_id ON registros_horneado(usuario_id);

COMMENT ON TABLE registros_horneado IS 'Registros del proceso de horneado';

-- =====================================================
-- TABLA: auditoria_cambios
-- Auditoría de modificaciones en procesos
-- =====================================================
CREATE TABLE IF NOT EXISTS auditoria_cambios (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,

    -- Qué se modificó
    tabla VARCHAR(100) NOT NULL,
    registro_id INTEGER NOT NULL,
    masa_id INTEGER REFERENCES masas_produccion(id),

    -- Tipo de operación
    operacion VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE

    -- Datos
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    campos_modificados TEXT[], -- Array de nombres de campos modificados

    -- Quién y cuándo
    usuario_id INTEGER REFERENCES usuarios(id),
    usuario_nombre VARCHAR(200),
    ip_address INET,
    user_agent TEXT,

    -- Metadatos
    fecha_cambio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    motivo TEXT
);

CREATE INDEX idx_auditoria_cambios_tabla ON auditoria_cambios(tabla);
CREATE INDEX idx_auditoria_cambios_registro_id ON auditoria_cambios(registro_id);
CREATE INDEX idx_auditoria_cambios_masa_id ON auditoria_cambios(masa_id);
CREATE INDEX idx_auditoria_cambios_usuario_id ON auditoria_cambios(usuario_id);
CREATE INDEX idx_auditoria_cambios_fecha ON auditoria_cambios(fecha_cambio);

COMMENT ON TABLE auditoria_cambios IS 'Auditoría detallada de cambios en el sistema';

-- =====================================================
-- TRIGGERS para actualizar fecha_actualizacion
-- =====================================================

CREATE TRIGGER update_catalogo_tipos_masa_timestamp
BEFORE UPDATE ON catalogo_tipos_masa
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_maquinas_formado_timestamp
BEFORE UPDATE ON maquinas_formado
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_registros_formado_timestamp
BEFORE UPDATE ON registros_formado
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_especificaciones_formado_timestamp
BEFORE UPDATE ON especificaciones_formado
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_registros_fermentacion_timestamp
BEFORE UPDATE ON registros_fermentacion
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_tipos_horno_timestamp
BEFORE UPDATE ON tipos_horno
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_programas_horneo_timestamp
BEFORE UPDATE ON programas_horneo
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_registros_horneado_timestamp
BEFORE UPDATE ON registros_horneado
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
