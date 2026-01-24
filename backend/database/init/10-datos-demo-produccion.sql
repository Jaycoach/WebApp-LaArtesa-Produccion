-- =====================================================
-- 10-datos-demo-produccion.sql
-- Datos de demostración para un día de producción completo
-- Simula el flujo completo desde sincronización SAP hasta horneado
-- NO VERSIONAR EN GIT - Solo para desarrollo/demos
-- =====================================================

-- Limpiar datos demo anteriores
DELETE FROM auditoria_cambios WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM notificaciones_empaque WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM registros_horneado WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM registros_fermentacion WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM registros_formado WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM registros_division WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM registros_amasado WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM progreso_fases WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM ingredientes_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM productos_por_masa WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM orden_masa_relacion WHERE masa_id IN (SELECT id FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%');
DELETE FROM masas_produccion WHERE codigo_masa LIKE 'DEMO-%';

-- =====================================================
-- MASA 1: Hamburguesa Gold (COMPLETADA - Todo el flujo)
-- =====================================================

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
    fase_actual
) VALUES (
    'DEMO-20260123-001',
    'GOLD',
    'Hamburguesa Gold',
    CURRENT_DATE,
    50.0,
    52.5,
    5.0,
    60.0,
    'COMPLETADA',
    'HORNEADO'
) RETURNING id INTO @masa1_id;

-- Variable para almacenar ID (en PostgreSQL usamos una forma diferente)
DO $$
DECLARE
    masa1_id INTEGER;
    usuario_demo_id INTEGER;
