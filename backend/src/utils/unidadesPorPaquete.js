/**
 * Deriva unidades_por_paquete "confiable" para consumidores que leen la fila
 * ya persistida en productos_por_masa (División, Pesaje, Subdivisión) — NO
 * confundir con resolverUnidadesPorPaquete en sap.service.js, que resuelve
 * desde el UDF crudo de SAP (U_JZ_PanesPorBolsa) en el momento de
 * sincronizar y confía en cualquier valor > 0.
 *
 * Aquí el umbral es > 1, a propósito distinto: el valor ya persistido puede
 * seguir arrastrando el bug histórico (unidades_por_paquete congelado en 1
 * por falta de sync/backfill — ver sesión 2026-08-20, secciones 3.5/3.6), así
 * que un "1" no se confía ciegamente — se intenta primero el patrón " X<N>"
 * en el nombre del producto antes de caer a 1 real. Una vez el backfill de
 * 3.6 corrija productos_por_masa, este fallback pasa a ser puramente
 * defensivo para filas legacy sin re-sincronizar.
 *
 * Antes duplicado (idéntico, copiado y pegado) en sap.controller.js,
 * fases.controller.js (×4), pesaje.controller.js — centralizado aquí.
 */
function upqDesdeProducto(unidadesPorPaquete, productoNombre) {
  const persistido = parseFloat(unidadesPorPaquete);
  if (persistido && persistido > 1) return persistido;
  const m = (productoNombre || '').match(/ X ?(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

module.exports = { upqDesdeProducto };
