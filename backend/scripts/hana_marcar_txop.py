#!/usr/bin/env python3
"""
Marca OV (órdenes de venta) como sincronizadas en HANA (UDF U_JZ_TxOP en ORDR).
Reemplaza el PATCH a Service Layer (/Orders) en marcarOvSincronizada.
Uso: python3 hana_marcar_txop.py
Entrada: JSON array de docEntry por stdin, ej [123, 124, 125]
Salida: JSON por stdout, {"actualizados": [...], "fallidos": [...]}
"""
import sys
import os
import json
from hdbcli import dbapi


def main():
    try:
        doc_entries = json.loads(sys.stdin.read())
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

        actualizados = []
        fallidos = []

        for doc_entry in doc_entries:
            try:
                cursor.execute(f'''
                    UPDATE "{schema}"."ORDR" SET "U_JZ_TxOP" = 'SI' WHERE "DocEntry" = ?
                ''', (doc_entry,))
                conn.commit()
                actualizados.append(doc_entry)
            except Exception as e:
                print(json.dumps({"warning": f"Fallo al marcar docEntry {doc_entry}: {e}"}), file=sys.stderr)
                fallidos.append(doc_entry)

        conn.close()

        print(json.dumps({"actualizados": actualizados, "fallidos": fallidos}))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
