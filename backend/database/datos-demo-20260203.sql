-- =====================================================
-- datos-demo-20260203.sql
-- Datos de demostración para el 3 de febrero de 2026
-- Simula órdenes de fabricación de masas para ese día
-- =====================================================

-- Limpiar datos demo anteriores del 3 de febrero de 2026
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
-- MASA 1: Hamburguesa Gold (Para PLANIFICACION)
-- =====================================================

DO $$
DECLARE
    masa1_id INTEGER;
    usuario_demo_id INTEGER;
BEGIN
    -- Obtener ID de usuario demo
    SELECT id INTO usuario_demo_id FROM usuarios WHERE username = 'admin' LIMIT 1;

    -- Insertar masa de producción
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
        fase_actual,
        created_by
    ) VALUES (
        'MASA-20260203-001',
        'GOLD',
        'Hamburguesa Gold',
        '2026-02-03',
        100.0,
        105.0,  -- 100 kg base + 5% merma = 105 kg
        5.0,
        60.0,
        'PLANIFICACION',
        'PLANIFICACION',
        usuario_demo_id
    ) RETURNING id INTO masa1_id;

    -- Productos de la masa
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
        unidades_pedidas, unidades_programadas, unidades_producidas,
        kilos_pedidos, kilos_programados, kilos_producidos
    ) VALUES
    (masa1_id, 'HAMBURGUESA_GOLD_6', 'Hamburguesa Gold x6', 'Por 6', 80.0, 200, 200, 0, 16.0, 16.0, 0),
    (masa1_id, 'HAMBURGUESA_GOLD_12', 'Hamburguesa Gold x12', 'Por 12', 90.0, 400, 400, 0, 36.0, 36.0, 0);

    -- Ingredientes de la masa (composición escalada a 105 kg con merma)
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        porcentaje_panadero, es_harina, es_agua, es_prefermento,
        cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado
    ) VALUES
    (masa1_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 60.0, TRUE, FALSE, FALSE, 63000, 63.0, FALSE, FALSE, FALSE),
    (masa1_id, 'MP-AGUA-001', 'Agua Potable', 2, 45.0, FALSE, TRUE, FALSE, 47250, 47.25, FALSE, FALSE, FALSE),
    (masa1_id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 2100, 2.1, FALSE, FALSE, FALSE),
    (masa1_id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 1.5, FALSE, FALSE, FALSE, 1575, 1.575, FALSE, FALSE, FALSE),
    (masa1_id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 3.0, FALSE, FALSE, FALSE, 3150, 3.15, FALSE, FALSE, FALSE),
    (masa1_id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 5.0, FALSE, FALSE, FALSE, 5250, 5.25, FALSE, FALSE, FALSE),
    (masa1_id, 'MP-PREFERMENTO-001', 'Prefermento Gold', 7, 10.0, FALSE, FALSE, TRUE, 10500, 10.5, FALSE, FALSE, FALSE);

    -- Progreso de fases (PLANIFICACION completada, PESAJE desbloqueado)
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, usuario_responsable) VALUES
    (masa1_id, 'PLANIFICACION', 'COMPLETADA', 100, usuario_demo_id),
    (masa1_id, 'PESAJE', 'EN_PROGRESO', 0, NULL),
    (masa1_id, 'AMASADO', 'BLOQUEADA', 0, NULL),
    (masa1_id, 'DIVISION', 'BLOQUEADA', 0, NULL),
    (masa1_id, 'FORMADO', 'BLOQUEADA', 0, NULL),
    (masa1_id, 'FERMENTACION', 'BLOQUEADA', 0, NULL),
    (masa1_id, 'HORNEADO', 'BLOQUEADA', 0, NULL);

    RAISE NOTICE 'Masa 1 (Hamburguesa Gold) creada con ID: %', masa1_id;

END $$;

-- =====================================================
-- MASA 2: Pan Árabe (Para PLANIFICACION)
-- =====================================================

DO $$
DECLARE
    masa2_id INTEGER;
    usuario_demo_id INTEGER;
