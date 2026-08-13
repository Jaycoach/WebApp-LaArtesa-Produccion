-- ============================================================================
-- MIGRACIÓN 057: Fermentación por producto/línea (Fase 6)
-- Fecha: 2026-08-13
-- Motivo: Fermentación pasa de ser un evento único por masa a un evento por
--         producto/línea — cada producto puede ir a una cámara distinta de
--         las 3 del catálogo (camaras_fermentacion, migración 053), con su
--         propia hora de entrada y salida. La cámara fría deja de ser un
--         paso condicional aparte (catalogo_tipos_masa.requiere_camara_frio,
--         deprecada para este flujo, se conserva la columna) y pasa a ser
--         una opción más del catálogo (fila "Cuarto Frio").
--         registros_fermentacion se simplifica a header de sesión puro
--         (igual que registros_formado); fermentacion_detalles es la tabla
--         nueva, 1 fila por producto — mismo patrón que empaque_detalles y
--         formado_detalles, ya probado en este código.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS fermentacion_detalles (
  id                          SERIAL PRIMARY KEY,
  registro_fermentacion_id   INTEGER NOT NULL REFERENCES registros_fermentacion(id) ON DELETE CASCADE,
  producto_masa_id           INTEGER NOT NULL REFERENCES productos_por_masa(id) ON DELETE CASCADE,
  camara_id                  INTEGER REFERENCES camaras_fermentacion(id),
  camara_nombre               VARCHAR(100),
  hora_entrada_camara         TIMESTAMPTZ,
  hora_salida_camara          TIMESTAMPTZ,
  tiempo_fermentacion_minutos INTEGER,
  temperatura_camara          NUMERIC,
  humedad_camara               NUMERIC,
  fecha_actualizacion         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (registro_fermentacion_id, producto_masa_id)
);

CREATE INDEX IF NOT EXISTS idx_fermentacion_detalles_registro ON fermentacion_detalles(registro_fermentacion_id);
CREATE INDEX IF NOT EXISTS idx_fermentacion_detalles_producto ON fermentacion_detalles(producto_masa_id);

COMMENT ON TABLE fermentacion_detalles IS
  'Detalle por producto/línea de una sesión de Fermentación (registros_fermentacion = header). '
  'Fase 6, 13-ago-2026 — reemplaza el evento único por masa por evento por línea, '
  'con cámara elegible libremente entre las 3 de camaras_fermentacion (incluida la fría).';

-- registros_fermentacion se simplifica a header de sesión — las columnas de
-- tiempos/cámara/frío quedan deprecadas (no se dropean, por si algo externo
-- las lee; fermentacion.controller.js deja de escribirlas y de leerlas para
-- decidir flujo). Mismo criterio que catalogo_tipos_masa.requiere_formado
-- en la migración 056. Verificado con check_salida_camara y check_camara_frio
-- (init/07-tablas-configuracion-avanzada.sql:172-179): ambos constraints se
-- satisfacen con estas columnas en NULL/FALSE, no requieren ALTER.
COMMENT ON COLUMN registros_fermentacion.hora_entrada_camara IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.hora_entrada_camara (por línea). No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.hora_salida_camara_sugerida IS
  'DEPRECADA (Fase 6, 13-ago-2026) — label "Salida sugerida" eliminado del frontend. No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.hora_salida_camara_real IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.hora_salida_camara (por línea). No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.tiempo_fermentacion_minutos IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.tiempo_fermentacion_minutos (por línea). No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.temperatura_camara IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.temperatura_camara (por línea). No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.humedad_camara IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.humedad_camara (por línea). No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.requiere_camara_frio IS
  'DEPRECADA (Fase 6, 13-ago-2026) — la cámara fría es una opción más del catálogo camaras_fermentacion, no un flag condicional. No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.hora_entrada_frio IS
  'DEPRECADA (Fase 6, 13-ago-2026) — flujo de frío separado eliminado, ver fermentacion_detalles. No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.hora_salida_frio IS
  'DEPRECADA (Fase 6, 13-ago-2026) — flujo de frío separado eliminado, ver fermentacion_detalles. No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.tiempo_frio_minutos IS
  'DEPRECADA (Fase 6, 13-ago-2026) — flujo de frío separado eliminado, ver fermentacion_detalles. No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.temperatura_frio IS
  'DEPRECADA (Fase 6, 13-ago-2026) — flujo de frío separado eliminado, ver fermentacion_detalles. No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.camara_id IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.camara_id (por línea, una masa puede usar varias cámaras). No se escribe más.';
COMMENT ON COLUMN registros_fermentacion.camara_nombre IS
  'DEPRECADA (Fase 6, 13-ago-2026) — reemplazada por fermentacion_detalles.camara_nombre (por línea). No se escribe más.';

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'fermentacion_detalles' ORDER BY ordinal_position;

COMMIT;
