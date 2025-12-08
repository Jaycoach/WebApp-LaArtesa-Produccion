-- =============================================
-- SCRIPT DE INICIALIZACIÓN BASE DE DATOS ARTESA
-- Versión: 1.0.0
-- Fecha: Enero 2025
-- Autor: Jonathan Jay Zúñiga Perdomo
-- =============================================

-- Configuración inicial
SET client_encoding = 'UTF8';
SET timezone = 'America/Bogota';

-- =============================================
-- EXTENSIONES
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- TABLA: usuarios
-- Gestión de usuarios del sistema
-- =============================================
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(100) NOT NULL,
    rol VARCHAR(20) NOT NULL DEFAULT 'OPERARIO',
    -- ADMIN, SUPERVISOR, OPERARIO, CALIDAD, AUDITOR
    activo BOOLEAN DEFAULT TRUE,
    email_verificado BOOLEAN DEFAULT FALSE,
    intentos_fallidos INTEGER DEFAULT 0,
    bloqueado_hasta TIMESTAMP,
    ultimo_acceso TIMESTAMP,
    ultimo_cambio_password TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    debe_cambiar_password BOOLEAN DEFAULT FALSE,
    token_verificacion VARCHAR(255),
    token_recuperacion VARCHAR(255),
    token_recuperacion_expira TIMESTAMP,
    refresh_token VARCHAR(500),
    refresh_token_expira TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    creado_por INTEGER REFERENCES usuarios(id),
    actualizado_por INTEGER REFERENCES usuarios(id),
    
    CONSTRAINT check_rol CHECK (rol IN ('ADMIN', 'SUPERVISOR', 'OPERARIO', 'CALIDAD', 'AUDITOR')),
    CONSTRAINT check_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT check_username CHECK (LENGTH(username) >= 3)
);

-- Índices para usuarios
CREATE INDEX idx_usuarios_username ON usuarios(username);
CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_usuarios_rol ON usuarios(rol);
CREATE INDEX idx_usuarios_activo ON usuarios(activo);
CREATE INDEX idx_usuarios_uuid ON usuarios(uuid);

-- =============================================
-- TABLA: ordenes_produccion
-- Órdenes de producción del sistema
-- =============================================
CREATE TABLE IF NOT EXISTS ordenes_produccion (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    sap_docentry INTEGER UNIQUE,
    sap_docnum VARCHAR(20),
    codigo_orden VARCHAR(50) UNIQUE NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_planificada DATE NOT NULL,
    fecha_inicio TIMESTAMP,
    fecha_cierre TIMESTAMP,
    tipo_masa VARCHAR(50) NOT NULL,
    cantidad_planificada DECIMAL(10,2) NOT NULL,
    cantidad_producida DECIMAL(10,2) DEFAULT 0,
    cantidad_desperdicio DECIMAL(10,2) DEFAULT 0,
    unidad_medida VARCHAR(10) DEFAULT 'KG',
    estado VARCHAR(20) DEFAULT 'PENDIENTE',
    -- Estados: PENDIENTE, EN_PROCESO, COMPLETADO, CANCELADO, ERROR
    prioridad INTEGER DEFAULT 1,
    -- 1=Baja, 2=Media, 3=Alta, 4=Urgente
    almacen_destino VARCHAR(10) DEFAULT '01',
    lote_produccion VARCHAR(50),
    usuario_inicio INTEGER REFERENCES usuarios(id),
    usuario_cierre INTEGER REFERENCES usuarios(id),
    observaciones TEXT,
    motivo_cancelacion TEXT,
    tiempo_total_produccion INTEGER,
    -- Tiempo en minutos
    eficiencia_produccion DECIMAL(5,2),
    -- Porcentaje
    metadata JSONB DEFAULT '{}',
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_estado_orden CHECK (estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'CANCELADO', 'ERROR')),
    CONSTRAINT check_cantidad_planificada CHECK (cantidad_planificada > 0),
    CONSTRAINT check_prioridad CHECK (prioridad BETWEEN 1 AND 4)
);

