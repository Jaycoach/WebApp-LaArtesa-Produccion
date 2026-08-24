#!/usr/bin/env python3
"""
Extracción directa de lotes de materia prima desde HANA (OBTN + OBTQ), bodega ALMP.
Reemplaza las 19 llamadas SQLQuery artlot_{ITEM_CODE} vía Service Layer por una
sola consulta consolidada.

Uso: HANA_PASSWORD=xxx python3 hana_lotes_mp.py
Entrada: lista de itemCodes como JSON array por stdin, ej: ["MP0001","MP0002"]
Salida: JSON por stdout: {"lotes": {...}, "itemsFallidos": []}
"""
import sys
import os
import json
from hdbcli import dbapi


def parse_fecha_sap(val):
    if val is None:
        return None
    return val.strftime('%Y-%m-%d')


def main():
    try:
        item_codes = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"error": f"Entrada inválida: {e}"}), file=sys.stderr)
        sys.exit(1)

    if not item_codes:
        print(json.dumps({"lotes": {}, "itemsFallidos": []}))
        return

    schema = os.environ.get('HANA_SCHEMA')
    if not schema:
        print(json.dumps({"error": "HANA_SCHEMA no configurado"}), file=sys.stderr)
        sys.exit(1)

    try:
        conn = dbapi.connect(
            address=os.environ['HANA_HOST'],
            port=int(os.environ['HANA_PORT']),
            user=os.environ['HANA_USER'],
            password=os.environ['HANA_PASSWORD'],
            encrypt=True,
            sslValidateCertificate=False,
        )
        cursor = conn.cursor()

        placeholders = ','.join(['?'] * len(item_codes))
        query = f'''
            SELECT "OBTN"."ItemCode", "OBTN"."DistNumber", "OBTQ"."Quantity",
                   "OBTN"."ExpDate", "OBTN"."MnfDate", "OBTN"."CreateDate"
            FROM "{schema}"."OBTN" "OBTN"
            INNER JOIN "{schema}"."OBTQ" "OBTQ"
              ON "OBTN"."ItemCode" = "OBTQ"."ItemCode" AND "OBTN"."SysNumber" = "OBTQ"."SysNumber"
            WHERE "OBTQ"."WhsCode" = 'ALMP' AND "OBTQ"."Quantity" > 0
              AND "OBTN"."ItemCode" IN ({placeholders})
        '''
        cursor.execute(query, tuple(item_codes))

        resultado = {}
        for row in cursor.fetchall():
            item_code, dist_number, quantity, exp_date, mnf_date, create_date = row
            resultado.setdefault(item_code, []).append({
                "batch": dist_number,
                # FIX 2026-08-24 (Hallazgo 7): redondear a 3 decimales (1g de
                # resolucion) hacia arriba mostraba como "1g disponible" un
                # real de, por ejemplo, 0.6g -- Orbit pedia exactamente eso y
                # SAP lo rechazaba por insuficiente. Misma precision que el
                # resto de los fixes de esta sesion.
                "cantidad_disponible": round(float(quantity), 6),
                "admissionDate": parse_fecha_sap(create_date),
                "expirationDate": parse_fecha_sap(exp_date),
                "manufacturingDate": parse_fecha_sap(mnf_date),
                "status": "released",
            })

        # Ordenar cada lista por admissionDate ascendente (nulls al final) — igual que la versión Service Layer
        for item_code in resultado:
            resultado[item_code].sort(
                key=lambda l: (l["admissionDate"] is None, l["admissionDate"] or "")
            )

        conn.close()
        print(json.dumps({"lotes": resultado, "itemsFallidos": []}))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
