#!/usr/bin/env python3
"""
Extracción directa de stock de materia prima desde HANA (OITW + OITM), bodega ALMP.
Reemplaza getStockMateriaPrima() (Service Layer, secuencial por artículo, 1 request
por ítem) por una sola consulta consolidada.

Uso: python3 hana_stock_mp.py
Entrada: lista de itemCodes como JSON array por stdin, ej: ["PEPR01","PEPR02"]
Salida: JSON por stdout: {"stock": {itemCode: {...}}}
"""
import sys
import os
import json
from hdbcli import dbapi


def main():
    try:
        item_codes = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"error": f"Entrada inválida: {e}"}), file=sys.stderr)
        sys.exit(1)

    if not item_codes:
        print(json.dumps({"stock": {}}))
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
            SELECT W."ItemCode", P."ItemName", P."InvntryUom", P."ManBtchNum",
                   W."OnHand", W."IsCommited", W."OnOrder", W."AvgPrice"
            FROM "{schema}"."OITW" W
            INNER JOIN "{schema}"."OITM" P ON P."ItemCode" = W."ItemCode"
            WHERE W."WhsCode" = 'ALMP' AND W."ItemCode" IN ({placeholders})
        '''
        cursor.execute(query, item_codes)

        resultado = {}
        for row in cursor.fetchall():
            item_code, item_name, uom, man_btch, on_hand, is_committed, on_order, avg_price = row
            resultado[item_code] = {
                "itemCode": item_code,
                "itemName": item_name,
                "uom": uom,
                "manageBatchNumbers": str(man_btch or '').strip().upper() == 'Y',
                "costoPromedio": float(avg_price) if avg_price is not None else 0,
                "stockAlmp": float(on_hand) if on_hand is not None else 0,
                "committedAlmp": float(is_committed) if is_committed is not None else 0,
                "orderedAlmp": float(on_order) if on_order is not None else 0,
            }

        conn.close()
        print(json.dumps({"stock": resultado}))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()