-- =============================================
-- DATOS DE DEMOSTRACIÓN
-- Script para generar datos de prueba en el sistema
-- Fecha: 2026-01-23
-- =============================================

-- Este script crea datos de demostración para poder probar
-- todas las funcionalidades del sistema sin necesidad de SAP

-- =============================================
-- LIMPIAR DATOS DE DEMO ANTERIORES (OPCIONAL)
-- =============================================
-- ADVERTENCIA: Esto eliminará todos los datos de producción
-- Descomentar solo si se desea limpiar completamente

-- DELETE FROM notificaciones_empaque;
-- DELETE FROM registros_division;
-- DELETE FROM registros_amasado;
-- DELETE FROM progreso_fases;
-- DELETE FROM ingredientes_masa;
-- DELETE FROM productos_por_masa;
-- DELETE FROM orden_masa_relacion;
-- DELETE FROM masas_produccion;

-- =============================================
-- MASA DE PRODUCCIÓN 1: PAN GOLD (En Pesaje)
-- =============================================

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
    fase_bloqueada,
    created_by
) VALUES (
    'GOLD-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-001',
    'GOLD',
    'Masa Gold - Hamburguesas y Perros',
    CURRENT_DATE,
    50.00,
    52.50,
    5.00,
    60.00,
    'PESAJE',
    'PESAJE',
    FALSE,
    1
) ON CONFLICT DO NOTHING;

-- Obtener el ID de la masa creada
DO $$
DECLARE
    masa_gold_id INTEGER;
BEGIN
    SELECT id INTO masa_gold_id
    FROM masas_produccion
    WHERE codigo_masa = 'GOLD-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-001'
    LIMIT 1;

    -- Productos para esta masa
    INSERT INTO productos_por_masa (
        masa_id,
        producto_codigo,
        producto_nombre,
        presentacion,
        gramaje_unitario,
        unidades_pedidas,
        unidades_programadas,
        kilos_pedidos,
        kilos_programados
    ) VALUES
    (masa_gold_id, 'HAM-GOLD-6', 'Hamburguesa Gold', 'Por 6', 80.00, 200, 210, 16.00, 16.80),
    (masa_gold_id, 'HAM-GOLD-10', 'Hamburguesa Gold', 'Por 10', 80.00, 150, 160, 12.00, 12.80),
    (masa_gold_id, 'PERRO-6', 'Pan de Perro', 'Por 6', 70.00, 100, 105, 7.00, 7.35);

    -- Ingredientes con checklist para pesaje
    INSERT INTO ingredientes_masa (
        masa_id,
        ingrediente_sap_code,
        ingrediente_nombre,
        orden_visualizacion,
        porcentaje_panadero,
        es_harina,
        es_agua,
        cantidad_gramos,
        cantidad_kilos,
        disponible,
        verificado,
        pesado
    ) VALUES
    (masa_gold_id, 'MAT-HARINA-001', 'Harina de Trigo 000', 1, 100.00, TRUE, FALSE, 30000.00, 30.000, FALSE, FALSE, FALSE),
    (masa_gold_id, 'MAT-AGUA-001', 'Agua Potable', 2, 60.00, FALSE, TRUE, 18000.00, 18.000, FALSE, FALSE, FALSE),
    (masa_gold_id, 'MAT-SAL-001', 'Sal Refinada', 3, 2.00, FALSE, FALSE, 600.00, 0.600, FALSE, FALSE, FALSE),
    (masa_gold_id, 'MAT-LEVADURA-001', 'Levadura Fresca', 4, 3.00, FALSE, FALSE, 900.00, 0.900, FALSE, FALSE, FALSE),
    (masa_gold_id, 'MAT-AZUCAR-001', 'Azúcar Blanca', 5, 2.00, FALSE, FALSE, 600.00, 0.600, FALSE, FALSE, FALSE),
    (masa_gold_id, 'MAT-GRASA-001', 'Manteca Vegetal', 6, 5.00, FALSE, FALSE, 1500.00, 1.500, FALSE, FALSE, FALSE);

    -- Inicializar progreso de fases
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado) VALUES
    (masa_gold_id, 'PLANIFICACION', 'COMPLETADA', 100),
    (masa_gold_id, 'PESAJE', 'EN_PROGRESO', 0),
    (masa_gold_id, 'AMASADO', 'BLOQUEADA', 0),
    (masa_gold_id, 'DIVISION', 'BLOQUEADA', 0),
    (masa_gold_id, 'FORMADO', 'BLOQUEADA', 0),
    (masa_gold_id, 'FERMENTACION', 'BLOQUEADA', 0),
    (masa_gold_id, 'HORNEADO', 'BLOQUEADA', 0);

    RAISE NOTICE '✓ Masa GOLD creada con ID: %', masa_gold_id;