-- Índices para órdenes_produccion
CREATE INDEX idx_ordenes_estado ON ordenes_produccion(estado);
CREATE INDEX idx_ordenes_fecha_planificada ON ordenes_produccion(fecha_planificada);
CREATE INDEX idx_ordenes_tipo_masa ON ordenes_produccion(tipo_masa);
CREATE INDEX idx_ordenes_codigo ON ordenes_produccion(codigo_orden);
CREATE INDEX idx_ordenes_sap_docentry ON ordenes_produccion(sap_docentry);
CREATE INDEX idx_ordenes_fecha_creacion ON ordenes_produccion(fecha_creacion);

-- =============================================
-- TABLA: orden_productos
-- Productos incluidos en cada orden
-- =============================================
CREATE TABLE IF NOT EXISTS orden_productos (
    id SERIAL PRIMARY KEY,
    orden_id INTEGER NOT NULL REFERENCES ordenes_produccion(id) ON DELETE CASCADE,
    codigo_producto VARCHAR(50) NOT NULL,
    descripcion VARCHAR(200),
    cantidad_requerida DECIMAL(10,2) NOT NULL,
    cantidad_producida DECIMAL(10,2) DEFAULT 0,
    unidad VARCHAR(10) DEFAULT 'KG',
    lote VARCHAR(50),
    fecha_vencimiento DATE,
    ubicacion VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_cantidad_producto CHECK (cantidad_requerida > 0)
);

-- Índices para orden_productos
CREATE INDEX idx_orden_productos_orden ON orden_productos(orden_id);
CREATE INDEX idx_orden_productos_codigo ON orden_productos(codigo_producto);
CREATE INDEX idx_orden_productos_lote ON orden_productos(lote);

-- =============================================
-- TABLA: etapas_proceso
-- Registro de cada etapa del proceso productivo
-- =============================================
CREATE TABLE IF NOT EXISTS etapas_proceso (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    orden_id INTEGER NOT NULL REFERENCES ordenes_produccion(id) ON DELETE CASCADE,
    etapa VARCHAR(50) NOT NULL,
    -- PESAJE, PREFERMENTO, AMASADO, DIVISION, FORMADO, FERMENTACION, HORNEADO
    numero_etapa INTEGER NOT NULL,
    estado VARCHAR(20) DEFAULT 'PENDIENTE',
    -- PENDIENTE, EN_PROCESO, COMPLETADO, OMITIDO, ERROR
    fecha_inicio TIMESTAMP,
    fecha_fin TIMESTAMP,
    tiempo_duracion INTEGER,
    -- Minutos
    usuario_id INTEGER REFERENCES usuarios(id),
    parametros JSONB DEFAULT '{}',
    resultados JSONB DEFAULT '{}',
    observaciones TEXT,
    requiere_aprobacion BOOLEAN DEFAULT FALSE,
    aprobado_por INTEGER REFERENCES usuarios(id),
    fecha_aprobacion TIMESTAMP,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_etapa_valida CHECK (etapa IN ('PESAJE', 'PREFERMENTO', 'AMASADO', 'DIVISION', 'FORMADO', 'FERMENTACION', 'HORNEADO')),
    CONSTRAINT check_estado_etapa CHECK (estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'OMITIDO', 'ERROR')),
    CONSTRAINT unique_orden_etapa UNIQUE (orden_id, etapa)
);

-- Índices para etapas_proceso
CREATE INDEX idx_etapas_orden ON etapas_proceso(orden_id);
CREATE INDEX idx_etapas_estado ON etapas_proceso(estado);
CREATE INDEX idx_etapas_tipo ON etapas_proceso(etapa);
CREATE INDEX idx_etapas_usuario ON etapas_proceso(usuario_id);

