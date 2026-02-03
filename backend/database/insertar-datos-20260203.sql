-- =====================================================
-- SCRIPT PARA POBLAR DATOS DEL 3 DE FEBRERO DE 2026
-- Versión simplificada sin bloques DO complejos
-- =====================================================

-- Paso 1: Limpiar datos anteriores del 3 de febrero de 2026
DELETE FROM auditoria_cambios WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM notificaciones_empaque WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM registros_horneado WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM registros_fermentacion WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM registros_formado WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM registros_division WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM registros_amasado WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM progreso_fases WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM ingredientes_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM productos_por_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM orden_masa_relacion WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
DELETE FROM masas_produccion WHERE fecha_produccion = '2026-02-03';

-- =====================================================
-- MASA 1: Hamburguesa Gold
-- =====================================================

-- Insertar masa (sin created_by si causa problemas)
INSERT INTO masas_produccion (
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    total_kilos_base,
    total_kilos_con_merma,
    porcentaje_merma,
    factor_absorcion_usado,
    estado,
    fase_actual
) VALUES (
    'MASA-20260203-001',
    'GOLD',
    'Hamburguesa Gold',
    '2026-02-03',
    100.0,
    105.0,
    5.0,
    60.0,
    'PLANIFICACION',
    'PLANIFICACION'
);

-- Obtener el ID de la masa recién insertada
WITH masa_gold AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-001'
)
-- Insertar productos
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, unidades_producidas,
    kilos_pedidos, kilos_programados, kilos_producidos
)
SELECT
    id, 'HAMBURGUESA_GOLD_6', 'Hamburguesa Gold x6', 'Por 6', 80.0,
    200, 200, 0, 16.0, 16.0, 0
FROM masa_gold
UNION ALL
SELECT
    id, 'HAMBURGUESA_GOLD_12', 'Hamburguesa Gold x12', 'Por 12', 90.0,
    400, 400, 0, 36.0, 36.0, 0
FROM masa_gold;

-- Insertar ingredientes
WITH masa_gold AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-001'
)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, es_prefermento,
    cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
)
SELECT id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 60.0, TRUE, FALSE, FALSE, 63000, 63.0, FALSE, FALSE, FALSE FROM masa_gold
UNION ALL
SELECT id, 'MP-AGUA-001', 'Agua Potable', 2, 45.0, FALSE, TRUE, FALSE, 47250, 47.25, FALSE, FALSE, FALSE FROM masa_gold
UNION ALL
SELECT id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 2100, 2.1, FALSE, FALSE, FALSE FROM masa_gold
UNION ALL
SELECT id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 1.5, FALSE, FALSE, FALSE, 1575, 1.575, FALSE, FALSE, FALSE FROM masa_gold
UNION ALL
SELECT id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 3.0, FALSE, FALSE, FALSE, 3150, 3.15, FALSE, FALSE, FALSE FROM masa_gold
UNION ALL
SELECT id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 5.0, FALSE, FALSE, FALSE, 5250, 5.25, FALSE, FALSE, FALSE FROM masa_gold
UNION ALL
SELECT id, 'MP-PREFERMENTO-001', 'Prefermento Gold', 7, 10.0, FALSE, FALSE, TRUE, 10500, 10.5, FALSE, FALSE, FALSE FROM masa_gold;

-- Insertar progreso de fases
WITH masa_gold AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-001'
)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
SELECT id, 'PLANIFICACION', 'COMPLETADA', 100 FROM masa_gold
UNION ALL
SELECT id, 'PESAJE', 'EN_PROGRESO', 0 FROM masa_gold
UNION ALL
SELECT id, 'AMASADO', 'BLOQUEADA', 0 FROM masa_gold
UNION ALL
SELECT id, 'DIVISION', 'BLOQUEADA', 0 FROM masa_gold
UNION ALL
SELECT id, 'FORMADO', 'BLOQUEADA', 0 FROM masa_gold
UNION ALL
SELECT id, 'FERMENTACION', 'BLOQUEADA', 0 FROM masa_gold
UNION ALL
SELECT id, 'HORNEADO', 'BLOQUEADA', 0 FROM masa_gold;

-- =====================================================
-- MASA 2: Pan Árabe
-- =====================================================

INSERT INTO masas_produccion (
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    total_kilos_base,
    total_kilos_con_merma,
    porcentaje_merma,
    factor_absorcion_usado,
    estado,
    fase_actual
) VALUES (
    'MASA-20260203-002',
    'ARABE',
    'Pan Árabe',
    '2026-02-03',
    75.0,
    78.75,
    5.0,
    60.0,
    'PLANIFICACION',
    'PLANIFICACION'
);

