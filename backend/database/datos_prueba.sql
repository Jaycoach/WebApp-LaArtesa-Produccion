-- ============================================================================
-- SCRIPT DE DATOS DE PRUEBA PARA LA ARTESA - SISTEMA DE PRODUCCIÓN
-- ============================================================================
-- Fecha: 30 de Enero de 2026
-- Propósito: Insertar datos de prueba para poder probar el flujo completo
--            de Pesaje → Amasado → División
-- ============================================================================

-- ============================================================================
-- 1. CREAR USUARIO DE PRUEBA (si no existe)
-- ============================================================================
-- Nota: La contraseña es "admin123" (encriptada con bcrypt)
INSERT INTO usuarios (username, password_hash, nombre, rol, email, activo)
VALUES (
    'admin',
    '$2b$10$rYHqLXJlQEv3xS/W0vLPt.yK5Ck9Rk6lKZzB7xmYD5qKZ9bGXqT6G',
    'Admin Demo',
    'ADMIN',
    'admin@artesa.com',
    true
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- 2. CONFIGURAR TIPOS DE MASA EN EL CATÁLOGO
-- ============================================================================

-- Hamburguesa Gold
INSERT INTO catalogo_tipos_masa (
    codigo_sap,
    tipo_masa,
    nombre_masa,
    requiere_reposo_pre_division,
    tiempo_reposo_division_minutos,
    requiere_formado,
    requiere_camara_frio,
    tiempo_fermentacion_estandar_minutos
) VALUES (
    'HAMBURGUESA_GOLD_6',
    'GOLD',
    'Hamburguesa Gold x6',
    true,   -- Sí requiere reposo
    15,     -- 15 minutos de reposo
    true,   -- Sí requiere formado
    false,  -- No requiere frío
    45      -- 45 minutos de fermentación
)
ON CONFLICT (codigo_sap) DO NOTHING;

-- Pan Árabe
INSERT INTO catalogo_tipos_masa (
    codigo_sap,
    tipo_masa,
    nombre_masa,
    requiere_reposo_pre_division,
    tiempo_reposo_division_minutos,
    requiere_formado,
    requiere_camara_frio,
    tiempo_fermentacion_estandar_minutos
) VALUES (
    'PAN_ARABE_OREGANO_6',
    'ARABE',
    'Pan Árabe Orégano x6',
    false,  -- No requiere reposo
    0,
    false,  -- No requiere formado
    false,  -- No requiere frío
    40      -- 40 minutos de fermentación
)
ON CONFLICT (codigo_sap) DO NOTHING;

-- Croissant
INSERT INTO catalogo_tipos_masa (
    codigo_sap,
    tipo_masa,
    nombre_masa,
    requiere_reposo_pre_division,
    tiempo_reposo_division_minutos,
    requiere_formado,
    requiere_camara_frio,
    tiempo_fermentacion_estandar_minutos
) VALUES (
    'CROISSANT_TRADICIONAL',
    'CROISSANT',
    'Croissant Tradicional',
    true,   -- Sí requiere reposo
    20,     -- 20 minutos
    true,   -- Sí requiere formado
    true,   -- SÍ requiere frío
    120     -- 2 horas de fermentación
)
ON CONFLICT (codigo_sap) DO NOTHING;

-- ============================================================================
-- 3. INSERTAR MASAS DE PRODUCCIÓN DE PRUEBA PARA HOY
-- ============================================================================

-- Masa 1: Hamburguesa Gold (para fecha de hoy)
INSERT INTO masas_produccion (
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    estado,
    fase_actual,
    total_kilos_base,
    porcentaje_merma,
    total_kilos_con_merma,
    factor_absorcion_usado,
    total_ordenes,
    total_productos,
    total_unidades_pedidas,
    total_unidades_programadas
) VALUES (
    'PRUEBA-20260130-001',
    'GOLD',
    'Hamburguesa Gold x6',
    CURRENT_DATE,  -- Fecha de hoy
    'PLANIFICACION',
    'PESAJE',
    50.0,   -- 50 kg base
    5.0,    -- 5% merma
    52.5,   -- 52.5 kg con merma
    60.0,   -- Factor absorción 60%
    1,      -- 1 orden
    2,      -- 2 productos diferentes
    200,    -- 200 unidades pedidas
    210     -- 210 unidades programadas (incluye merma)
)
ON CONFLICT DO NOTHING
RETURNING id;

-- Guardar el ID de la masa (lo usaremos abajo)
-- En este script, asumiremos que el ID es 1 (ajusta según tu base de datos)

-- Masa 2: Pan Árabe
INSERT INTO masas_produccion (
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    estado,
    fase_actual,
    total_kilos_base,
    porcentaje_merma,
    total_kilos_con_merma,
    factor_absorcion_usado,
    total_ordenes,
    total_productos,
    total_unidades_pedidas,
    total_unidades_programadas
) VALUES (
    'PRUEBA-20260130-002',
    'ARABE',
    'Pan Árabe Orégano x6',
    CURRENT_DATE,
    'PLANIFICACION',
    'PESAJE',
    30.0,
    5.0,
    31.5,
    60.0,
    1,
    1,
    150,
    158
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. INSERTAR PRODUCTOS PARA LAS MASAS
-- ============================================================================

-- Productos para Masa 1 (Hamburguesa Gold)
-- IMPORTANTE: Ajusta masa_id según el ID real de tu base de datos

-- Producto 1: Hamburguesa Gold x6
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
    division_completada
) VALUES (
    1,  -- Ajusta este ID según tu base de datos
    'HAMB-GOLD-6',
    'Hamburguesa Gold x6',
    'Bolsa x6',
    500,  -- 500 gramos por unidad
    100,  -- 100 unidades pedidas
    105,  -- 105 programadas (con merma)
    50.0,
    52.5,
    false
);

-- Producto 2: Hamburguesa Gold x12
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
    division_completada
) VALUES (
    1,
    'HAMB-GOLD-12',
    'Hamburguesa Gold x12',
    'Bolsa x12',
    1000,
    100,
    105,
    100.0,
    105.0,
    false
);