-- =============================================
-- TABLA: control_calidad
-- Control de calidad en cada etapa
-- =============================================
CREATE TABLE IF NOT EXISTS control_calidad (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    orden_id INTEGER NOT NULL REFERENCES ordenes_produccion(id) ON DELETE CASCADE,
    etapa_id INTEGER REFERENCES etapas_proceso(id) ON DELETE CASCADE,
    tipo_control VARCHAR(50) NOT NULL,
    -- TEMPERATURA, PH, PESO, TEXTURA, COLOR, SABOR, VISUAL
    parametro VARCHAR(100) NOT NULL,
    valor_esperado VARCHAR(100),
    valor_minimo VARCHAR(100),
    valor_maximo VARCHAR(100),
    valor_real VARCHAR(100) NOT NULL,
    unidad_medida VARCHAR(20),
    cumple BOOLEAN DEFAULT TRUE,
    nivel_criticidad VARCHAR(20) DEFAULT 'MEDIO',
    -- BAJO, MEDIO, ALTO, CRITICO
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    accion_correctiva TEXT,
    accion_tomada TEXT,
    evidencia_url VARCHAR(500),
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT check_nivel_criticidad CHECK (nivel_criticidad IN ('BAJO', 'MEDIO', 'ALTO', 'CRITICO'))
);

-- Índices para control_calidad
CREATE INDEX idx_calidad_orden ON control_calidad(orden_id);
CREATE INDEX idx_calidad_etapa ON control_calidad(etapa_id);
CREATE INDEX idx_calidad_cumple ON control_calidad(cumple);
CREATE INDEX idx_calidad_tipo ON control_calidad(tipo_control);
CREATE INDEX idx_calidad_fecha ON control_calidad(fecha_registro);

-- =============================================
-- TABLA: recetas
-- Recetas/fórmulas de producción
-- =============================================
CREATE TABLE IF NOT EXISTS recetas (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    codigo VARCHAR(50) UNIQUE NOT NULL,
    tipo_masa VARCHAR(50) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    version INTEGER DEFAULT 1,
    activa BOOLEAN DEFAULT TRUE,
    rendimiento_esperado DECIMAL(5,2),
    -- Porcentaje
    tiempo_total_estimado INTEGER,
    -- Minutos
    temperatura_ambiente_optima DECIMAL(4,1),
    humedad_optima DECIMAL(4,1),
    parametros_proceso JSONB DEFAULT '{}',
    instrucciones TEXT,
    notas TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    creado_por INTEGER REFERENCES usuarios(id),
    actualizado_por INTEGER REFERENCES usuarios(id),
    
    CONSTRAINT check_version CHECK (version > 0)
);

-- Índices para recetas
CREATE INDEX idx_recetas_codigo ON recetas(codigo);
CREATE INDEX idx_recetas_tipo_masa ON recetas(tipo_masa);
CREATE INDEX idx_recetas_activa ON recetas(activa);

-- =============================================
-- TABLA: receta_ingredientes
-- Ingredientes de cada receta
-- =============================================
CREATE TABLE IF NOT EXISTS receta_ingredientes (
    id SERIAL PRIMARY KEY,
    receta_id INTEGER NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
    codigo_ingrediente VARCHAR(50) NOT NULL,
    descripcion VARCHAR(200),
    cantidad DECIMAL(10,3) NOT NULL,
    unidad VARCHAR(10) NOT NULL,
    porcentaje_panadero DECIMAL(5,2),
    orden_adicion INTEGER,
    es_opcional BOOLEAN DEFAULT FALSE,
    temperatura_ideal DECIMAL(4,1),
    observaciones TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_cantidad_ingrediente CHECK (cantidad > 0)
);

-- Índices para receta_ingredientes
CREATE INDEX idx_receta_ingredientes_receta ON receta_ingredientes(receta_id);
CREATE INDEX idx_receta_ingredientes_codigo ON receta_ingredientes(codigo_ingrediente);

