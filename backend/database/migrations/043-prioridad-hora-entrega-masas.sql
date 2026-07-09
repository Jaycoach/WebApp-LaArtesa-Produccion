-- =====================================================
-- Migración 043: Prioridad y hora de entrega en masas_produccion
-- Se marcan al aprobar la masa ("dar a probar")
-- =====================================================

ALTER TABLE masas_produccion
  ADD COLUMN IF NOT EXISTS prioridad BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hora_entrega TIME NULL;

COMMENT ON COLUMN masas_produccion.prioridad IS 'Marcada manualmente por el supervisor al aprobar la masa (dar a probar)';
COMMENT ON COLUMN masas_produccion.hora_entrega IS 'Hora de entrega comprometida, ingresada al aprobar la masa';
