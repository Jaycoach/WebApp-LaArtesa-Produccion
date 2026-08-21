/**
 * Deriva unidades_por_paquete "confiable" a partir del valor ya persistido en
 * productos_por_masa (traído por la API) + el nombre del producto. NO
 * confundir con la resolución que hace el backend al sincronizar desde SAP
 * (esa confía en cualquier UDF > 0); aquí el umbral es > 1 a propósito: el
 * valor persistido puede seguir arrastrando el bug histórico de
 * unidades_por_paquete congelado en 1 (ver sesión 2026-08-20, secciones
 * 3.5/3.6), así que un "1" no se confía ciegamente — se intenta primero el
 * patrón " X<N>" en el nombre del producto antes de caer a 1 real.
 *
 * Antes duplicado (idéntico) dos veces dentro de DivisionMasa.tsx —
 * centralizado aquí.
 */
export function upqDesdeProducto(unidadesPorPaquete: unknown, productoNombre: string | null | undefined): number {
  const persistido = parseFloat(String(unidadesPorPaquete ?? ''));
  if (persistido && persistido > 1) return persistido;
  const m = (productoNombre || '').match(/ X ?(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}