-- =============================================
-- TABLA: lotes
-- Control de lotes de producción
-- =============================================
CREATE TABLE IF NOT EXISTS lotes (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    codigo_lote VARCHAR(50) UNIQUE NOT NULL,
    orden_id INTEGER REFERENCES ordenes_produccion(id),
    codigo_producto VARCHAR(50) NOT NULL,
    fecha_produccion DATE NOT NULL,
    fecha_vencimiento DATE,
    cantidad DECIMAL(10,2) NOT NULL,
    cantidad_disponible DECIMAL(10,2) NOT NULL,
    unidad VARCHAR(10) DEFAULT 'KG',
    estado VARCHAR(20) DEFAULT 'DISPONIBLE',
    -- DISPONIBLE, RESERVADO, AGOTADO, VENCIDO, BLOQUEADO
    ubicacion VARCHAR(50),
    almacen VARCHAR(10) DEFAULT '01',
    temperatura_almacenamiento DECIMAL(4,1),
    observaciones TEXT,
    metadata JSONB DEFAULT '{}',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_estado_lote CHECK (estado IN ('DISPONIBLE', 'RESERVADO', 'AGOTADO', 'VENCIDO', 'BLOQUEADO')),
    CONSTRAINT check_cantidad_lote CHECK (cantidad > 0),
    CONSTRAINT check_cantidad_disponible CHECK (cantidad_disponible >= 0)
);

-- Índices para lotes
CREATE INDEX idx_lotes_codigo ON lotes(codigo_lote);
CREATE INDEX idx_lotes_orden ON lotes(orden_id);
CREATE INDEX idx_lotes_producto ON lotes(codigo_producto);
CREATE INDEX idx_lotes_estado ON lotes(estado);
CREATE INDEX idx_lotes_fecha_vencimiento ON lotes(fecha_vencimiento);

-- =============================================
-- TABLA: sap_sync_log
-- Log de sincronizaciones con SAP
-- =============================================
CREATE TABLE IF NOT EXISTS sap_sync_log (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    tipo_operacion VARCHAR(50) NOT NULL,
    -- CREATE_OF, RELEASE_OF, CLOSE_OF, GET_ORDERS, GET_BOM
    estado VARCHAR(20) NOT NULL,
    -- SUCCESS, ERROR, PENDING, RETRY
    sap_docentry INTEGER,
    sap_docnum VARCHAR(20),
    orden_id INTEGER REFERENCES ordenes_produccion(id),
    request_payload JSONB,
    response_payload JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    tiempo_respuesta INTEGER,
    -- Milisegundos
    intentos INTEGER DEFAULT 1,
    fecha_operacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_id INTEGER REFERENCES usuarios(id),
    
    CONSTRAINT check_estado_sync CHECK (estado IN ('SUCCESS', 'ERROR', 'PENDING', 'RETRY'))
);

-- Índices para sap_sync_log
CREATE INDEX idx_sap_sync_tipo ON sap_sync_log(tipo_operacion);
CREATE INDEX idx_sap_sync_estado ON sap_sync_log(estado);
CREATE INDEX idx_sap_sync_fecha ON sap_sync_log(fecha_operacion);
CREATE INDEX idx_sap_sync_orden ON sap_sync_log(orden_id);

-- =============================================
-- TABLA: auditoria
-- Auditoría general del sistema
-- =============================================
CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    tabla VARCHAR(50) NOT NULL,
    registro_id INTEGER NOT NULL,
    accion VARCHAR(20) NOT NULL,
    -- INSERT, UPDATE, DELETE, LOGIN, LOGOUT, ACCESS
    usuario_id INTEGER REFERENCES usuarios(id),
    usuario_nombre VARCHAR(100),
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    cambios JSONB,
    ip_address INET,
    user_agent TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT check_accion CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS'))
);

-- Índices para auditoria
CREATE INDEX idx_auditoria_tabla ON auditoria(tabla);
CREATE INDEX idx_auditoria_registro ON auditoria(registro_id);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha);
CREATE INDEX idx_auditoria_accion ON auditoria(accion);