END $$;

-- =============================================
-- MASA DE PRODUCCIÓN 2: PAN BRIOCHE (Planificación)
-- =============================================

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
    fase_bloqueada,
    created_by
) VALUES (
    'BRIOCHE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-001',
    'BRIOCHE',
    'Masa Brioche - Hamburguesas Premium',
    CURRENT_DATE,
    35.00,
    36.75,
    5.00,
    60.00,
    'PLANIFICACION',
    'PLANIFICACION',
    TRUE,
    1
) ON CONFLICT DO NOTHING;

DO $$
DECLARE
    masa_brioche_id INTEGER;
BEGIN
    SELECT id INTO masa_brioche_id
    FROM masas_produccion
    WHERE codigo_masa = 'BRIOCHE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-001'
    LIMIT 1;

    -- Productos
    INSERT INTO productos_por_masa (
        masa_id,
        producto_codigo,
        producto_nombre,
        presentacion,
        gramaje_unitario,
        unidades_pedidas,
        unidades_programadas,
        kilos_pedidos,
        kilos_programados
    ) VALUES
    (masa_brioche_id, 'HAM-BRIOCHE-6', 'Hamburguesa Brioche', 'Por 6', 85.00, 120, 126, 10.20, 10.71),
    (masa_brioche_id, 'HAM-BRIOCHE-12', 'Hamburguesa Brioche', 'Por 12', 85.00, 180, 189, 15.30, 16.07);

    -- Ingredientes
    INSERT INTO ingredientes_masa (
        masa_id,
        ingrediente_sap_code,
        ingrediente_nombre,
        orden_visualizacion,
        porcentaje_panadero,
        es_harina,
        cantidad_gramos,
        cantidad_kilos,
        disponible,
        verificado,
        pesado
    ) VALUES
    (masa_brioche_id, 'MAT-HARINA-001', 'Harina de Trigo 000', 1, 100.00, TRUE, 20000.00, 20.000, FALSE, FALSE, FALSE),
    (masa_brioche_id, 'MAT-AGUA-001', 'Agua Potable', 2, 50.00, FALSE, 10000.00, 10.000, FALSE, FALSE, FALSE),
    (masa_brioche_id, 'MAT-HUEVO-001', 'Huevos', 3, 30.00, FALSE, 6000.00, 6.000, FALSE, FALSE, FALSE),
    (masa_brioche_id, 'MAT-MANTEQUILLA-001', 'Mantequilla', 4, 20.00, FALSE, 4000.00, 4.000, FALSE, FALSE, FALSE),
    (masa_brioche_id, 'MAT-AZUCAR-001', 'Azúcar Blanca', 5, 15.00, FALSE, 3000.00, 3.000, FALSE, FALSE, FALSE),
    (masa_brioche_id, 'MAT-LEVADURA-001', 'Levadura Fresca', 6, 4.00, FALSE, 800.00, 0.800, FALSE, FALSE, FALSE);

    -- Fases
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado) VALUES
    (masa_brioche_id, 'PLANIFICACION', 'EN_PROGRESO', 80),
    (masa_brioche_id, 'PESAJE', 'BLOQUEADA', 0),
    (masa_brioche_id, 'AMASADO', 'BLOQUEADA', 0),
    (masa_brioche_id, 'DIVISION', 'BLOQUEADA', 0),
    (masa_brioche_id, 'FORMADO', 'BLOQUEADA', 0),
    (masa_brioche_id, 'FERMENTACION', 'BLOQUEADA', 0),
    (masa_brioche_id, 'HORNEADO', 'BLOQUEADA', 0);

    RAISE NOTICE '✓ Masa BRIOCHE creada con ID: %', masa_brioche_id;
END $$;

-- =============================================
-- MASA DE PRODUCCIÓN 3: PAN ÁRABE (Completada)
-- =============================================

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
    fase_bloqueada,
    created_by
) VALUES (
    'ARABE-' || TO_CHAR(CURRENT_DATE - 1, 'YYYYMMDD') || '-001',
    'ARABE',
    'Masa de Pan Árabe',
    CURRENT_DATE - 1,
    25.00,
    26.25,
    5.00,
    60.00,
    'COMPLETADA',
    'HORNEADO',
    FALSE,
    1
) ON CONFLICT DO NOTHING;

