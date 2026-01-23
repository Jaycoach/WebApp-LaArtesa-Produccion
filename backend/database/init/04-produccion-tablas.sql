-- =============================================
-- SISTEMA DE PRODUCCIÓN - TABLAS ESPECÍFICAS
-- Basado en reuniones del 11/12/2025 y 15/01/2026
-- =============================================

-- =============================================
-- TABLA: masas_produccion
-- Agrupación de órdenes por tipo de masa
-- =============================================
CREATE TABLE IF NOT EXISTS masas_produccion (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    codigo_masa VARCHAR(50) NOT NULL,
    tipo_masa VARCHAR(100) NOT NULL,
    nombre_masa VARCHAR(200) NOT NULL,
    fecha_produccion DATE NOT NULL,

    -- Cálculos de masa
    total_kilos_base DECIMAL(10, 2) NOT NULL,
    total_kilos_con_merma DECIMAL(10, 2) NOT NULL,
    porcentaje_merma DECIMAL(5, 2) DEFAULT 0,
    factor_absorcion_usado DECIMAL(5, 2) NOT NULL,

    -- Estados
    estado VARCHAR(50) DEFAULT 'PLANIFICACION',
    -- PLANIFICACION, PESAJE, AMASADO, DIVISION, COMPLETADA, CANCELADA
    fase_actual VARCHAR(50) DEFAULT 'PLANIFICACION',
    -- PLANIFICACION, PESAJE, AMASADO, DIVISION, FORMADO, FERMENTACION, HORNEADO
    fase_bloqueada BOOLEAN DEFAULT TRUE,

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES usuarios(id),

    CONSTRAINT check_estado_masa CHECK (estado IN ('PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO', 'COMPLETADA', 'CANCELADA')),
    CONSTRAINT check_fase_actual CHECK (fase_actual IN ('PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO'))
);

CREATE INDEX idx_masas_fecha ON masas_produccion(fecha_produccion);
CREATE INDEX idx_masas_tipo ON masas_produccion(tipo_masa);
CREATE INDEX idx_masas_estado ON masas_produccion(estado);
CREATE INDEX idx_masas_fase_actual ON masas_produccion(fase_actual);

-- =============================================
-- TABLA: orden_masa_relacion
-- Relación entre órdenes SAP y masas agrupadas
-- =============================================
CREATE TABLE IF NOT EXISTS orden_masa_relacion (
    id SERIAL PRIMARY KEY,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,
    orden_sap_docentry INTEGER NOT NULL,
    orden_sap_docnum VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(masa_id, orden_sap_docentry)
);

CREATE INDEX idx_orden_masa_relacion_masa ON orden_masa_relacion(masa_id);
CREATE INDEX idx_orden_masa_relacion_orden ON orden_masa_relacion(orden_sap_docentry);