BEGIN
    -- Obtener ID de masa recién insertada
    SELECT id INTO masa1_id FROM masas_produccion WHERE codigo_masa = 'DEMO-20260123-001';

    -- Obtener ID de usuario demo
    SELECT id INTO usuario_demo_id FROM usuarios WHERE username = 'admin' LIMIT 1;

    -- Productos de la masa
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion, gramaje_unitario,
        unidades_pedidas, unidades_programadas, unidades_producidas,
        kilos_pedidos, kilos_programados, kilos_producidos,
        peso_masa_division, cantidad_divisiones, division_completada
    ) VALUES
    (masa1_id, 'HAMBURGUESA_GOLD_6', 'Hamburguesa Gold x6', 'Por 6', 80.0, 100, 105, 105, 8.0, 8.4, 8.4, 80.0, 105, TRUE),
    (masa1_id, 'HAMBURGUESA_GOLD_12', 'Hamburguesa Gold x12', 'Por 12', 90.0, 200, 210, 208, 18.0, 18.9, 18.72, 90.0, 210, TRUE);

    -- Ingredientes de la masa
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        porcentaje_panadero, es_harina, es_agua, es_prefermento,
        cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado, peso_real, diferencia_gramos,
        lote, fecha_vencimiento, usuario_peso
    ) VALUES
    (masa1_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, 60.0, TRUE, FALSE, FALSE, 31500, 31.5, TRUE, TRUE, TRUE, 31500, 0, 'L2026-001', '2026-06-30', usuario_demo_id),
    (masa1_id, 'MP-AGUA-001', 'Agua Potable', 2, 45.0, FALSE, TRUE, FALSE, 23625, 23.625, TRUE, TRUE, TRUE, 23600, -25, NULL, NULL, usuario_demo_id),
    (masa1_id, 'MP-SAL-001', 'Sal Marina', 3, 2.0, FALSE, FALSE, FALSE, 1050, 1.05, TRUE, TRUE, TRUE, 1050, 0, 'L2025-045', '2027-12-31', usuario_demo_id),
    (masa1_id, 'MP-LEVADURA-001', 'Levadura Seca Activa', 4, 1.5, FALSE, FALSE, FALSE, 787.5, 0.7875, TRUE, TRUE, TRUE, 790, 2.5, 'L2026-002', '2026-03-15', usuario_demo_id),
    (masa1_id, 'MP-AZUCAR-001', 'Azúcar Refinada', 5, 3.0, FALSE, FALSE, FALSE, 1575, 1.575, TRUE, TRUE, TRUE, 1575, 0, 'L2025-098', '2027-06-30', usuario_demo_id),
    (masa1_id, 'MP-MANTEQUILLA-001', 'Mantequilla', 6, 5.0, FALSE, FALSE, FALSE, 2625, 2.625, TRUE, TRUE, TRUE, 2620, -5, 'L2026-010', '2026-02-28', usuario_demo_id),
    (masa1_id, 'MP-PREFERMENTO-001', 'Prefermento Gold', 7, 10.0, FALSE, FALSE, TRUE, 5250, 5.25, TRUE, TRUE, TRUE, 5250, 0, NULL, CURRENT_DATE + 2, usuario_demo_id);

    -- Progreso de fases (todas completadas)
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, fecha_inicio, fecha_completado, usuario_responsable, observaciones) VALUES
    (masa1_id, 'PLANIFICACION', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '5 hours 50 minutes', 'Admin Demo', 'Sincronización desde SAP exitosa'),
    (masa1_id, 'PESAJE', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '5 hours 50 minutes', CURRENT_TIMESTAMP - INTERVAL '5 hours', 'Operario Pesaje', 'Todos los ingredientes pesados correctamente'),
    (masa1_id, 'AMASADO', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '5 hours', CURRENT_TIMESTAMP - INTERVAL '4 hours 30 minutes', 'Operario Amasado', 'Temperatura final óptima'),
    (masa1_id, 'DIVISION', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '4 hours 30 minutes', CURRENT_TIMESTAMP - INTERVAL '3 hours 30 minutes', 'Operario División', 'División completada con buen peso'),
    (masa1_id, 'FORMADO', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '3 hours 30 minutes', CURRENT_TIMESTAMP - INTERVAL '2 hours 45 minutes', 'Operario Formado', 'Formado con medidas correctas'),
    (masa1_id, 'FERMENTACION', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '2 hours 45 minutes', CURRENT_TIMESTAMP - INTERVAL '2 hours', 'Operario Fermentación', 'Fermentación completada en tiempo estándar'),
    (masa1_id, 'HORNEADO', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour 45 minutes', 'Operario Horno', 'Horneado exitoso, color perfecto');

    -- Registro de amasado
    INSERT INTO registros_amasado (
        masa_id, amasadora_id, amasadora_nombre,
        velocidad_1_minutos, velocidad_2_minutos,
        temperatura_masa_final, temperatura_agua,
        usuario_id, fecha_registro, observaciones
    ) VALUES (
        masa1_id, 1, 'Amasadora Industrial 1',
        8, 12,
        26.5, 18.0,
        usuario_demo_id, CURRENT_TIMESTAMP - INTERVAL '4 hours 45 minutes',
        'Amasado correcto, consistencia perfecta'
    );

    -- Registro de división
    INSERT INTO registros_division (
        masa_id, maquina_corte_id, maquina_nombre,
        requiere_reposo, hora_inicio_reposo, hora_fin_reposo, tiempo_reposo_minutos,
        temperatura_entrada,
        usuario_id, fecha_registro, observaciones
    ) VALUES (
        masa1_id, 1, 'Conic',
        TRUE, CURRENT_TIMESTAMP - INTERVAL '4 hours 20 minutes', CURRENT_TIMESTAMP - INTERVAL '4 hours 10 minutes', 10,
        25.0,
        usuario_demo_id, CURRENT_TIMESTAMP - INTERVAL '4 hours', 'División uniforme'
    );

    -- Registro de formado
    INSERT INTO registros_formado (
        masa_id, maquina_formado_id, maquina_nombre,
        fecha_inicio, fecha_fin, duracion_minutos,
        usuario_id, usuario_nombre, observaciones
    ) VALUES (
        masa1_id, 1, 'Formadora 1',
        CURRENT_TIMESTAMP - INTERVAL '3 hours 30 minutes',
        CURRENT_TIMESTAMP - INTERVAL '2 hours 45 minutes',
        45,
        usuario_demo_id, 'Admin Demo', 'Formado con especificaciones correctas'
    );

    -- Registro de fermentación
    INSERT INTO registros_fermentacion (
        masa_id,
        hora_entrada_camara,
        hora_salida_camara_sugerida,
        hora_salida_camara_real,
        tiempo_fermentacion_minutos,
        temperatura_camara,
        humedad_camara,
        requiere_camara_frio,
        usuario_id, usuario_nombre, observaciones
    ) VALUES (
        masa1_id,
        CURRENT_TIMESTAMP - INTERVAL '2 hours 45 minutes',
        CURRENT_TIMESTAMP - INTERVAL '2 hours 5 minutes',
        CURRENT_TIMESTAMP - INTERVAL '2 hours',
        45,
        32.0,
        75.0,
        FALSE,
        usuario_demo_id, 'Admin Demo', 'Fermentación completada en tiempo estándar'
    );

    -- Registro de horneado
    INSERT INTO registros_horneado (
        masa_id, tipo_horno_id, horno_nombre,
        programa_horneo_id, numero_programa,
        hora_entrada, hora_salida, tiempo_total_minutos,
        temperatura_inicial_real, temperatura_media_real, temperatura_final_real,
        uso_damper_real, tiempo_inicio_damper_real, tiempo_fin_damper_real,
        calidad_color, calidad_coccion,
        usuario_id, usuario_nombre, observaciones
    ) VALUES (
        masa1_id, 1, 'Rotativo 1',
        1, 1,
        CURRENT_TIMESTAMP - INTERVAL '2 hours',
        CURRENT_TIMESTAMP - INTERVAL '1 hour 45 minutes',
        15,
        180.0, 200.0, 190.0,
        TRUE, 10, 15,
        'PERFECTO', 'PERFECTO',
        usuario_demo_id, 'Admin Demo', 'Horneado exitoso'
    );

END $$;

-- =====================================================
-- MASA 2: Pan Árabe (EN PROCESO - En fase de FERMENTACION)
-- =====================================================

DO $$
DECLARE
    masa2_id INTEGER;
    usuario_demo_id INTEGER;
BEGIN
    SELECT id INTO usuario_demo_id FROM usuarios WHERE username = 'admin' LIMIT 1;

    INSERT INTO masas_produccion (
        codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
        total_kilos_base, total_kilos_con_merma, porcentaje_merma, factor_absorcion_usado,
        estado, fase_actual
    ) VALUES (
        'DEMO-20260123-002', 'ARABE', 'Pan Árabe Orégano',
        CURRENT_DATE,
        30.0, 31.5, 5.0, 60.0,
        'EN_PROCESO', 'FERMENTACION'
    ) RETURNING id INTO masa2_id;

    -- Productos
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion,
        unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
    ) VALUES
    (masa2_id, 'PAN_ARABE_OREGANO_6', 'Pan Árabe Orégano x6', 'Por 6', 150, 158, 9.0, 9.48);

    -- Ingredientes
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        es_harina, es_agua, cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado, peso_real
    ) VALUES
    (masa2_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, TRUE, FALSE, 18900, 18.9, TRUE, TRUE, TRUE, 18900),
    (masa2_id, 'MP-AGUA-001', 'Agua Potable', 2, FALSE, TRUE, 14175, 14.175, TRUE, TRUE, TRUE, 14175),
    (masa2_id, 'MP-SAL-001', 'Sal Marina', 3, FALSE, FALSE, 630, 0.63, TRUE, TRUE, TRUE, 630),
    (masa2_id, 'MP-OREGANO-001', 'Orégano Deshidratado', 4, FALSE, FALSE, 315, 0.315, TRUE, TRUE, TRUE, 315);

    -- Progreso de fases
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado, fecha_inicio, fecha_completado, usuario_responsable) VALUES
    (masa2_id, 'PLANIFICACION', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '2 hours 50 minutes', 'Admin Demo'),
    (masa2_id, 'PESAJE', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '2 hours 50 minutes', CURRENT_TIMESTAMP - INTERVAL '2 hours 20 minutes', 'Operario Pesaje'),
    (masa2_id, 'AMASADO', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '2 hours 20 minutes', CURRENT_TIMESTAMP - INTERVAL '2 hours', 'Operario Amasado'),
    (masa2_id, 'DIVISION', 'COMPLETADA', 100, CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour 30 minutes', 'Operario División'),
    (masa2_id, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL, NULL),
    (masa2_id, 'FERMENTACION', 'EN_PROGRESO', 50, CURRENT_TIMESTAMP - INTERVAL '40 minutes', NULL, 'Operario Fermentación'),
    (masa2_id, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL, NULL);

    -- Registros de amasado y división
    INSERT INTO registros_amasado (masa_id, amasadora_id, amasadora_nombre, velocidad_1_minutos, velocidad_2_minutos, temperatura_masa_final, usuario_id)
    VALUES (masa2_id, 2, 'Amasadora Industrial 2', 6, 10, 25.0, usuario_demo_id);

    INSERT INTO registros_division (masa_id, maquina_corte_id, maquina_nombre, requiere_reposo, temperatura_entrada, usuario_id)
    VALUES (masa2_id, 1, 'Conic', FALSE, 24.5, usuario_demo_id);

    -- Fermentación en curso
    INSERT INTO registros_fermentacion (
        masa_id, hora_entrada_camara, hora_salida_camara_sugerida,
        tiempo_fermentacion_minutos, temperatura_camara, requiere_camara_frio,
        usuario_id, usuario_nombre
    ) VALUES (
        masa2_id, CURRENT_TIMESTAMP - INTERVAL '40 minutes', CURRENT_TIMESTAMP + INTERVAL '0 minutes',
        40, 30.0, FALSE,
        usuario_demo_id, 'Admin Demo'
    );

END $$;

-- =====================================================
-- MASA 3: Croissant (PLANIFICACION - Recién creada)
-- =====================================================

DO $$
DECLARE
    masa3_id INTEGER;
BEGIN
    INSERT INTO masas_produccion (
        codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
        total_kilos_base, total_kilos_con_merma, porcentaje_merma, factor_absorcion_usado,
        estado, fase_actual
    ) VALUES (
        'DEMO-20260123-003', 'CROISSANT', 'Croissant Tradicional',
        CURRENT_DATE,
        25.0, 26.25, 5.0, 60.0,
        'PLANIFICACION', 'PLANIFICACION'
    ) RETURNING id INTO masa3_id;

    -- Productos
    INSERT INTO productos_por_masa (
        masa_id, producto_codigo, producto_nombre, presentacion,
        unidades_pedidas, unidades_programadas, kilos_pedidos, kilos_programados
    ) VALUES
    (masa3_id, 'CROISSANT_TRADICIONAL', 'Croissant Tradicional', 'Por unidad', 300, 315, 15.0, 15.75);

    -- Ingredientes (aún no pesados)
    INSERT INTO ingredientes_masa (
        masa_id, ingrediente_sap_code, ingrediente_nombre, orden_visualizacion,
        es_harina, es_agua, cantidad_gramos, cantidad_kilos,
        disponible, verificado, pesado
    ) VALUES
    (masa3_id, 'MP-HARINA-001', 'Harina de Trigo Premium', 1, TRUE, FALSE, 15750, 15.75, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-AGUA-001', 'Agua Potable', 2, FALSE, TRUE, 7875, 7.875, FALSE, FALSE, FALSE),
    (masa3_id, 'MP-MANTEQUILLA-001', 'Mantequilla', 3, FALSE, FALSE, 3937.5, 3.9375, FALSE, FALSE, FALSE);

    -- Progreso de fases (todas bloqueadas)
    INSERT INTO progreso_fases (masa_id, fase, estado, porcentaje_completado) VALUES
    (masa3_id, 'PLANIFICACION', 'BLOQUEADA', 0),
    (masa3_id, 'PESAJE', 'BLOQUEADA', 0),
    (masa3_id, 'AMASADO', 'BLOQUEADA', 0),
    (masa3_id, 'DIVISION', 'BLOQUEADA', 0),
    (masa3_id, 'FORMADO', 'BLOQUEADA', 0),
    (masa3_id, 'FERMENTACION', 'BLOQUEADA', 0),
    (masa3_id, 'HORNEADO', 'BLOQUEADA', 0);

END $$;

-- =====================================================
-- Actualizar estadísticas de PostgreSQL
-- =====================================================
ANALYZE masas_produccion;
ANALYZE productos_por_masa;
ANALYZE ingredientes_masa;
ANALYZE progreso_fases;
ANALYZE registros_amasado;
ANALYZE registros_division;
ANALYZE registros_formado;
ANALYZE registros_fermentacion;
ANALYZE registros_horneado;

-- =====================================================
-- FIN DEL SCRIPT DE DATOS DEMO
-- =====================================================
