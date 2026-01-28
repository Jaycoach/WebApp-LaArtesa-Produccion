-- ========================================
-- DATOS SIMPLES DE PRUEBA PARA DEMO
-- Sistema de Gestión de Producción - La Artesa
-- ========================================

-- Limpiar datos existentes
DELETE FROM progreso_fases;
DELETE FROM ingredientes_masa;
DELETE FROM productos_por_masa;
DELETE FROM masas_produccion;

-- ========================================
-- 1. MASAS DE PRODUCCIÓN
-- ========================================

-- Masa 1: Hamburguesa Gold (EN AMASADO)
INSERT INTO masas_produccion (
    codigo_masa, tipo_masa, nombre_masa, fecha_produccion, estado,
    total_kilos_base, total_kilos_con_merma, porcentaje_merma,
    factor_absorcion_usado, fase_actual, created_by
) VALUES (
    'MASA-20260128-GOLD', 'GOLD', 'Hamburguesa Gold', '2026-01-28', 'EN_PROCESO',
    50.0, 52.5, 5.0, 60.0, 'AMASADO', 1
);

-- Masa 2: Pan Árabe (EN PESAJE)
INSERT INTO masas_produccion (
    codigo_masa, tipo_masa, nombre_masa, fecha_produccion, estado,
    total_kilos_base, total_kilos_con_merma, porcentaje_merma,
    factor_absorcion_usado, fase_actual, created_by
) VALUES (
    'MASA-20260128-ARABE', 'ARABE', 'Pan Árabe', '2026-01-28', 'EN_PROCESO',
    65.0, 68.25, 5.0, 60.0, 'PESAJE', 1
);

-- Masa 3: Croissant (PLANIFICACIÓN)
INSERT INTO masas_produccion (
    codigo_masa, tipo_masa, nombre_masa, fecha_produccion, estado,
    total_kilos_base, total_kilos_con_merma, porcentaje_merma,
    factor_absorcion_usado, fase_actual, created_by
) VALUES (
    'MASA-20260128-CROIS', 'CROISSANT', 'Croissant Francés', '2026-01-28', 'PLANIFICACION',
    42.0, 44.1, 5.0, 60.0, 'PESAJE', 1
);

-- ========================================
-- 2. PRODUCTOS POR MASA
-- ========================================

-- Masa 1: Hamburguesa Gold
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
) VALUES
(1, 'HAMB-GOLD-6', 'Hamburguesa Gold x6', 'BOLSA_6', 85, 50, 52, 4.25, 4.42),
(1, 'HAMB-GOLD-12', 'Hamburguesa Gold x12', 'BOLSA_12', 85, 30, 32, 2.55, 2.72);

-- Masa 2: Pan Árabe
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
) VALUES
(2, 'PAN-ARABE-6', 'Pan Árabe x6', 'BOLSA_6', 65, 100, 105, 6.5, 6.83);

-- Masa 3: Croissant
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
) VALUES
(3, 'CROISSANT-12', 'Croissant x12', 'BOLSA_12', 70, 40, 42, 2.8, 2.94);

-- ========================================
-- 3. INGREDIENTES POR MASA
-- ========================================

-- Masa 1: Hamburguesa Gold (52.5kg)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado, peso_real, diferencia_gramos,
    lote, fecha_vencimiento
) VALUES
(1, 'MP-HAR-001', 'Harina Panadera 000', 1, 100.0, true, false, 52500, 52.5, true, true, true, 52520, 20, 'LT-2026-045', '2026-04-28'),
(1, 'MP-AGU-001', 'Agua', 2, 60.0, false, true, 31500, 31.5, true, true, true, 31485, -15, NULL, NULL),
(1, 'MP-AZU-001', 'Azúcar', 3, 12.0, false, false, 6300, 6.3, true, true, true, 6310, 10, 'LT-2026-120', '2027-01-15'),
(1, 'MP-SAL-001', 'Sal', 4, 2.0, false, false, 1050, 1.05, true, true, true, 1048, -2, 'LT-2026-089', '2027-12-31'),
(1, 'MP-LEV-001', 'Levadura Fresca', 5, 3.0, false, false, 1575, 1.575, true, true, true, 1580, 5, 'LT-2026-015', '2026-02-15'),
(1, 'MP-MAN-001', 'Mantequilla', 6, 8.0, false, false, 4200, 4.2, true, true, true, 4195, -5, 'LT-2026-067', '2026-03-30'),
(1, 'MP-HUE-001', 'Huevos', 7, 4.0, false, false, 2100, 2.1, true, true, true, 2108, 8, 'LT-2026-034', '2026-02-10');