-- Productos para Masa 2 (Pan Árabe)
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
    division_completada
) VALUES (
    2,
    'ARABE-ORE-6',
    'Pan Árabe Orégano x6',
    'Bolsa x6',
    200,
    150,
    158,
    30.0,
    31.5,
    false
);

-- ============================================================================
-- 5. INSERTAR INGREDIENTES PARA LAS MASAS
-- ============================================================================

-- Ingredientes para Masa 1 (Hamburguesa Gold)

INSERT INTO ingredientes_masa (
    masa_id,
    ingrediente_sap_code,
    ingrediente_nombre,
    orden_visualizacion,
    porcentaje_panadero,
    es_harina,
    es_agua,
    es_prefermento,
    cantidad_gramos,
    cantidad_kilos,
    disponible,
    verificado,
    pesado
) VALUES
-- Harinas
(1, 'HAR-001', 'Harina de Trigo Fuerte', 1, 100.0, true, false, false, 30000, 30.0, false, false, false),
-- Agua
(1, 'AGU-001', 'Agua', 2, 60.0, false, true, false, 18000, 18.0, false, false, false),
-- Otros ingredientes
(1, 'SAL-001', 'Sal Refinada', 3, 2.0, false, false, false, 600, 0.6, false, false, false),
(1, 'LEV-001', 'Levadura Fresca', 4, 3.0, false, false, false, 900, 0.9, false, false, false),
(1, 'AZU-001', 'Azúcar Blanco', 5, 5.0, false, false, false, 1500, 1.5, false, false, false),
(1, 'ACE-001', 'Aceite de Girasol', 6, 3.0, false, false, false, 900, 0.9, false, false, false),
(1, 'MEJ-001', 'Mejorador de Masa', 7, 0.5, false, false, false, 150, 0.15, false, false, false);

-- Ingredientes para Masa 2 (Pan Árabe)
INSERT INTO ingredientes_masa (
    masa_id,
    ingrediente_sap_code,
    ingrediente_nombre,
    orden_visualizacion,
    porcentaje_panadero,
    es_harina,
    es_agua,
    es_prefermento,
    cantidad_gramos,
    cantidad_kilos,
    disponible,
    verificado,
    pesado
) VALUES
(2, 'HAR-001', 'Harina de Trigo Fuerte', 1, 100.0, true, false, false, 18000, 18.0, false, false, false),
(2, 'AGU-001', 'Agua', 2, 55.0, false, true, false, 9900, 9.9, false, false, false),
(2, 'SAL-001', 'Sal Refinada', 3, 2.0, false, false, false, 360, 0.36, false, false, false),
(2, 'LEV-001', 'Levadura Fresca', 4, 2.5, false, false, false, 450, 0.45, false, false, false),
(2, 'ACE-001', 'Aceite de Oliva', 5, 2.0, false, false, false, 360, 0.36, false, false, false),
(2, 'ORE-001', 'Orégano Seco', 6, 0.5, false, false, false, 90, 0.09, false, false, false);

