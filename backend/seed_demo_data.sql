-- ========================================
-- SCRIPT DE DATOS DE PRUEBA PARA DEMO
-- Sistema de Gestión de Producción - La Artesa
-- ========================================

-- Limpiar datos existentes (mantener usuarios)
TRUNCATE TABLE progreso_fases, productos_por_masa, ingredientes_masa,
               orden_masa_relacion, masas_produccion, ordenes_produccion,
               receta_ingredientes, recetas, lotes, etapas_proceso
               RESTART IDENTITY CASCADE;

-- ========================================
-- 1. RECETAS BASE
-- ========================================
INSERT INTO recetas (nombre, tipo_producto, descripcion, tiempo_preparacion, rendimiento, activa) VALUES
('Hamburguesa Gold', 'PAN', 'Receta de pan de hamburguesa premium', 120, 100, true),
('Pan Árabe', 'PAN', 'Receta de pan árabe tradicional', 90, 150, true),
('Croissant', 'PANADERIA', 'Receta de croissant francés', 180, 80, true);

-- ========================================
-- 2. INGREDIENTES DE LAS RECETAS
-- ========================================
-- Receta 1: Hamburguesa Gold (ID: 1)
INSERT INTO receta_ingredientes (receta_id, nombre_ingrediente, cantidad_gramos, unidad_medida, porcentaje, es_harina, orden_proceso) VALUES
(1, 'Harina Panadera 000', 10000, 'g', 100.0, true, 1),
(1, 'Agua', 6000, 'ml', 60.0, false, 2),
(1, 'Azúcar', 1200, 'g', 12.0, false, 3),
(1, 'Sal', 200, 'g', 2.0, false, 4),
(1, 'Levadura Fresca', 300, 'g', 3.0, false, 5),
(1, 'Mantequilla', 800, 'g', 8.0, false, 6),
(1, 'Huevos', 400, 'g', 4.0, false, 7);

-- Receta 2: Pan Árabe (ID: 2)
INSERT INTO receta_ingredientes (receta_id, nombre_ingrediente, cantidad_gramos, unidad_medida, porcentaje, es_harina, orden_proceso) VALUES
(2, 'Harina Panadera 000', 10000, 'g', 100.0, true, 1),
(2, 'Agua', 6500, 'ml', 65.0, false, 2),
(2, 'Sal', 180, 'g', 1.8, false, 3),
(2, 'Levadura Seca', 100, 'g', 1.0, false, 4),
(2, 'Aceite de Oliva', 300, 'g', 3.0, false, 5);

-- Receta 3: Croissant (ID: 3)
INSERT INTO receta_ingredientes (receta_id, nombre_ingrediente, cantidad_gramos, unidad_medida, porcentaje, es_harina, orden_proceso) VALUES
(3, 'Harina Panadera 000', 10000, 'g', 100.0, true, 1),
(3, 'Agua', 5000, 'ml', 50.0, false, 2),
(3, 'Azúcar', 1000, 'g', 10.0, false, 3),
(3, 'Sal', 200, 'g', 2.0, false, 4),
(3, 'Levadura Fresca', 500, 'g', 5.0, false, 5),
(3, 'Mantequilla de Laminado', 3000, 'g', 30.0, false, 6),
(3, 'Leche en Polvo', 500, 'g', 5.0, false, 7);

-- ========================================
-- 3. ÓRDENES DE PRODUCCIÓN (SAP Simuladas)
-- ========================================
INSERT INTO ordenes_produccion (codigo_sap, numero_orden, producto_sap, descripcion_producto, cantidad_planificada, unidad_medida, fecha_planificada, fecha_entrega, estado, tipo_masa, prioridad) VALUES
('OF-20260128-001', '1001', 'HAMB-GOLD-6', 'Hamburguesa Gold x6 unidades', 50, 'BOLSAS', '2026-01-28', '2026-01-28', 'LIBERADA', 'GOLD', 'ALTA'),
('OF-20260128-002', '1002', 'HAMB-GOLD-12', 'Hamburguesa Gold x12 unidades', 30, 'BOLSAS', '2026-01-28', '2026-01-28', 'LIBERADA', 'GOLD', 'ALTA'),
('OF-20260128-003', '1003', 'PAN-ARABE-6', 'Pan Árabe x6 unidades', 100, 'BOLSAS', '2026-01-28', '2026-01-28', 'LIBERADA', 'ARABE', 'MEDIA'),
('OF-20260128-004', '1004', 'CROISSANT-12', 'Croissant x12 unidades', 40, 'BOLSAS', '2026-01-28', '2026-01-28', 'LIBERADA', 'CROISSANT', 'MEDIA');