BEGIN
    -- Obtener ID de usuario demo
    SELECT id INTO usuario_demo_id FROM usuarios WHERE username = 'admin' LIMIT 1;

    -- Insertar masa de producción
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
        fase_actual,
        created_by
    ) VALUES (
        'MASA-20260203-002',
        'ARABE',
        'Pan Árabe',
        '2026-02-03',
        75.0,
        78.75,  -- 75 kg base + 5% merma = 78.75 kg
        5.0,
        60.0,
        'PLANIFICACION',
        'PLANIFICACION',
        usuario_demo_id
    ) RETURNING id INTO masa2_id;

    -- Productos de la masa
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
        unidades_pedidas, unidades_programadas, unidades_producidas,
        kilos_pedidos, kilos_programados, kilos_producidos
    ) VALUES
    (masa2_id, 'PAN_ARABE_6', 'Pan Árabe x6', 'Por 6', 120.0, 300, 300, 0, 36.0, 36.0, 0),
    (masa2_id, 'PAN_ARABE_GRANEL', 'Pan Árabe Granel', 'Granel', 150.0, 260, 260, 0, 39.0, 39.0, 0);

    -- Ingredientes de la masa (composición escalada a 78.75 kg con merma)
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        porcentaje_panadero, es_harina, es_agua, es_prefermento,
        cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado
    ) VALUES
    (masa2_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 65.0, TRUE, FALSE, FALSE, 51187.5, 51.1875, FALSE, FALSE, FALSE),
    (masa2_id, 'MP-AGUA-001', 'Agua Potable', 2, 48.0, FALSE, TRUE, FALSE, 37800, 37.8, FALSE, FALSE, FALSE),
    (masa2_id, 'MP-SAL-001', 'Sal Marina', 3, 2.5, FALSE, FALSE, FALSE, 1968.75, 1.96875, FALSE, FALSE, FALSE),
    (masa2_id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 2.0, FALSE, FALSE, FALSE, 1575, 1.575, FALSE, FALSE, FALSE),
    (masa2_id, 'MP-ACEITE-001', 'Aceite Vegetal', 5, 3.0, FALSE, FALSE, FALSE, 2362.5, 2.3625, FALSE, FALSE, FALSE);

    -- Progreso de fases
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, usuario_responsable) VALUES
    (masa2_id, 'PLANIFICACION', 'COMPLETADA', 100, usuario_demo_id),
    (masa2_id, 'PESAJE', 'EN_PROGRESO', 0, NULL),
    (masa2_id, 'AMASADO', 'BLOQUEADA', 0, NULL),
    (masa2_id, 'DIVISION', 'BLOQUEADA', 0, NULL),
    (masa2_id, 'FORMADO', 'BLOQUEADA', 0, NULL),
    (masa2_id, 'FERMENTACION', 'BLOQUEADA', 0, NULL),
    (masa2_id, 'HORNEADO', 'BLOQUEADA', 0, NULL);

    RAISE NOTICE 'Masa 2 (Pan Árabe) creada con ID: %', masa2_id;

END $$;

-- =====================================================
-- MASA 3: Croissant (Para PLANIFICACION)
-- =====================================================

DO $$
DECLARE
    masa3_id INTEGER;
    usuario_demo_id INTEGER;
BEGIN
    -- Obtener ID de usuario demo
    SELECT id INTO usuario_demo_id FROM usuarios WHERE username = 'admin' LIMIT 1;

    -- Insertar masa de producción
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
        fase_actual,
        created_by
    ) VALUES (
        'MASA-20260203-003',
        'CROISSANT',
        'Croissant Premium',
        '2026-02-03',
        60.0,
        63.0,  -- 60 kg base + 5% merma = 63 kg
        5.0,
        55.0,
        'PLANIFICACION',
        'PLANIFICACION',
        usuario_demo_id
    ) RETURNING id INTO masa3_id;

    -- Productos de la masa
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
        unidades_pedidas, unidades_programadas, unidades_producidas,
        kilos_pedidos, kilos_programados, kilos_producidos
    ) VALUES
    (masa3_id, 'CROISSANT_6', 'Croissant x6', 'Por 6', 70.0, 350, 350, 0, 24.5, 24.5, 0),
    (masa3_id, 'CROISSANT_12', 'Croissant x12', 'Por 12', 75.0, 500, 500, 0, 37.5, 37.5, 0);

    -- Ingredientes de la masa (composición escalada a 63 kg con merma)
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        porcentaje_panadero, es_harina, es_agua, es_prefermento,
        cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado
    ) VALUES
    (masa3_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 58.0, TRUE, FALSE, FALSE, 36540, 36.54, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-AGUA-001', 'Agua Potable', 2, 40.0, FALSE, TRUE, FALSE, 25200, 25.2, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 1260, 1.26, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 2.5, FALSE, FALSE, FALSE, 1575, 1.575, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 8.0, FALSE, FALSE, FALSE, 5040, 5.04, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 25.0, FALSE, FALSE, FALSE, 15750, 15.75, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-LECHE-001', 'Leche Entera', 7, 5.0, FALSE, FALSE, FALSE, 3150, 3.15, FALSE, FALSE, FALSE);

    -- Progreso de fases
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, usuario_responsable) VALUES
    (masa3_id, 'PLANIFICACION', 'COMPLETADA', 100, usuario_demo_id),
    (masa3_id, 'PESAJE', 'EN_PROGRESO', 0, NULL),
    (masa3_id, 'AMASADO', 'BLOQUEADA', 0, NULL),
    (masa3_id, 'DIVISION', 'BLOQUEADA', 0, NULL),
    (masa3_id, 'FORMADO', 'BLOQUEADA', 0, NULL),
    (masa3_id, 'FERMENTACION', 'BLOQUEADA', 0, NULL),
    (masa3_id, 'HORNEADO', 'BLOQUEADA', 0, NULL);

    RAISE NOTICE 'Masa 3 (Croissant Premium) creada con ID: %', masa3_id;