-- Masa 2: Pan Árabe (68.25kg)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
) VALUES
(2, 'MP-HAR-001', 'Harina Panadera 000', 1, 100.0, true, false, 68250, 68.25, true, true, false),
(2, 'MP-AGU-001', 'Agua', 2, 65.0, false, true, 44363, 44.363, true, false, false),
(2, 'MP-SAL-001', 'Sal', 3, 1.8, false, false, 1229, 1.229, true, false, false),
(2, 'MP-LEV-002', 'Levadura Seca', 4, 1.0, false, false, 683, 0.683, false, false, false),
(2, 'MP-ACE-001', 'Aceite de Oliva', 5, 3.0, false, false, 2048, 2.048, false, false, false);

-- Masa 3: Croissant (44.1kg)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
) VALUES
(3, 'MP-HAR-001', 'Harina Panadera 000', 1, 100.0, true, false, 44100, 44.1, false, false, false),
(3, 'MP-AGU-001', 'Agua', 2, 50.0, false, true, 22050, 22.05, false, false, false),
(3, 'MP-AZU-001', 'Azúcar', 3, 10.0, false, false, 4410, 4.41, false, false, false),
(3, 'MP-SAL-001', 'Sal', 4, 2.0, false, false, 882, 0.882, false, false, false),
(3, 'MP-LEV-001', 'Levadura Fresca', 5, 5.0, false, false, 2205, 2.205, false, false, false),
(3, 'MP-MAN-002', 'Mantequilla de Laminado', 6, 30.0, false, false, 13230, 13.23, false, false, false),
(3, 'MP-LEC-001', 'Leche en Polvo', 7, 5.0, false, false, 2205, 2.205, false, false, false);

-- ========================================
-- 4. PROGRESO DE FASES
-- ========================================

-- Masa 1: Hamburguesa Gold (EN AMASADO)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, fecha_inicio, fecha_completado) VALUES
(1, 'PESAJE', 'COMPLETADA', 100, '2026-01-28 07:00:00', '2026-01-28 07:45:00'),
(1, 'AMASADO', 'EN_PROGRESO', 60, '2026-01-28 08:00:00', NULL),
(1, 'DIVISION', 'BLOQUEADA', 0, NULL, NULL),
(1, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL),
(1, 'FERMENTACION', 'BLOQUEADA', 0, NULL, NULL),
(1, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL);

-- Masa 2: Pan Árabe (EN PESAJE)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, fecha_inicio) VALUES
(2, 'PESAJE', 'EN_PROGRESO', 40, '2026-01-28 07:30:00'),
(2, 'AMASADO', 'BLOQUEADA', 0, NULL),
(2, 'DIVISION', 'BLOQUEADA', 0, NULL),
(2, 'FORMADO', 'BLOQUEADA', 0, NULL),
(2, 'FERMENTACION', 'BLOQUEADA', 0, NULL),
(2, 'HORNEADO', 'BLOQUEADA', 0, NULL);

-- Masa 3: Croissant (PLANIFICACIÓN)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado) VALUES
(3, 'PESAJE', 'BLOQUEADA', 0),
(3, 'AMASADO', 'BLOQUEADA', 0),
(3, 'DIVISION', 'BLOQUEADA', 0),
(3, 'FORMADO', 'BLOQUEADA', 0),
(3, 'FERMENTACION', 'BLOQUEADA', 0),
(3, 'HORNEADO', 'BLOQUEADA', 0);

-- ========================================
-- 5. CONFIGURACIÓN DEL SISTEMA
-- ========================================
INSERT INTO configuracion_sistema (clave, valor, descripcion, tipo_dato)
VALUES
('factor_absorcion_harina', '60', 'Factor de absorción de agua de la harina actual', 'INTEGER'),
('correos_empaque', 'empaque@artesa.com,bodega@artesa.com', 'Lista de correos para notificaciones de empaque', 'STRING'),
('merma_default', '5', 'Porcentaje de merma por defecto', 'INTEGER')
ON CONFLICT (clave) DO UPDATE
SET valor = EXCLUDED.valor,
    descripcion = EXCLUDED.descripcion,
    tipo_dato = EXCLUDED.tipo_dato;

-- ========================================
-- VERIFICACIÓN
-- ========================================
SELECT 'Masas:', COUNT(*) FROM masas_produccion;
SELECT 'Productos:', COUNT(*) FROM productos_por_masa;
SELECT 'Ingredientes:', COUNT(*) FROM ingredientes_masa;
SELECT 'Progreso:', COUNT(*) FROM progreso_fases;