DO $$
DECLARE
    masa_arabe_id INTEGER;
BEGIN
    SELECT id INTO masa_arabe_id
    FROM masas_produccion
    WHERE codigo_masa = 'ARABE-' || TO_CHAR(CURRENT_DATE - 1, 'YYYYMMDD') || '-001'
    LIMIT 1;

    -- Productos
    INSERT INTO productos_por_masa (
        masa_id,
        producto_codigo,
        producto_nombre,
        presentacion,
        gramaje_unitario,
        unidades_pedidas,
        unidades_programadas,
        kilos_pedidos,
        kilos_programados,
        unidades_producidas,
        kilos_producidos
    ) VALUES
    (masa_arabe_id, 'ARABE-6', 'Pan Árabe', 'Por 6', 90.00, 200, 210, 18.00, 18.90, 208, 18.72),
    (masa_arabe_id, 'ARABE-12', 'Pan Árabe', 'Por 12', 90.00, 100, 105, 9.00, 9.45, 104, 9.36);

    -- Ingredientes (todos completos)
    INSERT INTO ingredientes_masa (
        masa_id,
        ingrediente_nombre,
        orden_visualizacion,
        porcentaje_panadero,
        es_harina,
        cantidad_gramos,
        cantidad_kilos,
        disponible,
        verificado,
        pesado,
        peso_real
    ) VALUES
    (masa_arabe_id, 'Harina de Trigo 000', 1, 100.00, TRUE, 15000.00, 15.000, TRUE, TRUE, TRUE, 15000.00),
    (masa_arabe_id, 'Agua Potable', 2, 65.00, TRUE, 9750.00, 9.750, TRUE, TRUE, TRUE, 9750.00),
    (masa_arabe_id, 'Sal Refinada', 3, 2.00, FALSE, 300.00, 0.300, TRUE, TRUE, TRUE, 300.00),
    (masa_arabe_id, 'Levadura Fresca', 4, 2.50, FALSE, 375.00, 0.375, TRUE, TRUE, TRUE, 375.00),
    (masa_arabe_id, 'Aceite de Oliva', 5, 5.00, FALSE, 750.00, 0.750, TRUE, TRUE, TRUE, 750.00);

    -- Fases (todas completadas)
    INSERT INTO progreso_fases (
        masa_id,
        fase,
        estado,
        porcentaje_completado,
        fecha_inicio,
        fecha_completado
    ) VALUES
    (masa_arabe_id, 'PLANIFICACION', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '6 hours', CURRENT_DATE - 1 + INTERVAL '7 hours'),
    (masa_arabe_id, 'PESAJE', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '7 hours', CURRENT_DATE - 1 + INTERVAL '8 hours'),
    (masa_arabe_id, 'AMASADO', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '8 hours', CURRENT_DATE - 1 + INTERVAL '9 hours'),
    (masa_arabe_id, 'DIVISION', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '10 hours', CURRENT_DATE - 1 + INTERVAL '11 hours'),
    (masa_arabe_id, 'FORMADO', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '11 hours', CURRENT_DATE - 1 + INTERVAL '12 hours'),
    (masa_arabe_id, 'FERMENTACION', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '12 hours', CURRENT_DATE - 1 + INTERVAL '14 hours'),
    (masa_arabe_id, 'HORNEADO', 'COMPLETADA', 100, CURRENT_DATE - 1 + INTERVAL '14 hours', CURRENT_DATE - 1 + INTERVAL '15 hours');

    RAISE NOTICE '✓ Masa ARABE completada creada con ID: %', masa_arabe_id;
END $$;

-- =============================================
-- MENSAJE FINAL
-- =============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✓ DATOS DE DEMOSTRACIÓN CARGADOS';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Se han creado 3 masas de ejemplo:';
    RAISE NOTICE '1. Masa GOLD - En fase de PESAJE (para practicar checklist)';
    RAISE NOTICE '2. Masa BRIOCHE - En fase de PLANIFICACION';
    RAISE NOTICE '3. Masa ARABE - COMPLETADA (del día anterior)';
    RAISE NOTICE '';
    RAISE NOTICE 'Puedes iniciar sesión con:';
    RAISE NOTICE '  Usuario: admin';
    RAISE NOTICE '  Password: Admin123!@#';
    RAISE NOTICE '';
    RAISE NOTICE 'O con usuarios de prueba:';
    RAISE NOTICE '  supervisor1 / Test123!@#';
    RAISE NOTICE '  operario1 / Test123!@#';
    RAISE NOTICE '';
END $$;