-- =============================================
-- TABLA: productos_por_masa
-- Productos que se obtienen de cada masa
-- =============================================
CREATE TABLE IF NOT EXISTS productos_por_masa (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Información del producto
    producto_codigo VARCHAR(50) NOT NULL,
    producto_nombre VARCHAR(200) NOT NULL,
    presentacion VARCHAR(100),  -- Por 6, Por 12, Granel, etc.
    gramaje_unitario DECIMAL(10, 2) NOT NULL, -- Gramos por unidad

    -- Unidades
    unidades_pedidas INTEGER NOT NULL DEFAULT 0,
    unidades_programadas INTEGER NOT NULL DEFAULT 0, -- Modificable para mermas
    unidades_producidas INTEGER DEFAULT 0,

    -- Kilos
    kilos_pedidos DECIMAL(10, 2) NOT NULL DEFAULT 0,
    kilos_programados DECIMAL(10, 2) NOT NULL DEFAULT 0,
    kilos_producidos DECIMAL(10, 2) DEFAULT 0,

    -- División/Corte (REUNIÓN 15/01/2026)
    peso_masa_division DECIMAL(10, 2), -- Peso verificado en división
    cantidad_divisiones INTEGER, -- Cantidad de piezas cortadas
    division_completada BOOLEAN DEFAULT FALSE,

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_productos_masa ON productos_por_masa(masa_id);
CREATE INDEX idx_productos_codigo ON productos_por_masa(producto_codigo);

-- =============================================
-- TABLA: ingredientes_masa
-- Composición de ingredientes de cada masa
-- =============================================
CREATE TABLE IF NOT EXISTS ingredientes_masa (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Información del ingrediente
    ingrediente_sap_code VARCHAR(50),
    ingrediente_nombre VARCHAR(200) NOT NULL,
    orden_visualizacion INTEGER DEFAULT 0,

    -- Porcentaje panadero y clasificación
    porcentaje_panadero DECIMAL(10, 4) NOT NULL,
    es_harina BOOLEAN DEFAULT FALSE,
    es_agua BOOLEAN DEFAULT FALSE,
    es_prefermento BOOLEAN DEFAULT FALSE,

    -- Cantidades calculadas
    cantidad_gramos DECIMAL(10, 2) NOT NULL,
    cantidad_kilos DECIMAL(10, 3) NOT NULL,

    -- CHECKLIST DE PESAJE (REUNIÓN 11/12/2025)
    disponible BOOLEAN DEFAULT FALSE,
    verificado BOOLEAN DEFAULT FALSE,
    pesado BOOLEAN DEFAULT FALSE,

    -- Peso real y diferencia
    peso_real DECIMAL(10, 2),
    diferencia_gramos DECIMAL(10, 2),

    -- Trazabilidad
    lote VARCHAR(100),
    fecha_vencimiento DATE,
    observaciones TEXT,
    usuario_peso INTEGER REFERENCES usuarios(id),
    timestamp_peso TIMESTAMP,

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ingredientes_masa ON ingredientes_masa(masa_id);
CREATE INDEX idx_ingredientes_orden ON ingredientes_masa(orden_visualizacion);
CREATE INDEX idx_ingredientes_pesado ON ingredientes_masa(pesado);

-- =============================================
-- TABLA: progreso_fases
-- Control de progreso de cada fase
-- =============================================
CREATE TABLE IF NOT EXISTS progreso_fases (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    fase VARCHAR(50) NOT NULL,
    -- PLANIFICACION, PESAJE, AMASADO, DIVISION, FORMADO, FERMENTACION, HORNEADO
    estado VARCHAR(50) DEFAULT 'BLOQUEADA',
    -- BLOQUEADA, EN_PROGRESO, COMPLETADA, REQUIERE_ATENCION
    porcentaje_completado INTEGER DEFAULT 0,

    -- Fechas
    fecha_inicio TIMESTAMP,
    fecha_completado TIMESTAMP,

    -- Usuario responsable
    usuario_responsable INTEGER REFERENCES usuarios(id),

    -- Datos específicos de la fase (JSON flexible)
    datos_fase JSONB DEFAULT '{}',

    -- Observaciones
    observaciones TEXT,

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_fase CHECK (fase IN ('PLANIFICACION', 'PESAJE', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO')),
    CONSTRAINT check_estado_progreso CHECK (estado IN ('BLOQUEADA', 'EN_PROGRESO', 'COMPLETADA', 'REQUIERE_ATENCION')),
    UNIQUE(masa_id, fase)
);

CREATE INDEX idx_progreso_masa ON progreso_fases(masa_id);
CREATE INDEX idx_progreso_fase ON progreso_fases(fase);
CREATE INDEX idx_progreso_estado ON progreso_fases(estado);

-- =============================================
-- TABLA: amasadoras
-- Catálogo de amasadoras (REUNIÓN 15/01/2026)
-- =============================================
CREATE TABLE IF NOT EXISTS amasadoras (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    codigo VARCHAR(50),
    capacidad_kg DECIMAL(10, 2) NOT NULL,
    tipo VARCHAR(50), -- INDUSTRIAL, PASTELERIA, etc.
    activa BOOLEAN DEFAULT TRUE,
    observaciones TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- TABLA: registros_amasado
-- Registros de amasado (REUNIÓN 15/01/2026)
-- =============================================
CREATE TABLE IF NOT EXISTS registros_amasado (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Amasadora seleccionada
    amasadora_id INTEGER REFERENCES amasadoras(id),
    amasadora_nombre VARCHAR(100),

    -- Velocidades (REUNIÓN 15/01/2026)
    velocidad_1_minutos INTEGER, -- Velocidad 1 para mezclar
    velocidad_2_minutos INTEGER, -- Velocidad 2 para dar forma

    -- Temperaturas (REUNIÓN 15/01/2026)
    temperatura_masa_final DECIMAL(5, 2),
    temperatura_agua DECIMAL(5, 2),

    -- Control
    usuario_id INTEGER REFERENCES usuarios(id),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    observaciones TEXT,

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(masa_id)
);

CREATE INDEX idx_registros_amasado_masa ON registros_amasado(masa_id);
CREATE INDEX idx_registros_amasado_amasadora ON registros_amasado(amasadora_id);

-- =============================================
-- TABLA: maquinas_corte
-- Catálogo de máquinas de corte/división (REUNIÓN 15/01/2026)
-- =============================================
CREATE TABLE IF NOT EXISTS maquinas_corte (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    codigo VARCHAR(50),
    tipo VARCHAR(50), -- CONIC, MANUAL, AUTOMATICA
    capacidad_kg DECIMAL(10, 2),
    activa BOOLEAN DEFAULT TRUE,
    observaciones TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- TABLA: registros_division
-- Registros de división/corte (REUNIÓN 15/01/2026)
-- =============================================
CREATE TABLE IF NOT EXISTS registros_division (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Máquina seleccionada
    maquina_corte_id INTEGER REFERENCES maquinas_corte(id),
    maquina_nombre VARCHAR(100),

    -- Reposo (REUNIÓN 15/01/2026)
    requiere_reposo BOOLEAN DEFAULT FALSE,
    hora_inicio_reposo TIMESTAMP,
    hora_fin_reposo TIMESTAMP,
    tiempo_reposo_minutos INTEGER,

    -- Temperatura y peso (REUNIÓN 15/01/2026)
    temperatura_entrada DECIMAL(5, 2),

    -- Control
    usuario_id INTEGER REFERENCES usuarios(id),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    observaciones TEXT,

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(masa_id)
);

CREATE INDEX idx_registros_division_masa ON registros_division(masa_id);
CREATE INDEX idx_registros_division_maquina ON registros_division(maquina_corte_id);

-- =============================================
-- TABLA: catalogo_productos
-- Catálogo de productos con pesos (REUNIÓN 15/01/2026)
-- =============================================
CREATE TABLE IF NOT EXISTS catalogo_productos (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    codigo_producto VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    presentacion VARCHAR(100), -- Por 6, Por 12, etc.

    -- Peso específico para división
    peso_masa_gramos DECIMAL(10, 2) NOT NULL,

    -- Categoría
    categoria VARCHAR(100),
    tipo_masa VARCHAR(100),

    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_catalogo_codigo ON catalogo_productos(codigo_producto);
CREATE INDEX idx_catalogo_tipo_masa ON catalogo_productos(tipo_masa);

-- =============================================
-- TABLA: notificaciones_empaque
-- Notificaciones enviadas a empaque (REUNIÓN 15/01/2026)
-- =============================================
CREATE TABLE IF NOT EXISTS notificaciones_empaque (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    masa_id INTEGER NOT NULL REFERENCES masas_produccion(id) ON DELETE CASCADE,

    -- Destinatarios
    destinatarios TEXT[], -- Array de correos electrónicos

    -- Contenido
    asunto VARCHAR(500),
    cuerpo TEXT,

    -- Estado del envío
    estado_envio VARCHAR(50) DEFAULT 'PENDIENTE',
    -- PENDIENTE, ENVIADO, ERROR
    fecha_envio TIMESTAMP,
    error_mensaje TEXT,

    -- Usuario que envió
    enviado_por INTEGER REFERENCES usuarios(id),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_estado_envio CHECK (estado_envio IN ('PENDIENTE', 'ENVIADO', 'ERROR'))
);

CREATE INDEX idx_notificaciones_masa ON notificaciones_empaque(masa_id);
CREATE INDEX idx_notificaciones_estado ON notificaciones_empaque(estado_envio);

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger para actualizar updated_at en masas_produccion
CREATE OR REPLACE FUNCTION update_masas_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_masas_timestamp
BEFORE UPDATE ON masas_produccion
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

-- Similar triggers para otras tablas
CREATE TRIGGER trigger_update_productos_timestamp
BEFORE UPDATE ON productos_por_masa
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

CREATE TRIGGER trigger_update_ingredientes_timestamp
BEFORE UPDATE ON ingredientes_masa
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

CREATE TRIGGER trigger_update_progreso_timestamp
BEFORE UPDATE ON progreso_fases
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

CREATE TRIGGER trigger_update_amasado_timestamp
BEFORE UPDATE ON registros_amasado
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

CREATE TRIGGER trigger_update_division_timestamp
BEFORE UPDATE ON registros_division
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

CREATE TRIGGER trigger_update_catalogo_timestamp
BEFORE UPDATE ON catalogo_productos
FOR EACH ROW
EXECUTE FUNCTION update_masas_timestamp();

-- =============================================
-- COMENTARIOS
-- =============================================

COMMENT ON TABLE masas_produccion IS 'Agrupación de órdenes SAP por tipo de masa';
COMMENT ON TABLE productos_por_masa IS 'Productos que se obtienen de cada masa con control de mermas';
COMMENT ON TABLE ingredientes_masa IS 'Composición de ingredientes con checklist de pesaje';
COMMENT ON TABLE progreso_fases IS 'Control de progreso de cada fase de producción';
COMMENT ON TABLE amasadoras IS 'Catálogo de amasadoras disponibles';
COMMENT ON TABLE registros_amasado IS 'Registros de amasado con velocidades y temperaturas';
COMMENT ON TABLE maquinas_corte IS 'Catálogo de máquinas de corte/división';
COMMENT ON TABLE registros_division IS 'Registros de división con reposo y temperaturas';
COMMENT ON TABLE catalogo_productos IS 'Catálogo de productos con pesos específicos para división';
COMMENT ON TABLE notificaciones_empaque IS 'Notificaciones enviadas a empaque por correo electrónico';
