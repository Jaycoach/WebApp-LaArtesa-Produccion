#!/usr/bin/env python3
"""
Extracción directa de OV (órdenes de venta) abiertas desde HANA (ORDR + RDR1 + OITM).
Reemplaza las llamadas a Service Layer (/Orders + /Items) en getDatosParaSincronizacion.
Uso: python3 hana_ov_sync.py
Entrada: {"fecha": "2026-07-10"} como JSON por stdin
Salida: JSON por stdout, lista de productos con el mismo shape que devuelve
        getDatosParaSincronizacion() vía Service Layer.
"""
import sys
import os
import json
import re
from hdbcli import dbapi

ITEMS_EXCLUIDOS = {'PASPT12'}


def main():
    try:
        entrada = json.loads(sys.stdin.read())
        fecha = entrada['fecha']
    except Exception as e:
        print(json.dumps({"error": f"Entrada inválida: {e}"}), file=sys.stderr)
        sys.exit(1)

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

        # 1. Líneas de OV abiertas para la fecha (cabecera y línea ambas abiertas)
        cursor.execute(f'''
            SELECT R."DocEntry", O."DocNum", O."Series", R."LineNum",
                   R."ItemCode", R."Dscription", R."Quantity"
            FROM "{schema}"."RDR1" R
            INNER JOIN "{schema}"."ORDR" O ON O."DocEntry" = R."DocEntry"
            WHERE O."DocDate" = ? AND O."DocStatus" = 'O' AND R."LineStatus" = 'O'
        ''', (fecha,))
        filas = cursor.fetchall()

        lineas = []
        for doc_entry, doc_num, series, line_num, item_code, dscription, quantity in filas:
            desc_up = (dscription or '').upper()
            if 'COSTO DE ENVIO' in desc_up:
                continue
            if item_code and 'ENVIO' in item_code.upper():
                continue
            if item_code in ITEMS_EXCLUIDOS:
                continue
            lineas.append({
                'docEntry': doc_entry,
                'docNum': doc_num,
                'series': series,
                'lineNum': line_num or 0,
                'itemCode': item_code,
                'itemDescription': dscription,
                'quantity': float(quantity),
            })

        if not lineas:
            print(json.dumps([]))
            return

        # 2. Info de artículos (OITM) para los itemCodes únicos
        item_codes = list({l['itemCode'] for l in lineas})
        placeholders = ','.join(['?'] * len(item_codes))
        cursor.execute(f'''
            SELECT "ItemCode", "ItemName", "U_JZ_Tipos_Masa", "SalPackUn",
                   "SWeight1", "U_JZ_MultiploDivisor", "validFor", "frozenFor",
                   "U_JZ_Tamanio", "U_JZ_Forma", "U_JZ_PesMasDiv"
            FROM "{schema}"."OITM"
            WHERE "ItemCode" IN ({placeholders})
        ''', item_codes)

        articulos = {}
        for item_code, item_name, tipo_masa, sal_pack_un, sweight1, multiplo, valid_for, frozen_for, tamanio, forma, peso_masa_dividida in cursor.fetchall():
            if valid_for == 'N' or frozen_for == 'Y':
                continue
            if not tipo_masa:
                continue
            articulos[item_code] = {
                'itemName': item_name,
                'tipoMasa': tipo_masa,
                'salPackUn': float(sal_pack_un) if sal_pack_un is not None else 1,
                'gramaje': float(sweight1) if sweight1 is not None else 0,
                'multiploDivisor': round(float(multiplo)) if multiplo is not None else 0,
                'tamanio': tamanio or None,
                'forma': forma or None,
                'pesoMasaDividida': float(peso_masa_dividida) if peso_masa_dividida is not None else None,
            }

        conn.close()

        # 3. Combinar (mismo cálculo que getDatosParaSincronizacion en JS)
        resultado = []
        for linea in lineas:
            art = articulos.get(linea['itemCode'])
            if art is None:
                continue  # artículo inactivo/congelado/sin tipo masa

            unidades_pedidas = linea['quantity']
            descripcion = art['itemName'] or linea['itemDescription'] or ''
            if art['salPackUn'] and art['salPackUn'] > 1:
                unidades_por_paquete = art['salPackUn']
            else:
                m = re.search(r' X ?(\d+)', descripcion, re.IGNORECASE)
                unidades_por_paquete = int(m.group(1)) if m else 1

            gramaje = art['gramaje']
            kilos_pedidos = gramaje * unidades_pedidas

            resultado.append({
                'docEntry': linea['docEntry'],
                'docNum': linea['docNum'],
                'series': linea['series'],
                'lineNum': linea['lineNum'],
                'itemCode': linea['itemCode'],
                'descripcion': art['itemName'] or linea['itemDescription'],
                'tipoMasa': art['tipoMasa'],
                'unidadesPedidas': unidades_pedidas,
                'unidadesPorPaquete': unidades_por_paquete,
                'cantidadPaquetes': unidades_pedidas,
                'gramaje': gramaje,
                'kilosPedidos': kilos_pedidos,
                'multiploDivisor': art['multiploDivisor'],
                'tamanio': art.get('tamanio'),
                'forma': art.get('forma'),
                'pesoMasaDividida': art.get('pesoMasaDividida'),
            })

        print(json.dumps(resultado))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
