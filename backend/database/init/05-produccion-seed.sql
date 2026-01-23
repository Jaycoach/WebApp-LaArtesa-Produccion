-- =============================================
-- DATOS SEMILLA - SISTEMA DE PRODUCCIÓN
-- =============================================

-- =============================================
-- Configuración del Sistema
-- =============================================

-- Factor de absorción de harina (60% por defecto)
INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion, es_publica)
VALUES
    ('factor_absorcion_harina', '60', 'NUMBER', 'PRODUCCION', 'Factor de absorción de la harina (porcentaje)', FALSE),
    ('correos_empaque', 'empaque@artesa.com,bodega@artesa.com', 'STRING', 'NOTIFICACIONES', 'Correos electrónicos para notificaciones de empaque (separados por comas)', FALSE)
ON CONFLICT (clave) DO NOTHING;

-- =============================================
-- Amasadoras (REUNIÓN 15/01/2026)
-- Kevin mencionó que tienen 4 amasadoras
-- =============================================

INSERT INTO amasadoras (nombre, codigo, capacidad_kg, tipo, activa, observaciones)
VALUES
    ('Amasadora Industrial 1', 'AMA-IND-01', 100.00, 'INDUSTRIAL', TRUE, 'Amasadora principal para producción'),
    ('Amasadora Industrial 2', 'AMA-IND-02', 100.00, 'INDUSTRIAL', TRUE, 'Amasadora secundaria para producción'),
    ('Amasadora Grande', 'AMA-GRA-01', 150.00, 'INDUSTRIAL', TRUE, 'Amasadora de mayor capacidad'),
    ('Amasadora Pastelería', 'AMA-PAS-01', 50.00, 'PASTELERIA', TRUE, 'Amasadora específica para pastelería')
ON CONFLICT (nombre) DO NOTHING;

-- =============================================
-- Máquinas de Corte (REUNIÓN 15/01/2026)
-- Kevin mencionó Conic y Divisora Manual
-- =============================================

INSERT INTO maquinas_corte (nombre, codigo, tipo, capacidad_kg, activa, observaciones)
VALUES
    ('Conic', 'COR-CON-01', 'CONIC', 100.00, TRUE, 'Máquina de corte automática Conic'),
    ('Divisora Manual', 'COR-MAN-01', 'MANUAL', 50.00, TRUE, 'División manual para masas con reposo')
ON CONFLICT (nombre) DO NOTHING;

-- =============================================
-- Catálogo de Productos (REUNIÓN 15/01/2026)
-- Pesos de masa para división
-- =============================================

INSERT INTO catalogo_productos (codigo_producto, nombre, presentacion, peso_masa_gramos, categoria, tipo_masa, activo)
VALUES
    -- Hamburguesas Gold
    ('HAM-GOLD-6', 'Hamburguesa Gold', 'Por 6', 80.00, 'PAN', 'GOLD', TRUE),
    ('HAM-GOLD-10', 'Hamburguesa Gold', 'Por 10', 80.00, 'PAN', 'GOLD', TRUE),
    ('HAM-GOLD-12', 'Hamburguesa Gold', 'Por 12', 80.00, 'PAN', 'GOLD', TRUE),
    ('HAM-GOLD-GRA', 'Hamburguesa Gold Grande', 'Granel', 100.00, 'PAN', 'GOLD', TRUE),
    ('HAM-GOLD-MED', 'Hamburguesa Gold Mediana', 'Granel', 80.00, 'PAN', 'GOLD', TRUE),
    ('HAM-GOLD-PEQ', 'Hamburguesa Gold Pequeña', 'Granel', 60.00, 'PAN', 'GOLD', TRUE),

    -- Perros
    ('PERRO-6', 'Pan de Perro', 'Por 6', 70.00, 'PAN', 'GOLD', TRUE),
    ('PERRO-10', 'Pan de Perro', 'Por 10', 70.00, 'PAN', 'GOLD', TRUE),
    ('PERRO-12', 'Pan de Perro', 'Por 12', 70.00, 'PAN', 'GOLD', TRUE),

    -- Hamburguesa Brioche
    ('HAM-BRIOCHE-6', 'Hamburguesa Brioche', 'Por 6', 85.00, 'PAN', 'BRIOCHE', TRUE),
    ('HAM-BRIOCHE-12', 'Hamburguesa Brioche', 'Por 12', 85.00, 'PAN', 'BRIOCHE', TRUE),
    ('HAM-BRIOCHE-GRA', 'Hamburguesa Brioche Grande', 'Granel', 100.00, 'PAN', 'BRIOCHE', TRUE),
    ('HAM-BRIOCHE-MED', 'Hamburguesa Brioche Mediana', 'Granel', 85.00, 'PAN', 'BRIOCHE', TRUE),

    -- Pan Árabe
    ('ARABE-6', 'Pan Árabe', 'Por 6', 90.00, 'PAN', 'ARABE', TRUE),
    ('ARABE-12', 'Pan Árabe', 'Por 12', 90.00, 'PAN', 'ARABE', TRUE),

    -- Ciabatta
    ('CIABATTA-6', 'Ciabatta', 'Por 6', 120.00, 'PAN', 'CIABATTA', TRUE),
    ('CIABATTA-PRO-6', 'Ciabatta Provenzal', 'Por 6', 120.00, 'PAN', 'CIABATTA', TRUE),
    ('CIABATTA-SUA-6', 'Ciabatta Suave', 'Por 6', 115.00, 'PAN', 'CIABATTA', TRUE)
ON CONFLICT (codigo_producto) DO NOTHING;

-- =============================================
-- Comentarios
-- =============================================

COMMENT ON TABLE amasadoras IS 'Datos semilla: 4 amasadoras según reunión del 15/01/2026';
COMMENT ON TABLE maquinas_corte IS 'Datos semilla: Conic y Divisora Manual según reunión del 15/01/2026';
COMMENT ON TABLE catalogo_productos IS 'Datos semilla: Productos con pesos de masa para división';
