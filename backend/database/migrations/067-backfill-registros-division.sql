-- ============================================================================
-- MIGRACIÓN 067: backfill histórico de registros_division
-- Fecha: 2026-08-24
-- Motivo (Hallazgo 9): el completado de DIVISION nunca escribió en la tabla
--         dedicada registros_division (solo en progreso_fases.datos_fase,
--         JSON sin estructura) — bug de código ya corregido en
--         backend/src/controllers/fases.controller.js (INSERT ... ON
--         CONFLICT (masa_id) DO UPDATE, mismo patrón que registros_amasado).
--         Esta migración es el backfill del histórico: reconstruye la fila
--         para toda masa con DIVISION ya COMPLETADA que no tiene registro,
--         usando exclusivamente datos_fase (que sí conservaba máquina,
--         temperatura, reposo y observaciones para el 100% de los casos
--         auditados) y usuario_responsable/fecha_completado de
--         progreso_fases.
--
--         Auditoría de staging (2026-08-24, antes de este backfill):
--         153 masas con DIVISION COMPLETADA sin fila en registros_division.
--         De esas, 55 tenían usuario_responsable resoluble (Case A,
--         usuario_id real) y 98 no lo tenían (Case B, gap histórico de
--         firma de usuario ya documentado en el Hallazgo de esta misma
--         sesión sobre usuario_responsable/usuario_peso — NO se inventa
--         un usuario ni se usa un valor "sistema": usuario_id queda NULL
--         explícito para esos 98 casos).
--
--         Validado en staging con dry-run (transacción + ROLLBACK) antes
--         de ejecutar real: INSERT 0 55 (Case A) + INSERT 0 98 (Case B).
--         Post-backfill en staging: count(*) = 156 (153 backfilleadas +
--         1 fix manual previo de la masa 1940 + 2 masas nuevas usadas para
--         confirmar que el fix funciona hacia adelante sin intervención
--         manual, antes de correr este backfill), de las cuales exactamente
--         98 quedaron con usuario_id NULL.
--
--         Idempotente: cada INSERT ya filtra por
--         "no existe fila en registros_division para esa masa" (LEFT JOIN
--         ... WHERE rd.id IS NULL), y además se agrega ON CONFLICT
--         (masa_id) DO NOTHING como red de seguridad — correr esta
--         migración más de una vez, o después de que el código nuevo ya
--         haya escrito filas propias, no duplica ni pisa nada.
-- ============================================================================

BEGIN;

-- Case A: usuario_responsable resoluble → usuario_id real
INSERT INTO registros_division
  (masa_id, maquina_corte_id, maquina_nombre,
   requiere_reposo, hora_inicio_reposo, hora_fin_reposo, tiempo_reposo_minutos,
   temperatura_entrada, usuario_id, observaciones, fecha_registro)
SELECT
  pf.masa_id,
  (pf.datos_fase->>'maquina_corte_id')::int,
  mc.nombre,
  COALESCE((pf.datos_fase->>'requiere_reposo')::boolean, false),
  NULLIF(pf.datos_fase->>'hora_inicio_reposo', '')::timestamp,
  NULLIF(pf.datos_fase->>'hora_fin_reposo', '')::timestamp,
  NULLIF(pf.datos_fase->>'tiempo_reposo_minutos', '')::int,
  (pf.datos_fase->>'temperatura_entrada')::numeric,
  pf.usuario_responsable,
  NULLIF(pf.datos_fase->>'observaciones', ''),
  COALESCE(pf.fecha_completado, pf.updated_at)
FROM progreso_fases pf
LEFT JOIN registros_division rd ON rd.masa_id = pf.masa_id
LEFT JOIN maquinas_corte mc ON mc.id = (pf.datos_fase->>'maquina_corte_id')::int
WHERE pf.fase = 'DIVISION' AND pf.estado = 'COMPLETADA' AND rd.id IS NULL
  AND pf.usuario_responsable IS NOT NULL
ON CONFLICT (masa_id) DO NOTHING;

-- Case B: usuario_responsable ausente → usuario_id NULL explícito (no inventado)
INSERT INTO registros_division
  (masa_id, maquina_corte_id, maquina_nombre,
   requiere_reposo, hora_inicio_reposo, hora_fin_reposo, tiempo_reposo_minutos,
   temperatura_entrada, usuario_id, observaciones, fecha_registro)
SELECT
  pf.masa_id,
  (pf.datos_fase->>'maquina_corte_id')::int,
  mc.nombre,
  COALESCE((pf.datos_fase->>'requiere_reposo')::boolean, false),
  NULLIF(pf.datos_fase->>'hora_inicio_reposo', '')::timestamp,
  NULLIF(pf.datos_fase->>'hora_fin_reposo', '')::timestamp,
  NULLIF(pf.datos_fase->>'tiempo_reposo_minutos', '')::int,
  (pf.datos_fase->>'temperatura_entrada')::numeric,
  NULL,
  NULLIF(pf.datos_fase->>'observaciones', ''),
  COALESCE(pf.fecha_completado, pf.updated_at)
FROM progreso_fases pf
LEFT JOIN registros_division rd ON rd.masa_id = pf.masa_id
LEFT JOIN maquinas_corte mc ON mc.id = (pf.datos_fase->>'maquina_corte_id')::int
WHERE pf.fase = 'DIVISION' AND pf.estado = 'COMPLETADA' AND rd.id IS NULL
  AND pf.usuario_responsable IS NULL
ON CONFLICT (masa_id) DO NOTHING;

-- Verificación
SELECT count(*) AS completadas, count(rd.id) AS con_registro, count(*) - count(rd.id) AS sin_registro
FROM progreso_fases pf
LEFT JOIN registros_division rd ON rd.masa_id = pf.masa_id
WHERE pf.fase = 'DIVISION' AND pf.estado = 'COMPLETADA';

COMMIT;

-- ============================================================================
-- ROLLBACK (ejecutar manualmente si hace falta revertir SOLO lo que agregó
-- esta migración — no toca filas escritas por el código nuevo en producción
-- normal, porque esas nacen junto con su INSERT en el mismo request que
-- completa DIVISION, no con este backfill)
-- ============================================================================
-- BEGIN;
-- DELETE FROM registros_division rd
-- USING progreso_fases pf
-- WHERE rd.masa_id = pf.masa_id
--   AND pf.fase = 'DIVISION'
--   AND rd.observaciones IS NOT DISTINCT FROM NULLIF(pf.datos_fase->>'observaciones', '')
--   AND rd.fecha_registro = COALESCE(pf.fecha_completado, pf.updated_at);
--   -- Nota: este rollback es best-effort por coincidencia de fecha_registro;
--   -- si se necesita reversión exacta, restaurar desde un snapshot de BD.
-- COMMIT;
