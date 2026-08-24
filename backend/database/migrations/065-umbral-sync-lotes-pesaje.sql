-- ============================================================================
-- MIGRACIÓN 065: umbral de antigüedad de sync de lotes para Confirmar Pesaje
-- Fecha: 2026-08-24
-- Motivo (Hallazgo 3, validación manual staging): sap_lotes_mp.cantidad_disponible
--         es un snapshot cacheado, actualizado solo por la sincronización de
--         inventario/lotes (cron 2x/día o manual). Las reservas locales en
--         pesaje_lotes_consumo NO lo descuentan (por diseño — ver comentarios
--         en fases.model.js), así que un lote puede seguir mostrando stock en
--         Orbit por horas/días después de agotarse en SAP. El checklist de
--         Pesaje dejaba avanzar con normalidad y el error real de SAP
--         ("Insufficient quantity...") solo aparecía tarde, al hacer clic en
--         "Confirmar Pesaje Completo", con todo el resto del trabajo ya hecho.
--
--         Caso real confirmado en staging (2026-08-24): lote 65361 de MP0015
--         (AZUCAR) con ultimo_sync de ~3 días antes del intento de pesaje —
--         genuinamente agotado en SAP, Orbit no lo sabía por falta de sync
--         reciente.
--
--         pesaje.controller.js::confirmarPesaje ahora valida, antes de
--         intentar SAP, que ningún lote reservado para la masa tenga un
--         snapshot más viejo que este umbral (en horas). El valor es
--         intencionalmente editable sin deploy (UPDATE directo sobre esta
--         fila) porque es una decisión operativa (Jonathan/Diana), no una
--         constante de código — el fix solo fija un default razonable dado
--         que el cron corre 2x/día.
-- ============================================================================

BEGIN;

INSERT INTO configuracion_sistema (clave, valor, tipo, categoria, descripcion, es_publica)
VALUES (
  'pesaje_umbral_sync_lotes_horas',
  '6',
  'NUMBER',
  'pesaje',
  'Horas máximas de antigüedad permitidas para el snapshot de sap_lotes_mp.ultimo_sync de un lote antes de bloquear Confirmar Pesaje. Editar este valor no requiere deploy.',
  false
)
ON CONFLICT (clave) DO NOTHING;

-- Verificación
SELECT clave, valor, tipo, categoria FROM configuracion_sistema WHERE clave = 'pesaje_umbral_sync_lotes_horas';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir esta migración)
-- ============================================================================
-- BEGIN;
-- DELETE FROM configuracion_sistema WHERE clave = 'pesaje_umbral_sync_lotes_horas';
-- COMMIT;
