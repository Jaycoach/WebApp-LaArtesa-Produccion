"""
Resolución centralizada de unidades_por_paquete (paquete SAP, ex "SalPackUn")
a partir del UDF U_JZ_PanesPorBolsa, con el mismo fallback que ya se usaba
disperso (regex " X<N>" sobre el nombre del producto) y default 1 si ninguno
aplica. Mismo criterio que resolverUnidadesPorPaquete en sap.service.js —
se resuelve UNA sola vez en el flujo de sincronización de OV
(hana_ov_sync.py), no en cada consumidor.

IMPORTANTE: NO se usa en hana_bom_completo.py (BOM-sync, alimenta
sap_articulos) a propósito — sap_articulos se usa como fuente de verdad de
master data para el backfill de productos_por_masa (ver sesión
2026-08-20 sección 3.5/3.6), y adivinar por nombre ahí "arreglaría"
silenciosamente los 5 productos con conflicto/ausencia real de UDF en SAP
(PANPAQ13, PANPAQ11, PANPAQ05, PANPAQ26, PANPAQ20) sin que Diana confirme
el valor correcto primero.
"""
import re


def resolver_unidades_por_paquete(item_code, item_name, udf_panes_por_bolsa):
    if udf_panes_por_bolsa is not None and float(udf_panes_por_bolsa) > 0:
        return float(udf_panes_por_bolsa)
    m = re.search(r' X ?(\d+)', item_name or '', re.IGNORECASE)
    if m:
        return float(m.group(1))
    return 1.0