-- ============================================================================
-- 6. INSERTAR PROGRESO DE FASES PARA AMBAS MASAS
-- ============================================================================

-- Progreso de fases para Masa 1
INSERT INTO progreso_fases (
    masa_id,
    fase,
    estado,
    porcentaje_completado,
    fecha_inicio,
    fecha_completado,
    usuario_responsable,
    observaciones
) VALUES
(1, 'PESAJE', 'EN_PROGRESO', 0, NULL, NULL, NULL, NULL),
(1, 'AMASADO', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(1, 'DIVISION', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(1, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(1, 'FERMENTACION', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(1, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL);

-- Progreso de fases para Masa 2
INSERT INTO progreso_fases (
    masa_id,
    fase,
    estado,
    porcentaje_completado,
    fecha_inicio,
    fecha_completado,
    usuario_responsable,
    observaciones
) VALUES
(2, 'PESAJE', 'EN_PROGRESO', 0, NULL, NULL, NULL, NULL),
(2, 'AMASADO', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(2, 'DIVISION', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(2, 'FORMADO', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(2, 'FERMENTACION', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL),
(2, 'HORNEADO', 'BLOQUEADA', 0, NULL, NULL, NULL, NULL);

-- ============================================================================
-- 7. CONFIGURACIÓN DEL SISTEMA
-- ============================================================================

-- Factor de absorción
INSERT INTO configuracion_sistema (clave, valor, descripcion, tipo_dato)
VALUES
('factor_absorcion_harina', '60', 'Factor de absorción de harina (porcentaje)', 'number')
ON CONFLICT (clave) DO UPDATE SET valor = '60';

-- Correos de notificación
INSERT INTO configuracion_sistema (clave, valor, descripcion, tipo_dato)
VALUES
('correos_empaque', 'empaque@artesa.com,bodega@artesa.com', 'Correos para notificaciones de empaque', 'string')
ON CONFLICT (clave) DO UPDATE SET valor = 'empaque@artesa.com,bodega@artesa.com';

-- ============================================================================
-- 8. CATÁLOGO DE AMASADORAS
-- ============================================================================

INSERT INTO amasadoras (nombre, capacidad_kg, activa, orden_visualizacion)
VALUES
('Amasadora Industrial 1', 100, true, 1),
('Amasadora Industrial 2', 100, true, 2),
('Amasadora Grande', 150, true, 3),
('Amasadora Pastelería', 50, true, 4)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 9. CATÁLOGO DE MÁQUINAS DE CORTE
-- ============================================================================

INSERT INTO maquinas_corte (nombre, tipo, capacidad_kg, activa)
VALUES
('Conic', 'AUTOMATICA', 100, true),
('Divisora Manual', 'MANUAL', 50, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 10. CATÁLOGO DE MÁQUINAS DE FORMADO
-- ============================================================================

INSERT INTO maquinas_formado (nombre, tipo, activa)
VALUES
('Formadora 1', 'AUTOMATICA', true),
('Formadora 2', 'AUTOMATICA', true),
('Formadora 3', 'AUTOMATICA', true),
('Formado Manual', 'MANUAL', true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 11. CATÁLOGO DE HORNOS
-- ============================================================================

INSERT INTO tipos_horno (nombre, tipo, capacidad_bandejas, tiene_damper, tiene_control_automatico, activo)
VALUES
('Rotativo 1', 'ROTATIVO', 16, true, true, true),
('Rotativo 2', 'ROTATIVO', 16, true, true, true),
('Rotativo 3', 'ROTATIVO', 16, true, true, true),
('Piso', 'PISO', 8, false, false, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- FIN DEL SCRIPT
-- ============================================================================

-- Verificar datos insertados
SELECT
    'Masas creadas' as tabla,
    COUNT(*) as total
FROM masas_produccion
WHERE fecha_produccion = CURRENT_DATE

UNION ALL

SELECT
    'Productos creados',
    COUNT(*)
FROM productos_por_masa

UNION ALL

SELECT
    'Ingredientes creados',
    COUNT(*)
FROM ingredientes_masa

UNION ALL

SELECT
    'Fases de progreso',
    COUNT(*)
FROM progreso_fases;

-- Mostrar las masas creadas
SELECT
    id,
    codigo_masa,
    tipo_masa,
    nombre_masa,
    fecha_produccion,
    fase_actual,
    total_kilos_con_merma
FROM masas_produccion
WHERE fecha_produccion = CURRENT_DATE
ORDER BY id;

COMMIT;
