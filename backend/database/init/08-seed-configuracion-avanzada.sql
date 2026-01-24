-- =====================================================
-- 08-seed-configuracion-avanzada.sql
-- Datos semilla para tablas de configuración avanzada
-- Basado en reuniones 11/12/2025 y 23/01/2026
-- =====================================================

-- =====================================================
-- SEED: catalogo_tipos_masa
-- Mapeo SAP → Tipo de Masa
-- =====================================================
INSERT INTO catalogo_tipos_masa (codigo_sap, tipo_masa, nombre_masa, descripcion, requiere_reposo_pre_division, tiempo_reposo_division_minutos, requiere_formado, requiere_camara_frio, tiempo_fermentacion_estandar_minutos) VALUES
-- Pan Árabe
('PAN_ARABE_OREGANO_JR_4', 'ARABE', 'Pan Árabe Orégano Junior x4', 'Pan árabe con orégano presentación junior', FALSE, NULL, FALSE, FALSE, 40),
('PAN_ARABE_OREGANO_6', 'ARABE', 'Pan Árabe Orégano x6', 'Pan árabe con orégano presentación x6', FALSE, NULL, FALSE, FALSE, 40),
('PAN_ARABE_OREGANO_12', 'ARABE', 'Pan Árabe Orégano x12', 'Pan árabe con orégano presentación x12', FALSE, NULL, FALSE, FALSE, 40),
('PAN_ARABE_CUADRADO_6', 'ARABE', 'Pan Árabe Cuadrado x6', 'Pan árabe cuadrado presentación x6', FALSE, NULL, FALSE, FALSE, 40),
('PAN_ARABE_CUADRADO_10', 'ARABE', 'Pan Árabe Cuadrado x10', 'Pan árabe cuadrado presentación x10', FALSE, NULL, FALSE, FALSE, 40),
('PAN_ARABE_CUADRADO_8', 'ARABE', 'Pan Árabe Cuadrado x8', 'Pan árabe cuadrado presentación x8', FALSE, NULL, FALSE, FALSE, 40),

-- Hamburguesa Gold
('HAMBURGUESA_GOLD_6', 'GOLD', 'Hamburguesa Gold x6', 'Pan de hamburguesa Gold presentación x6', TRUE, 10, TRUE, FALSE, 45),
('HAMBURGUESA_GOLD_10', 'GOLD', 'Hamburguesa Gold x10', 'Pan de hamburguesa Gold presentación x10', TRUE, 10, TRUE, FALSE, 45),
('HAMBURGUESA_GOLD_12', 'GOLD', 'Hamburguesa Gold x12', 'Pan de hamburguesa Gold presentación x12', TRUE, 10, TRUE, FALSE, 45),
('HAMBURGUESA_GOLD_GRANEL', 'GOLD', 'Hamburguesa Gold Granel', 'Pan de hamburguesa Gold a granel', TRUE, 10, TRUE, FALSE, 45),

-- Brioche
('HAMBURGUESA_BRIOCHE_6', 'BRIOCHE', 'Hamburguesa Brioche x6', 'Pan de hamburguesa Brioche presentación x6', TRUE, 15, TRUE, FALSE, 50),
('HAMBURGUESA_BRIOCHE_12', 'BRIOCHE', 'Hamburguesa Brioche x12', 'Pan de hamburguesa Brioche presentación x12', TRUE, 15, TRUE, FALSE, 50),
('HAMBURGUESA_BRIOCHE_GRANEL', 'BRIOCHE', 'Hamburguesa Brioche Granel', 'Pan de hamburguesa Brioche a granel', TRUE, 15, TRUE, FALSE, 50),

-- Ciabatta
('CIABATTA_6', 'CIABATTA', 'Ciabatta x6', 'Pan Ciabatta tradicional x6', TRUE, 20, TRUE, FALSE, 60),
('CIABATTA_PROVENZAL', 'CIABATTA', 'Ciabatta Provenzal', 'Pan Ciabatta estilo provenzal', TRUE, 20, TRUE, FALSE, 60),
('CIABATTA_SUAVE', 'CIABATTA', 'Ciabatta Suave', 'Pan Ciabatta textura suave', TRUE, 20, TRUE, FALSE, 60),

-- Pan de Perro
('PAN_PERRO_6', 'PERRO', 'Pan de Perro x6', 'Pan para perro caliente x6', TRUE, 10, TRUE, FALSE, 40),
('PAN_PERRO_10', 'PERRO', 'Pan de Perro x10', 'Pan para perro caliente x10', TRUE, 10, TRUE, FALSE, 40),
('PAN_PERRO_12', 'PERRO', 'Pan de Perro x12', 'Pan para perro caliente x12', TRUE, 10, TRUE, FALSE, 40),