-- =============================================
-- TABLA: configuracion_sistema
-- Configuraciones del sistema
-- =============================================
CREATE TABLE IF NOT EXISTS configuracion_sistema (
    id SERIAL PRIMARY KEY,
    clave VARCHAR(100) UNIQUE NOT NULL,
    valor TEXT,
    tipo VARCHAR(20) DEFAULT 'STRING',
    -- STRING, NUMBER, BOOLEAN, JSON
    categoria VARCHAR(50),
    descripcion TEXT,
    es_publica BOOLEAN DEFAULT FALSE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_por INTEGER REFERENCES usuarios(id)
);

-- Índices para configuracion_sistema
CREATE INDEX idx_config_clave ON configuracion_sistema(clave);
CREATE INDEX idx_config_categoria ON configuracion_sistema(categoria);

-- =============================================
-- FUNCIONES Y TRIGGERS
-- =============================================

-- Función para actualizar fecha_actualizacion
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_actualizacion = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualización automática
CREATE TRIGGER update_usuarios_timestamp
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_ordenes_timestamp
    BEFORE UPDATE ON ordenes_produccion
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_recetas_timestamp
    BEFORE UPDATE ON recetas
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_lotes_timestamp
    BEFORE UPDATE ON lotes
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- =============================================
-- VISTAS ÚTILES
-- =============================================

-- Vista de órdenes con resumen
CREATE OR REPLACE VIEW v_ordenes_resumen AS
SELECT 
    o.id,
    o.uuid,
    o.codigo_orden,
    o.fecha_planificada,
    o.tipo_masa,
    o.cantidad_planificada,
    o.cantidad_producida,
    o.estado,
    o.eficiencia_produccion,
    u1.nombre_completo AS usuario_inicio_nombre,
    u2.nombre_completo AS usuario_cierre_nombre,
    COUNT(DISTINCT e.id) AS total_etapas,
    COUNT(DISTINCT CASE WHEN e.estado = 'COMPLETADO' THEN e.id END) AS etapas_completadas,
    COUNT(DISTINCT cq.id) AS controles_calidad,
    COUNT(DISTINCT CASE WHEN cq.cumple = false THEN cq.id END) AS controles_no_conformes
FROM ordenes_produccion o
LEFT JOIN usuarios u1 ON o.usuario_inicio = u1.id
LEFT JOIN usuarios u2 ON o.usuario_cierre = u2.id
LEFT JOIN etapas_proceso e ON o.id = e.orden_id
LEFT JOIN control_calidad cq ON o.id = cq.orden_id
GROUP BY o.id, u1.nombre_completo, u2.nombre_completo;

-- Vista de productividad por usuario
CREATE OR REPLACE VIEW v_productividad_usuarios AS
SELECT 
    u.id,
    u.nombre_completo,
    u.rol,
    COUNT(DISTINCT o.id) AS ordenes_trabajadas,
    COUNT(DISTINCT CASE WHEN o.estado = 'COMPLETADO' THEN o.id END) AS ordenes_completadas,
    AVG(o.eficiencia_produccion) AS eficiencia_promedio,
    SUM(o.cantidad_producida) AS total_producido
FROM usuarios u
LEFT JOIN ordenes_produccion o ON u.id = o.usuario_inicio OR u.id = o.usuario_cierre
WHERE u.activo = true
GROUP BY u.id, u.nombre_completo, u.rol;

-- =============================================
-- COMENTARIOS EN TABLAS
-- =============================================
COMMENT ON TABLE usuarios IS 'Usuarios del sistema con control de acceso y seguridad';
COMMENT ON TABLE ordenes_produccion IS 'Órdenes de producción sincronizadas con SAP B1';
COMMENT ON TABLE etapas_proceso IS 'Registro detallado de cada etapa del proceso productivo';
COMMENT ON TABLE control_calidad IS 'Controles de calidad realizados en producción';
COMMENT ON TABLE recetas IS 'Recetas y fórmulas de producción';
COMMENT ON TABLE lotes IS 'Control de lotes de productos terminados';
COMMENT ON TABLE sap_sync_log IS 'Log de sincronizaciones con SAP Business One';
COMMENT ON TABLE auditoria IS 'Auditoría completa de operaciones del sistema';

-- =============================================
-- FIN DEL SCRIPT
-- =============================================
