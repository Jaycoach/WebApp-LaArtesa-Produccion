#!/usr/bin/env python3
"""
Extracción directa de tipos de masa desde HANA (UDT @JZ_TIPOMASA).
Reemplaza la llamada Service Layer a /U_JZ_TIPOMASA por consulta directa vía hdbcli.

Uso: python3 hana_tipos_masa.py (usa variables de entorno HANA_*)
Salida: JSON por stdout: {"tipos": [{"code":..., "name":..., "maxDiv": ... | null}, ...]}
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
        cursor.execute(f'SELECT "Code", "Name", "U_JZ_MaxDiv" FROM "{schema}"."@JZ_TIPOMASA"')

        tipos = []
        for row in cursor.fetchall():
            code, name, max_div = row
            tipos.append({
                "code": code,
                "name": name,
                "maxDiv": float(max_div) if max_div is not None else None,
            })

        conn.close()
        print(json.dumps({"tipos": tipos}))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
