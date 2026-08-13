-- ============================================================================
-- MIGRACIÓN 056: Formado por producto (Fase 5)
-- Fecha: 2026-08-12
-- Motivo: requiere_formado ahora se decide por producto/SKU (productos_por_masa,
--         poblado desde Fase 3), no por tipo de masa completo
--         (catalogo_tipos_masa.requiere_formado, que queda deprecada para el
--         enrutamiento real — se conserva la columna, puede seguir usándose
--         para otros fines administrativos, pero fases.model.js ya no la lee
--         para decidir si abrir FORMADO).
--         registros_formado sigue siendo 1 fila por masa (header de sesión,
--         sin cambio de contrato); formado_detalles es la tabla nueva, 1 fila
--         por producto formado — mismo patrón que registros_empaque +
--         empaque_detalles, ya probado en este código.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS formado_detalles (
  id                  SERIAL PRIMARY KEY,
  registro_formado_id INTEGER NOT NULL REFERENCES registros_formado(id) ON DELETE CASCADE,
  producto_masa_id    INTEGER NOT NULL REFERENCES productos_por_masa(id) ON DELETE CASCADE,
  maquina_formado_id  INTEGER REFERENCES maquinas_formado(id),
  maquina_nombre      VARCHAR(100),
  unidades_formadas   INTEGER NOT NULL DEFAULT 0,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (registro_formado_id, producto_masa_id)
);

CREATE INDEX IF NOT EXISTS idx_formado_detalles_registro ON formado_detalles(registro_formado_id);
CREATE INDEX IF NOT EXISTS idx_formado_detalles_producto ON formado_detalles(producto_masa_id);

COMMENT ON TABLE formado_detalles IS
  'Detalle por producto de una sesión de Formado (registros_formado = header). '
  'Fase 5, 12-ago-2026 — reemplaza el enrutamiento a nivel de tipo_masa '
  '(catalogo_tipos_masa.requiere_formado) por enrutamiento por SKU '
  '(productos_por_masa.requiere_formado).';

-- Verificación
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'formado_detalles' ORDER BY ordinal_position;

COMMIT;