WITH masa_arabe AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-002'
)
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, unidades_producidas,
    kilos_pedidos, kilos_programados, kilos_producidos
)
SELECT id, 'PAN_ARABE_6', 'Pan Árabe x6', 'Por 6', 120.0, 300, 300, 0, 36.0, 36.0, 0 FROM masa_arabe
UNION ALL
SELECT id, 'PAN_ARABE_GRANEL', 'Pan Árabe Granel', 'Granel', 150.0, 260, 260, 0, 39.0, 39.0, 0 FROM masa_arabe;

WITH masa_arabe AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-002'
)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, es_prefermento,
    cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
)
SELECT id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 65.0, TRUE, FALSE, FALSE, 51187.5, 51.1875, FALSE, FALSE, FALSE FROM masa_arabe
UNION ALL
SELECT id, 'MP-AGUA-001', 'Agua Potable', 2, 48.0, FALSE, TRUE, FALSE, 37800, 37.8, FALSE, FALSE, FALSE FROM masa_arabe
UNION ALL
SELECT id, 'MP-SAL-001', 'Sal Marina', 3, 2.5, FALSE, FALSE, FALSE, 1968.75, 1.96875, FALSE, FALSE, FALSE FROM masa_arabe
UNION ALL
SELECT id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 2.0, FALSE, FALSE, FALSE, 1575, 1.575, FALSE, FALSE, FALSE FROM masa_arabe
UNION ALL
SELECT id, 'MP-ACEITE-001', 'Aceite Vegetal', 5, 3.0, FALSE, FALSE, FALSE, 2362.5, 2.3625, FALSE, FALSE, FALSE FROM masa_arabe;

WITH masa_arabe AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-002'
)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
SELECT id, 'PLANIFICACION', 'COMPLETADA', 100 FROM masa_arabe
UNION ALL
SELECT id, 'PESAJE', 'EN_PROGRESO', 0 FROM masa_arabe
UNION ALL
SELECT id, 'AMASADO', 'BLOQUEADA', 0 FROM masa_arabe
UNION ALL
SELECT id, 'DIVISION', 'BLOQUEADA', 0 FROM masa_arabe
UNION ALL
SELECT id, 'FORMADO', 'BLOQUEADA', 0 FROM masa_arabe
UNION ALL
SELECT id, 'FERMENTACION', 'BLOQUEADA', 0 FROM masa_arabe
UNION ALL
SELECT id, 'HORNEADO', 'BLOQUEADA', 0 FROM masa_arabe;

-- =====================================================
-- MASA 3: Croissant Premium
-- =====================================================

INSERT INTO masas_produccion (
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    total_kilos_base,
    total_kilos_con_merma,
    porcentaje_merma,
    factor_absorcion_usado,
    estado,
    fase_actual
) VALUES (
    'MASA-20260203-003',
    'CROISSANT',
    'Croissant Premium',
    '2026-02-03',
    60.0,
    63.0,
    5.0,
    55.0,
    'PLANIFICACION',
    'PLANIFICACION'
);

WITH masa_croissant AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-003'
)
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, unidades_producidas,
    kilos_pedidos, kilos_programados, kilos_producidos
)
SELECT id, 'CROISSANT_6', 'Croissant x6', 'Por 6', 70.0, 350, 350, 0, 24.5, 24.5, 0 FROM masa_croissant
UNION ALL
SELECT id, 'CROISSANT_12', 'Croissant x12', 'Por 12', 75.0, 500, 500, 0, 37.5, 37.5, 0 FROM masa_croissant;

WITH masa_croissant AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-003'
)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, es_prefermento,
    cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
)
SELECT id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 58.0, TRUE, FALSE, FALSE, 36540, 36.54, FALSE, FALSE, FALSE FROM masa_croissant
UNION ALL
SELECT id, 'MP-AGUA-001', 'Agua Potable', 2, 40.0, FALSE, TRUE, FALSE, 25200, 25.2, FALSE, FALSE, FALSE FROM masa_croissant
UNION ALL
SELECT id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 1260, 1.26, FALSE, FALSE, FALSE FROM masa_croissant
UNION ALL
SELECT id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 2.5, FALSE, FALSE, FALSE, 1575, 1.575, FALSE, FALSE, FALSE FROM masa_croissant
UNION ALL
SELECT id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 8.0, FALSE, FALSE, FALSE, 5040, 5.04, FALSE, FALSE, FALSE FROM masa_croissant
UNION ALL
SELECT id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 25.0, FALSE, FALSE, FALSE, 15750, 15.75, FALSE, FALSE, FALSE FROM masa_croissant
UNION ALL
SELECT id, 'MP-LECHE-001', 'Leche Entera', 7, 5.0, FALSE, FALSE, FALSE, 3150, 3.15, FALSE, FALSE, FALSE FROM masa_croissant;

