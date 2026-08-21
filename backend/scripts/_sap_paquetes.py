"""
Resolución centralizada de unidades_por_paquete (paquete SAP, ex "SalPackUn")
a partir del UDF U_JZ_PanesPorBolsa, con el mismo fallback que ya se usaba
disperso (regex " X<N>" sobre el nombre del producto) y default 1 si ninguno
aplica. Mismo criterio que resolverUnidadesPorPaquete en sap.service.js —
se resuelve UNA sola vez en el flujo de sincronización de OV
(hana_ov_sync.py) y de BOM (hana_bom_completo.py, que alimenta
sap_articulos), no en cada consumidor.

CORRECCIÓN 2026-08-20 (validado con datos reales de staging): antes esta
función deliberadamente NO se usaba en hana_bom_completo.py, por temor a
que el fallback por nombre "arreglara" silenciosamente los 5 productos
reportados con conflicto/ausencia de UDF (PANPAQ13, PANPAQ11, PANPAQ05,
PANPAQ26, PANPAQ20). Falso para PANPAQ26: su UDF viene vacío/NULL/0 en SAP
(no un valor real explícito) y el nombre sí tiene el patrón " X 4" — el
fallback ya se confiaba río abajo en productos_por_masa y ya daba 4 ahí;
sap_articulos quedándose en el crudo (coalescido a 1 antes de esta
función, ver hana_bom_completo.py) era la inconsistencia real, no una
protección. El umbral (SAP trae un valor real y distinto de vacío/0 se
confía SIEMPRE, sin intentar el nombre) sigue protegiendo correctamente a
PANPAQ13/11/05 (sin UDF y sin patrón, caen a 1 igual) y a PANPAQ20 (su UDF
sí trae un valor real explícito en SAP, se confía tal cual, nunca llega a
comparar contra el nombre "X3") — el umbral de la función NO cambió, solo
se corrigió que el valor crudo real (no coalescido) le llegara.
"""
import re


def resolver_unidades_por_paquete(item_code, item_name, udf_panes_por_bolsa):
    if udf_panes_por_bolsa is not None and float(udf_panes_por_bolsa) > 0:
        return float(udf_panes_por_bolsa)
    m = re.search(r' X ?(\d+)', item_name or '', re.IGNORECASE)
    if m:
        return float(m.group(1))
    return 1.0