END $$;

-- =====================================================
-- MASA 4: Brioche (Para PLANIFICACION)
-- =====================================================

DO $$
DECLARE
    masa4_id INTEGER;
    usuario_demo_id INTEGER;
BEGIN
    -- Obtener ID de usuario demo
    SELECT id INTO usuario_demo_id FROM usuarios WHERE username = 'admin' LIMIT 1;

    -- Insertar masa de producción
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
        fase_actual,
        created_by
    ) VALUES (
        'MASA-20260203-004',
        'BRIOCHE',
        'Brioche Hamburguesa',
        '2026-02-03',
        85.0,
        89.25,  -- 85 kg base + 5% merma = 89.25 kg
        5.0,
        58.0,
        'PLANIFICACION',
        'PLANIFICACION',
        usuario_demo_id
    ) RETURNING id INTO masa4_id;

    -- Productos de la masa
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
        unidades_pedidas, unidades_programadas, unidades_producidas,
        kilos_pedidos, kilos_programados, kilos_producidos
    ) VALUES
    (masa4_id, 'BRIOCHE_6', 'Brioche Hamburguesa x6', 'Por 6', 85.0, 450, 450, 0, 38.25, 38.25, 0),
    (masa4_id, 'BRIOCHE_12', 'Brioche Hamburguesa x12', 'Por 12', 95.0, 600, 600, 0, 57.0, 57.0, 0);

    -- Ingredientes de la masa (composición escalada a 89.25 kg con merma)
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        porcentaje_panadero, es_harina, es_agua, es_prefermento,
        cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado
    ) VALUES
    (masa4_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 62.0, TRUE, FALSE, FALSE, 55335, 55.335, FALSE, FALSE, FALSE),
    (masa4_id, 'MP-LECHE-001', 'Leche Entera', 2, 42.0, FALSE, FALSE, FALSE, 37485, 37.485, FALSE, FALSE, FALSE),
    (masa4_id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 1785, 1.785, FALSE, FALSE, FALSE),
    (masa4_id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 2.5, FALSE, FALSE, FALSE, 2231.25, 2.23125, FALSE, FALSE, FALSE),
    (masa4_id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 10.0, FALSE, FALSE, FALSE, 8925, 8.925, FALSE, FALSE, FALSE),
    (masa4_id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 15.0, FALSE, FALSE, FALSE, 13387.5, 13.3875, FALSE, FALSE, FALSE),
    (masa4_id, 'MP-HUEVO-001', 'Huevos', 7, 20.0, FALSE, FALSE, FALSE, 17850, 17.85, FALSE, FALSE, FALSE);

    -- Progreso de fases
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, usuario_responsable) VALUES
    (masa4_id, 'PLANIFICACION', 'COMPLETADA', 100, usuario_demo_id),
    (masa4_id, 'PESAJE', 'EN_PROGRESO', 0, NULL),
    (masa4_id, 'AMASADO', 'BLOQUEADA', 0, NULL),
    (masa4_id, 'DIVISION', 'BLOQUEADA', 0, NULL),
    (masa4_id, 'FORMADO', 'BLOQUEADA', 0, NULL),
    (masa4_id, 'FERMENTACION', 'BLOQUEADA', 0, NULL),
    (masa4_id, 'HORNEADO', 'BLOQUEADA', 0, NULL);

    RAISE NOTICE 'Masa 4 (Brioche Hamburguesa) creada con ID: %', masa4_id;

END $$;

-- =====================================================
-- Verificación de datos insertados
-- =====================================================

DO $$
DECLARE
    total_masas INTEGER;
    total_productos INTEGER;
    total_ingredientes INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_masas FROM masas_produccion WHERE fecha_produccion = '2026-02-03';
    SELECT COUNT(*) INTO total_productos FROM productos_por_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');
    SELECT COUNT(*) INTO total_ingredientes FROM ingredientes_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE fecha_produccion = '2026-02-03');

    RAISE NOTICE '';
    RAISE NOTICE '===============================================';
    RAISE NOTICE 'DATOS DEMO DEL 3 DE FEBRERO DE 2026 CREADOS';
    RAISE NOTICE '===============================================';
    RAISE NOTICE 'Total de masas: %', total_masas;
    RAISE NOTICE 'Total de productos: %', total_productos;
    RAISE NOTICE 'Total de ingredientes: %', total_ingredientes;
    RAISE NOTICE '';
    RAISE NOTICE 'Para ver las masas:';
    RAISE NOTICE 'SELECT * FROM masas_produccion WHERE fecha_produccion = ''2026-02-03'';';
    RAISE NOTICE '';
END $$;