-- ========================================
-- 4. MASAS DE PRODUCCIÓN AGRUPADAS
-- ========================================
-- Masa 1: Hamburguesa Gold (agrupa orden 1 y 2)
INSERT INTO masas_produccion (codigo_masa, tipo_masa, fecha_produccion, total_kilos_base, merma_porcentaje, kilos_con_merma, factor_absorcion, estado, fase_actual, receta_id) VALUES
('MASA-20260128-GOLD', 'GOLD', '2026-01-28', 50.0, 5.0, 52.5, 60.0, 'EN_PROCESO', 'AMASADO', 1);

-- Masa 2: Pan Árabe
INSERT INTO masas_produccion (codigo_masa, tipo_masa, fecha_produccion, total_kilos_base, merma_porcentaje, kilos_con_merma, factor_absorcion, estado, fase_actual, receta_id) VALUES
('MASA-20260128-ARABE', 'ARABE', '2026-01-28', 65.0, 5.0, 68.25, 60.0, 'PLANIFICACION', 'PESAJE', 2);

-- Masa 3: Croissant
INSERT INTO masas_produccion (codigo_masa, tipo_masa, fecha_produccion, total_kilos_base, merma_porcentaje, kilos_con_merma, factor_absorcion, estado, fase_actual, receta_id) VALUES
('MASA-20260128-CROIS', 'CROISSANT', '2026-01-28', 42.0, 5.0, 44.1, 60.0, 'PLANIFICACION', 'PESAJE', 3);

-- ========================================
-- 5. RELACIÓN ÓRDENES CON MASAS
-- ========================================
INSERT INTO orden_masa_relacion (orden_id, masa_id) VALUES
(1, 1), -- OF-001 → MASA-GOLD
(2, 1), -- OF-002 → MASA-GOLD
(3, 2), -- OF-003 → MASA-ARABE
(4, 3); -- OF-004 → MASA-CROIS

-- ========================================
-- 6. PRODUCTOS POR MASA
-- ========================================
-- Masa 1: Hamburguesa Gold
INSERT INTO productos_por_masa (masa_id, orden_id, codigo_producto, descripcion_producto, unidades_pedidas, unidades_programadas, cantidad_divisiones, division_completada, peso_unitario) VALUES
(1, 1, 'HAMB-GOLD-6', 'Hamburguesa Gold x6', 50, 52, 0, false, 85.0),
(1, 2, 'HAMB-GOLD-12', 'Hamburguesa Gold x12', 30, 32, 0, false, 85.0);

-- Masa 2: Pan Árabe
INSERT INTO productos_por_masa (masa_id, orden_id, codigo_producto, descripcion_producto, unidades_pedidas, unidades_programadas, cantidad_divisiones, division_completada, peso_unitario) VALUES
(2, 3, 'PAN-ARABE-6', 'Pan Árabe x6', 100, 105, 0, false, 65.0);

-- Masa 3: Croissant
INSERT INTO productos_por_masa (masa_id, orden_id, codigo_producto, descripcion_producto, unidades_pedidas, unidades_programadas, cantidad_divisiones, division_completada, peso_unitario) VALUES
(3, 4, 'CROISSANT-12', 'Croissant x12', 40, 42, 0, false, 70.0);

-- ========================================
-- 7. INGREDIENTES POR MASA (Escalados)
-- ========================================
-- Masa 1: Hamburguesa Gold (50kg → 52.5kg con merma)
INSERT INTO ingredientes_masa (masa_id, ingrediente, cantidad_gramos, es_harina, disponible, verificado, pesado, peso_real, lote, fecha_vencimiento) VALUES
(1, 'Harina Panadera 000', 52500, true, false, false, false, NULL, NULL, NULL),
(1, 'Agua', 31500, false, false, false, false, NULL, NULL, NULL),
(1, 'Azúcar', 6300, false, false, false, false, NULL, NULL, NULL),
(1, 'Sal', 1050, false, false, false, false, NULL, NULL, NULL),
(1, 'Levadura Fresca', 1575, false, false, false, false, NULL, NULL, NULL),
(1, 'Mantequilla', 4200, false, false, false, false, NULL, NULL, NULL),
(1, 'Huevos', 2100, false, false, false, false, NULL, NULL, NULL);

-- Masa 2: Pan Árabe (65kg → 68.25kg con merma)
INSERT INTO ingredientes_masa (masa_id, ingrediente, cantidad_gramos, es_harina, disponible, verificado, pesado, peso_real, lote, fecha_vencimiento) VALUES
(2, 'Harina Panadera 000', 68250, true, false, false, false, NULL, NULL, NULL),
(2, 'Agua', 44363, false, false, false, false, NULL, NULL, NULL),
(2, 'Sal', 1229, false, false, false, false, NULL, NULL, NULL),
(2, 'Levadura Seca', 683, false, false, false, false, NULL, NULL, NULL),
(2, 'Aceite de Oliva', 2048, false, false, false, false, NULL, NULL, NULL);

