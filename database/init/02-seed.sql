-- =============================================
-- DATOS INICIALES (SEED) - SISTEMA ARTESA
-- =============================================

-- =============================================
-- USUARIO ADMINISTRADOR POR DEFECTO
-- Password: Admin123!@#
-- IMPORTANTE: Cambiar en producción
-- =============================================
INSERT INTO usuarios (
    username, 
    email, 
    password_hash, 
    nombre_completo, 
    rol, 
    activo,
    email_verificado,
    debe_cambiar_password
) VALUES (
    'admin',
    'admin@artesa.com',
    '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWIgJgGy', -- Admin123!@#
    'Administrador del Sistema',
    'ADMIN',
    true,
    true,
    true  -- Debe cambiar password en primer login
) ON CONFLICT (username) DO NOTHING;

-- =============================================
-- USUARIOS DE EJEMPLO
-- Todos con password: Test123!@#
-- =============================================
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado) VALUES
('supervisor1', 'supervisor@artesa.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWIgJgGy', 'Juan Supervisor', 'SUPERVISOR', true, true),
('operario1', 'operario1@artesa.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWIgJgGy', 'Pedro Operario', 'OPERARIO', true, true),
('operario2', 'operario2@artesa.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWIgJgGy', 'María González', 'OPERARIO', true, true),
('calidad1', 'calidad@artesa.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWIgJgGy', 'Ana Calidad', 'CALIDAD', true, true)
ON CONFLICT (username) DO NOTHING;

-- =============================================
-- CONFIGURACIONES DEL SISTEMA
-- =============================================
INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion, es_publica) VALUES
('sistema.nombre', 'ARTESA - Sistema de Gestión de Producción', 'STRING', 'GENERAL', 'Nombre del sistema', true),
('sistema.version', '1.0.0', 'STRING', 'GENERAL', 'Versión del sistema', true),
('sistema.mantenimiento', 'false', 'BOOLEAN', 'GENERAL', 'Modo mantenimiento', true),

-- Seguridad
('seguridad.intentos_maximos', '5', 'NUMBER', 'SEGURIDAD', 'Intentos máximos de login', false),
('seguridad.tiempo_bloqueo', '30', 'NUMBER', 'SEGURIDAD', 'Minutos de bloqueo tras intentos fallidos', false),
('seguridad.duracion_sesion', '24', 'NUMBER', 'SEGURIDAD', 'Horas de duración de sesión', false),
('seguridad.requerir_2fa', 'false', 'BOOLEAN', 'SEGURIDAD', 'Requerir autenticación de dos factores', false),
('seguridad.dias_expiracion_password', '90', 'NUMBER', 'SEGURIDAD', 'Días para expiración de contraseña', false),

-- SAP
('sap.sync_enabled', 'true', 'BOOLEAN', 'SAP', 'Sincronización automática habilitada', false),
('sap.sync_hora', '20:00', 'STRING', 'SAP', 'Hora de sincronización diaria', false),
('sap.retry_intentos', '3', 'NUMBER', 'SAP', 'Intentos de reintento en caso de error', false),
('sap.timeout', '30000', 'NUMBER', 'SAP', 'Timeout en milisegundos', false),

-- Producción
('produccion.tiempo_alerta_etapa', '30', 'NUMBER', 'PRODUCCION', 'Minutos para alerta de etapa demorada', false),
('produccion.merma_maxima_permitida', '5', 'NUMBER', 'PRODUCCION', 'Porcentaje máximo de merma permitida', false),
('produccion.requiere_aprobacion_calidad', 'true', 'BOOLEAN', 'PRODUCCION', 'Requiere aprobación de calidad', false),

-- Notificaciones
('notificaciones.email_enabled', 'false', 'BOOLEAN', 'NOTIFICACIONES', 'Notificaciones por email habilitadas', false),
('notificaciones.email_admin', 'admin@artesa.com', 'STRING', 'NOTIFICACIONES', 'Email del administrador', false)

