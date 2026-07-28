#!/usr/bin/env python3
"""
Extracción directa de BOM completo (artículos con tipo de masa + sus listas de
materiales + UoM/grupo/decoración de cada componente) desde HANA.
Reemplaza getArticulosConTipoMasa() + getBOM() + getItemsUoM() (Service Layer,
secuencial por artículo) por una sola consulta consolidada OITM+ITT1+OITM.

Uso: python3 hana_bom_completo.py (usa variables de entorno HANA_*)
Salida: JSON por stdout: {"articulos": [{itemCode, itemName, tipoMasa,
        salesQtyPerPack, gramaje, multiploDivisor, tamanio, forma,
        bom: [{itemCode, itemName, quantity, warehouse, issueMethod,
               visualOrder, uom, grupoSap, esDecoracion}, ...]}, ...]}
"""
import sys
import os
import json
from hdbcli import dbapi


def main():
    schema = os.environ.get('HANA_SCHEMA')
    if not schema:
        print(json.dumps({"error": "HANA_SCHEMA no configurado"}), file=sys.stderr)
        sys.exit(1)

    # Filtro opcional: python3 hana_bom_completo.py MP0029,MP0080
    # Sincroniza solo esos artículos (con todos sus atributos: tamaño, forma,
    # decoración, etc.) en vez de correr el catálogo completo.
    item_codes_filtro = None
    if len(sys.argv) > 1 and sys.argv[1].strip():
        item_codes_filtro = [c.strip().upper() for c in sys.argv[1].split(',') if c.strip()]

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

        filtro_sql = ''
        params = []
        if item_codes_filtro:
            placeholders = ', '.join(['?'] * len(item_codes_filtro))
            filtro_sql = f' AND P."ItemCode" IN ({placeholders})'
            params = item_codes_filtro

        cursor.execute(f'''
            SELECT
              P."ItemCode", P."ItemName", P."U_JZ_Tipos_Masa",
              P."SalPackUn", P."SWeight1", P."U_JZ_MultiploDivisor",
              P."U_JZ_Tamanio", P."U_JZ_Forma", P."U_JZ_PesMasDiv",
              L."Code", L."ItemName", L."Quantity", L."Warehouse",
              L."IssueMthd", L."VisOrder",
              C."InvntryUom", C."ItmsGrpCod", C."U_JZ_Decoracion"
            FROM "{schema}"."OITM" P
            LEFT JOIN "{schema}"."ITT1" L ON L."Father" = P."ItemCode" AND L."Type" = 4
            LEFT JOIN "{schema}"."OITM" C ON C."ItemCode" = L."Code"
            WHERE P."U_JZ_Tipos_Masa" IS NOT NULL AND P."U_JZ_Tipos_Masa" <> ''
              AND P."validFor" = 'Y' AND P."frozenFor" = 'N'
              {filtro_sql}
        ''', params)

        articulos = {}
        for row in cursor.fetchall():
            (item_code, item_name, tipo_masa, sales_qty_per_pack, gramaje,
             multiplo_divisor, tamanio, forma, peso_masa_dividida,
             comp_code, comp_name, cantidad, warehouse, issue_method, vis_order,
             uom, grupo_sap, decoracion) = row

            if item_code not in articulos:
                articulos[item_code] = {
                    "itemCode": item_code,
                    "itemName": item_name,
                    "tipoMasa": tipo_masa,
                    "salesQtyPerPack": float(sales_qty_per_pack) if sales_qty_per_pack is not None else 1,
                    "gramaje": float(gramaje) if gramaje is not None else 0,
                    "multiploDivisor": round(float(multiplo_divisor)) if multiplo_divisor is not None else 0,
                    "tamanio": tamanio,
                    "forma": forma,
                    "pesoMasaDividida": float(peso_masa_dividida) if peso_masa_dividida is not None else None,
                    "bom": [],
                }

            if comp_code is not None:
                articulos[item_code]["bom"].append({
                    "itemCode": comp_code,
                    "itemName": comp_name,
                    "quantity": float(cantidad) if cantidad is not None else 0,
                    "warehouse": warehouse,
                    "issueMethod": issue_method,
                    "visualOrder": vis_order or 0,
                    "uom": uom,
                    "grupoSap": grupo_sap,
                    "esDecoracion": str(decoracion or '').strip().upper() == 'SI',
                })

        conn.close()
        print(json.dumps({"articulos": list(articulos.values())}))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