WITH masa_croissant AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-003'
)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
SELECT id, 'PLANIFICACION', 'COMPLETADA', 100 FROM masa_croissant
UNION ALL
SELECT id, 'PESAJE', 'EN_PROGRESO', 0 FROM masa_croissant
UNION ALL
SELECT id, 'AMASADO', 'BLOQUEADA', 0 FROM masa_croissant
UNION ALL
SELECT id, 'DIVISION', 'BLOQUEADA', 0 FROM masa_croissant
UNION ALL
SELECT id, 'FORMADO', 'BLOQUEADA', 0 FROM masa_croissant
UNION ALL
SELECT id, 'FERMENTACION', 'BLOQUEADA', 0 FROM masa_croissant
UNION ALL
SELECT id, 'HORNEADO', 'BLOQUEADA', 0 FROM masa_croissant;

-- =====================================================
-- MASA 4: Brioche Hamburguesa
-- =====================================================

INSERT INTO masas_produccion (
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    total_kilos_base,
    total_kilos_con_merma,
    porcentaje_merma,
    factor_absorcion_usado,
    estado,
    fase_actual
) VALUES (
    'MASA-20260203-004',
    'BRIOCHE',
    'Brioche Hamburguesa',
    '2026-02-03',
    85.0,
    89.25,
    5.0,
    58.0,
    'PLANIFICACION',
    'PLANIFICACION'
);

WITH masa_brioche AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-004'
)
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
    unidades_pedidas, unidades_programadas, unidades_producidas,
    kilos_pedidos, kilos_programados, kilos_producidos
)
SELECT id, 'BRIOCHE_6', 'Brioche Hamburguesa x6', 'Por 6', 85.0, 450, 450, 0, 38.25, 38.25, 0 FROM masa_brioche
UNION ALL
SELECT id, 'BRIOCHE_12', 'Brioche Hamburguesa x12', 'Por 12', 95.0, 600, 600, 0, 57.0, 57.0, 0 FROM masa_brioche;

WITH masa_brioche AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-004'
)
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua, es_prefermento,
    cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
)
SELECT id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 62.0, TRUE, FALSE, FALSE, 55335, 55.335, FALSE, FALSE, FALSE FROM masa_brioche
UNION ALL
SELECT id, 'MP-LECHE-001', 'Leche Entera', 2, 42.0, FALSE, FALSE, FALSE, 37485, 37.485, FALSE, FALSE, FALSE FROM masa_brioche
UNION ALL
SELECT id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 1785, 1.785, FALSE, FALSE, FALSE FROM masa_brioche
UNION ALL
SELECT id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 2.5, FALSE, FALSE, FALSE, 2231.25, 2.23125, FALSE, FALSE, FALSE FROM masa_brioche
UNION ALL
SELECT id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 10.0, FALSE, FALSE, FALSE, 8925, 8.925, FALSE, FALSE, FALSE FROM masa_brioche
UNION ALL
SELECT id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 15.0, FALSE, FALSE, FALSE, 13387.5, 13.3875, FALSE, FALSE, FALSE FROM masa_brioche
UNION ALL
SELECT id, 'MP-HUEVO-001', 'Huevos', 7, 20.0, FALSE, FALSE, FALSE, 17850, 17.85, FALSE, FALSE, FALSE FROM masa_brioche;

WITH masa_brioche AS (
    SELECT id FROM masas_produccion WHERE codigo_masa = 'MASA-20260203-004'
)
INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado)
SELECT id, 'PLANIFICACION', 'COMPLETADA', 100 FROM masa_brioche
UNION ALL
SELECT id, 'PESAJE', 'EN_PROGRESO', 0 FROM masa_brioche
UNION ALL
SELECT id, 'AMASADO', 'BLOQUEADA', 0 FROM masa_brioche
UNION ALL
SELECT id, 'DIVISION', 'BLOQUEADA', 0 FROM masa_brioche
UNION ALL
SELECT id, 'FORMADO', 'BLOQUEADA', 0 FROM masa_brioche
UNION ALL
SELECT id, 'FERMENTACION', 'BLOQUEADA', 0 FROM masa_brioche
UNION ALL
SELECT id, 'HORNEADO', 'BLOQUEADA', 0 FROM masa_brioche;

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================

SELECT
    codigo_masa,
    tipo_masa,
    nombre_masa,
    total_kilos_base,
    total_kilos_con_merma,
    porcentaje_merma,
    fecha_produccion,
    'Cálculo: ' || total_kilos_base || ' + ' || (total_kilos_base * porcentaje_merma / 100)::numeric(10,2) || ' = ' || total_kilos_con_merma AS verificacion
FROM masas_produccion
WHERE fecha_produccion = '2026-02-03'
ORDER BY codigo_masa;

SELECT
    'Total masas: ' || COUNT(*) ||
    ' | Total productos: ' || (SELECT COUNT(*) FROM productos_por_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03')) ||
    ' | Total ingredientes: ' || (SELECT COUNT(*) FROM ingredientes_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03'))
    AS resumen
FROM masas_produccion
WHERE fecha_produccion = '2026-02-03';