-- Masa 3: Croissant (42kg → 44.1kg con merma)
INSERT INTO ingredientes_masa (masa_id, ingrediente, cantidad_gramos, es_harina, disponible, verificado, pesado, peso_real, lote, fecha_vencimiento) VALUES
(3, 'Harina Panadera 000', 44100, true, false, false, false, NULL, NULL, NULL),
(3, 'Agua', 22050, false, false, false, false, NULL, NULL, NULL),
(3, 'Azúcar', 4410, false, false, false, false, NULL, NULL, NULL),
(3, 'Sal', 882, false, false, false, false, NULL, NULL, NULL),
(3, 'Levadura Fresca', 2205, false, false, false, false, NULL, NULL, NULL),
(3, 'Mantequilla de Laminado', 13230, false, false, false, false, NULL, NULL, NULL),
(3, 'Leche en Polvo', 2205, false, false, false, false, NULL, NULL, NULL);

-- ========================================
-- 8. PROGRESO DE FASES
-- ========================================
-- Masa 1: Hamburguesa Gold (EN AMASADO)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje, fecha_inicio, fecha_completado) VALUES
(1, 'PESAJE', 'COMPLETADA', 100, '2026-01-28 07:00:00', '2026-01-28 07:45:00'),
(1, 'AMASADO', 'EN_PROGRESO', 60, '2026-01-28 08:00:00', NULL),
(1, 'DIVISION', 'BLOQUEADA', 0, NULL, NULL),
(1, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL),
(1, 'FERMENTACION', 'BLOQUEADA', 0, NULL, NULL),
(1, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL);

-- Masa 2: Pan Árabe (EN PESAJE)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje, fecha_inicio, fecha_completado) VALUES
(2, 'PESAJE', 'EN_PROGRESO', 40, '2026-01-28 07:30:00', NULL),
(2, 'AMASADO', 'BLOQUEADA', 0, NULL, NULL),
(2, 'DIVISION', 'BLOQUEADA', 0, NULL, NULL),
(2, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL),
(2, 'FERMENTACION', 'BLOQUEADA', 0, NULL, NULL),
(2, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL);

-- Masa 3: Croissant (PLANIFICACIÓN)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje, fecha_inicio, fecha_completado) VALUES
(3, 'PESAJE', 'BLOQUEADA', 0, NULL, NULL),
(3, 'AMASADO', 'BLOQUEADA', 0, NULL, NULL),
(3, 'DIVISION', 'BLOQUEADA', 0, NULL, NULL),
(3, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL),
(3, 'FERMENTACION', 'BLOQUEADA', 0, NULL, NULL),
(3, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL);

-- ========================================
-- 9. ACTUALIZAR INGREDIENTES PESADOS (Masa 1)
-- ========================================
UPDATE ingredientes_masa SET
    disponible = true,
    verificado = true,
    pesado = true,
    peso_real = cantidad_gramos + (random() * 100 - 50)::integer,
    lote = 'LT-2026-' || lpad((random() * 999)::integer::text, 3, '0'),
    fecha_vencimiento = CURRENT_DATE + interval '90 days'
WHERE masa_id = 1;

-- ========================================
-- 10. CONFIGURACIÓN DEL SISTEMA
-- ========================================
DELETE FROM configuracion_sistema;
INSERT INTO configuracion_sistema (clave, valor, descripcion, tipo_dato) VALUES
('factor_absorcion_harina', '60', 'Factor de absorción de agua de la harina actual', 'INTEGER'),
('correos_empaque', 'empaque@artesa.com,bodega@artesa.com', 'Lista de correos para notificaciones de empaque', 'STRING'),
('merma_default', '5', 'Porcentaje de merma por defecto', 'INTEGER'),
('smtp_host', 'smtp.gmail.com', 'Servidor SMTP para envío de correos', 'STRING'),
('smtp_port', '587', 'Puerto SMTP', 'INTEGER'),
('smtp_secure', 'false', 'Usar TLS/SSL', 'BOOLEAN');

-- ========================================
-- VERIFICACIÓN DE DATOS
-- ========================================
SELECT 'DATOS DE PRUEBA INSERTADOS CORRECTAMENTE' as status;
SELECT 'Masas creadas:' as info, COUNT(*) as cantidad FROM masas_produccion;
SELECT 'Órdenes creadas:' as info, COUNT(*) as cantidad FROM ordenes_produccion;
SELECT 'Productos por masa:' as info, COUNT(*) as cantidad FROM productos_por_masa;
SELECT 'Ingredientes por masa:' as info, COUNT(*) as cantidad FROM ingredientes_masa;
SELECT 'Progreso de fases:' as info, COUNT(*) as cantidad FROM progreso_fases;