-- Croissant (requiere frío para desarrollo de sabor)
('CROISSANT_TRADICIONAL', 'CROISSANT', 'Croissant Tradicional', 'Croissant francés tradicional', TRUE, 15, TRUE, TRUE, 120),
('CROISSANT_CHOCOLATE', 'CROISSANT', 'Croissant de Chocolate', 'Croissant relleno de chocolate', TRUE, 15, TRUE, TRUE, 120),

-- Toscano
('TOSCANO_MEDIANO', 'TOSCANO', 'Toscano Mediano', 'Pan Toscano mediano', TRUE, 15, TRUE, FALSE, 50),
('TOSCANO_GRANDE', 'TOSCANO', 'Toscano Grande', 'Pan Toscano grande', TRUE, 15, TRUE, FALSE, 55),

-- Baguette (horno de piso sin damper)
('BAGUETTE_TRADICIONAL', 'BAGUETTE', 'Baguette Tradicional', 'Baguette francés tradicional', TRUE, 20, TRUE, FALSE, 45)
ON CONFLICT (codigo_sap) DO NOTHING;

-- =====================================================
-- SEED: maquinas_formado
-- Máquinas formadoras (3 según transcripción)
-- =====================================================
INSERT INTO maquinas_formado (nombre, codigo, tipo, capacidad_kg, activa, observaciones) VALUES
('Formadora 1', 'FORM_01', 'FORMADORA', 100, TRUE, 'Formadora automática principal'),
('Formadora 2', 'FORM_02', 'FORMADORA', 100, TRUE, 'Formadora automática secundaria'),
('Formadora 3', 'FORM_03', 'FORMADORA', 100, TRUE, 'Formadora automática terciaria'),
('Formado Manual', 'FORM_MANUAL', 'MANUAL', 50, TRUE, 'Estación de formado manual')
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================
-- SEED: especificaciones_formado
-- Especificaciones de medidas según tipo de masa
-- Basado en tabla de especificaciones de Kevin
-- =====================================================
INSERT INTO especificaciones_formado (tipo_masa, producto_codigo, producto_nombre, largo_cm, ancho_cm, alto_cm, diametro_cm, tolerancia_cm) VALUES
-- Toscano Mediano (30cm largo x 19cm ancho según transcripción)
('TOSCANO', 'TOSCANO_MEDIANO', 'Toscano Mediano', 30.0, 19.0, NULL, NULL, 1.0),
('TOSCANO', 'TOSCANO_GRANDE', 'Toscano Grande', 35.0, 22.0, NULL, NULL, 1.0),

-- Hamburguesas (redondas)
('GOLD', 'HAMBURGUESA_GOLD_6', 'Hamburguesa Gold x6', NULL, NULL, 3.0, 10.0, 0.5),
('GOLD', 'HAMBURGUESA_GOLD_10', 'Hamburguesa Gold x10', NULL, NULL, 3.0, 10.0, 0.5),
('GOLD', 'HAMBURGUESA_GOLD_12', 'Hamburguesa Gold x12', NULL, NULL, 3.0, 10.0, 0.5),

('BRIOCHE', 'HAMBURGUESA_BRIOCHE_6', 'Hamburguesa Brioche x6', NULL, NULL, 3.5, 11.0, 0.5),
('BRIOCHE', 'HAMBURGUESA_BRIOCHE_12', 'Hamburguesa Brioche x12', NULL, NULL, 3.5, 11.0, 0.5),

-- Croissant (forma de cuerno)
('CROISSANT', 'CROISSANT_TRADICIONAL', 'Croissant Tradicional', 15.0, 8.0, 5.0, NULL, 1.0),
('CROISSANT', 'CROISSANT_CHOCOLATE', 'Croissant de Chocolate', 15.0, 8.0, 5.0, NULL, 1.0),

-- Ciabatta (rectangular alargado)
('CIABATTA', 'CIABATTA_6', 'Ciabatta x6', 25.0, 12.0, 5.0, NULL, 1.0),
('CIABATTA', 'CIABATTA_PROVENZAL', 'Ciabatta Provenzal', 25.0, 12.0, 5.0, NULL, 1.0),
('CIABATTA', 'CIABATTA_SUAVE', 'Ciabatta Suave', 25.0, 12.0, 5.0, NULL, 1.0),

-- Pan de Perro (alargado)
('PERRO', 'PAN_PERRO_6', 'Pan de Perro x6', 18.0, 6.0, 4.0, NULL, 0.5),
('PERRO', 'PAN_PERRO_10', 'Pan de Perro x10', 18.0, 6.0, 4.0, NULL, 0.5),
('PERRO', 'PAN_PERRO_12', 'Pan de Perro x12', 18.0, 6.0, 4.0, NULL, 0.5),

-- Baguette
('BAGUETTE', 'BAGUETTE_TRADICIONAL', 'Baguette Tradicional', 60.0, 8.0, 6.0, NULL, 2.0)
ON CONFLICT DO NOTHING;