ON CONFLICT (clave) DO NOTHING;

-- =============================================
-- RECETAS DE EJEMPLO
-- =============================================
INSERT INTO recetas (
    codigo, 
    tipo_masa, 
    nombre, 
    descripcion, 
    version, 
    activa, 
    rendimiento_esperado,
    tiempo_total_estimado,
    temperatura_ambiente_optima,
    humedad_optima,
    parametros_proceso,
    instrucciones,
    creado_por
) VALUES 
(
    'REC-FRANCESA-001',
    'FRANCESA',
    'Pan Francés Tradicional',
    'Receta estándar de pan francés',
    1,
    true,
    95.0,
    240, -- 4 horas
    22.0,
    75.0,
    '{
        "amasado": {"velocidad": 2, "tiempo": 15, "temperatura_final": 24},
        "fermentacion": {"temperatura": 28, "humedad": 75, "tiempo": 120},
        "horneado": {"temperatura": 220, "tiempo": 25}
    }'::jsonb,
    '1. Pesar ingredientes según especificación
2. Amasar a velocidad 1 por 5 minutos
3. Cambiar a velocidad 2 por 10 minutos
4. Fermentación en cámara a 28°C por 2 horas
5. Dividir y formar
6. Fermentación final 30 minutos
7. Hornear a 220°C por 25 minutos',
    1
),
(
    'REC-INTEGRAL-001',
    'INTEGRAL',
    'Pan Integral',
    'Receta de pan integral con semillas',
    1,
    true,
    92.0,
    300, -- 5 horas
    22.0,
    70.0,
    '{
        "amasado": {"velocidad": 2, "tiempo": 20, "temperatura_final": 25},
        "fermentacion": {"temperatura": 26, "humedad": 70, "tiempo": 180},
        "horneado": {"temperatura": 200, "tiempo": 35}
    }'::jsonb,
    '1. Pesar ingredientes
2. Mezclar harinas y semillas
3. Amasar a velocidad 2 por 20 minutos
4. Fermentación en cámara a 26°C por 3 horas
5. Dividir y formar
6. Fermentación final 45 minutos
7. Hornear a 200°C por 35 minutos',
    1
)
ON CONFLICT (codigo) DO NOTHING;

-- =============================================
-- INGREDIENTES DE RECETAS
-- =============================================
INSERT INTO receta_ingredientes (
    receta_id,
    codigo_ingrediente,
    descripcion,
    cantidad,
    unidad,
    porcentaje_panadero,
    orden_adicion
)
SELECT r.id, codigo, descripcion, cantidad, unidad, porcentaje, orden
FROM recetas r
CROSS JOIN (VALUES
    ('MAT-HARINA-001', 'Harina de Trigo 000', 1000.0, 'GR', 100.0, 1),
    ('MAT-AGUA-001', 'Agua', 600.0, 'ML', 60.0, 2),
    ('MAT-SAL-001', 'Sal', 20.0, 'GR', 2.0, 3),
    ('MAT-LEVADURA-001', 'Levadura Fresca', 30.0, 'GR', 3.0, 4),
    ('MAT-AZUCAR-001', 'Azúcar', 20.0, 'GR', 2.0, 5)
) AS ingredientes(codigo, descripcion, cantidad, unidad, porcentaje, orden)
WHERE r.codigo = 'REC-FRANCESA-001'
ON CONFLICT DO NOTHING;

-- =============================================
-- MENSAJE DE FINALIZACIÓN
-- =============================================
DO $$
BEGIN
    RAISE NOTICE '✓ Base de datos inicializada correctamente';
    RAISE NOTICE '✓ Usuario admin creado: admin / Admin123!@# (CAMBIAR EN PRODUCCIÓN)';
    RAISE NOTICE '✓ Usuarios de ejemplo creados';
    RAISE NOTICE '✓ Configuraciones del sistema cargadas';
    RAISE NOTICE '✓ Recetas de ejemplo cargadas';
END $$;