-- =====================================================
-- SEED: tipos_horno
-- Hornos disponibles (3 rotativos + 1 piso según transcripción)
-- =====================================================
INSERT INTO tipos_horno (nombre, codigo, tipo, capacidad_bandejas, tiene_damper, tiene_control_automatico, activo, observaciones) VALUES
('Rotativo 1', 'HORNO_ROT_01', 'ROTATIVO', 16, TRUE, TRUE, TRUE, 'Horno rotativo principal con control digital'),
('Rotativo 2', 'HORNO_ROT_02', 'ROTATIVO', 16, TRUE, TRUE, TRUE, 'Horno rotativo secundario con control digital'),
('Rotativo 3', 'HORNO_ROT_03', 'ROTATIVO', 16, TRUE, TRUE, TRUE, 'Horno rotativo terciario con control digital'),
('Piso', 'HORNO_PISO_01', 'PISO', 8, FALSE, FALSE, TRUE, 'Horno de piso sin damper, ideal para baguettes y laminados')
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================
-- SEED: programas_horneo
-- Programas pre-configurados (ejemplos)
-- =====================================================
INSERT INTO programas_horneo (numero_programa, nombre, descripcion, temperatura_inicial, temperatura_media, temperatura_final, tiempo_temperatura_media, tiempo_total_minutos, usa_damper, tiempo_inicio_damper, tiempo_fin_damper, tipo_masa_sugerido) VALUES
-- Programa 1: Hamburguesas
(1, 'Hamburguesas Estándar', 'Programa para panes de hamburguesa', 180, 200, 190, 5, 15, TRUE, 10, 15, 'GOLD'),
(2, 'Hamburguesas Brioche', 'Programa para hamburguesas brioche', 170, 185, 180, 6, 18, TRUE, 12, 18, 'BRIOCHE'),

-- Programa 3: Pan de Perro
(3, 'Pan de Perro', 'Programa para pan de perro caliente', 190, 210, 200, 4, 12, TRUE, 8, 12, 'PERRO'),

-- Programa 4: Croissant
(4, 'Croissant', 'Programa para croissants laminados', 180, 200, 190, 8, 22, TRUE, 15, 22, 'CROISSANT'),

-- Programa 5: Ciabatta
(5, 'Ciabatta', 'Programa para pan ciabatta', 220, 230, 220, 5, 25, TRUE, 18, 25, 'CIABATTA'),

-- Programa 6: Toscano
(6, 'Toscano', 'Programa para pan toscano', 210, 220, 210, 7, 30, TRUE, 20, 30, 'TOSCANO'),

-- Programa 7: Baguette (SIN damper - horno de piso)
(7, 'Baguette Tradicional', 'Programa para baguettes en horno de piso con humedad', 240, 230, 220, 8, 25, FALSE, NULL, NULL, 'BAGUETTE'),

-- Programa 8: Pan Árabe
(8, 'Pan Árabe', 'Programa para pan árabe', 230, 240, 230, 3, 8, TRUE, 5, 8, 'ARABE'),

-- Programas genéricos adicionales (9-20)
(9, 'Genérico Bajo', 'Programa genérico temperatura baja', 160, 170, 165, 5, 20, FALSE, NULL, NULL, NULL),
(10, 'Genérico Medio', 'Programa genérico temperatura media', 180, 190, 185, 5, 18, TRUE, 12, 18, NULL),
(11, 'Genérico Alto', 'Programa genérico temperatura alta', 220, 230, 225, 5, 15, TRUE, 10, 15, NULL),
(12, 'Pre-cocción', 'Programa para pre-cocción', 160, 170, 160, 7, 12, FALSE, NULL, NULL, NULL),
(13, 'Tostado Rápido', 'Programa para tostado rápido', 200, 220, 210, 3, 10, TRUE, 7, 10, NULL),
(14, 'Cocción Lenta', 'Programa para cocción lenta y pareja', 170, 180, 175, 15, 35, TRUE, 25, 35, NULL),
(15, 'Alta Temperatura Corta', 'Programa de alta temperatura corto', 250, 250, 240, 3, 8, TRUE, 5, 8, NULL),

-- Programas de reserva (16-20 sin configurar)
(16, 'Programa 16', 'Programa sin configurar - Reservado', 180, 190, 185, 5, 15, FALSE, NULL, NULL, NULL),
(17, 'Programa 17', 'Programa sin configurar - Reservado', 180, 190, 185, 5, 15, FALSE, NULL, NULL, NULL),
(18, 'Programa 18', 'Programa sin configurar - Reservado', 180, 190, 185, 5, 15, FALSE, NULL, NULL, NULL),
(19, 'Programa 19', 'Programa sin configurar - Reservado', 180, 190, 185, 5, 15, FALSE, NULL, NULL, NULL),
(20, 'Programa 20', 'Programa sin configurar - Reservado', 180, 190, 185, 5, 15, FALSE, NULL, NULL, NULL)
ON CONFLICT (numero_programa) DO NOTHING;

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
