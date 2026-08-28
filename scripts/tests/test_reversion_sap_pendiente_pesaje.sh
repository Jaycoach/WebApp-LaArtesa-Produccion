#!/bin/bash
# ============================================================================
# test_reversion_sap_pendiente_pesaje.sh
# Script de aceptación — REVERSIÓN completa de "pesaje pendiente por
# desconexión SAP" (commits fc6a4bd y c48b5f5..0dc51d6, revertidos en
# 5137d33). Confirma que el comportamiento volvió a ser el ORIGINAL:
# ante cualquier fallo de SAP (red, autenticación, lo que sea) el pesaje
# se bloquea de forma síncrona con 502, sin excepción.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   ADMIN_USER=admin ADMIN_PASSWORD='...' \
#     bash scripts/tests/test_reversion_sap_pendiente_pesaje.sh <MASA_ID>
#
# MASA_ID: masa en fase PESAJE, estado APROBADA, sin confirmar.
#
# Requiere: psql, curl, jq, dig, `sudo -n iptables` sin password.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"

MASA_ID="${1:?Uso: $0 <MASA_ID>}"
ADMIN_USER="${ADMIN_USER:?Definir ADMIN_USER}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Definir ADMIN_PASSWORD}"

FALLOS=0
IPTABLES_APPLIED=0

fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "FALLO: no se encontró $ENV_FILE"
  exit 1
fi

DB_HOST=$(grep -E '^DB_HOST='     "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep -E '^DB_PORT='     "$ENV_FILE" | cut -d= -f2-)
DB_NAME=$(grep -E '^DB_NAME='     "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep -E '^DB_USER='     "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
SAP_URL_CFG=$(grep -E '^SAP_URL='    "$ENV_FILE" | cut -d= -f2-)
SAP_HOST=$(echo "$SAP_URL_CFG" | sed -E 's#^https?://([^:/]+).*#\1#')
SAP_PORT=$(echo "$SAP_URL_CFG" | sed -E 's#^https?://[^:/]+:([0-9]+).*#\1#')
SAP_IP=$(dig +short "$SAP_HOST" | tail -1)

if [ -z "$SAP_IP" ]; then
  echo "FALLO: no se pudo resolver IP de $SAP_HOST"
  exit 1
fi

psql_q() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "$1"
}

cleanup() {
  if [ "$IPTABLES_APPLIED" = "1" ]; then
    sudo -n iptables -D OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset 2>/dev/null
    echo "[cleanup] regla iptables de bloqueo a SAP removida."
  fi
}
trap cleanup EXIT

echo "===================================================="
echo "PRECHECK: la funcionalidad revertida no deja rastro en el código"
echo "===================================================="
RASTROS=$(grep -rlE "PendientesSAPPanel|clasificarErrorSAP|sap-pendientes|pendiente_sap|SAP_PENDIENTES" "$REPO_ROOT" \
  --include="*.js" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.sh" 2>/dev/null \
  | grep -v "/node_modules/" | grep -v "test_reversion_sap_pendiente_pesaje.sh")
if [ -z "$RASTROS" ]; then
  ok "cero referencias a la funcionalidad revertida en todo el repo"
else
  fallo "quedan referencias sin limpiar:"
  echo "$RASTROS"
fi

echo ""
echo "===================================================="
echo "LOGIN admin"
echo "===================================================="
LOGIN_RESP=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // .data.token // empty')
if [ -z "$TOKEN" ]; then
  echo "$LOGIN_RESP"
  fallo "login falló"
  echo "TODOS LOS CHECKS FALLARON (sin token no se puede continuar)"
  exit 1
fi
ok "login exitoso"
AUTH_HEADER="Authorization: Bearer $TOKEN"

completar_checklist() {
  local masa_id="$1"
  local checklist items rc=0
  checklist=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$masa_id/checklist")
  items=$(echo "$checklist" | jq -c '
    .data.ingredientes[]
    | select(.es_decoracion == false)
    | { id: .id, peso_real: ((.cantidad_kilos | tonumber) * 1000), lote: (.lote_sugerido // ""), lotes_consumo: (.lotes_consumo_sugerido // []) }
  ')
  if [ -z "$items" ]; then
    fallo "checklist de masa $masa_id vino vacío: $checklist"
    return 1
  fi
  while IFS= read -r item; do
    [ -z "$item" ] && continue
    local id http tmpfile body
    id=$(echo "$item" | jq -r '.id')
    body=$(echo "$item" | jq '{disponible:true, verificado:true, pesado:true, peso_real, lote, lotes_consumo}')
    tmpfile="/tmp/patch_resp_${masa_id}_${id}.json"
    http=$(curl -s -o "$tmpfile" -w '%{http_code}' -X PATCH -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
              -d "$body" "$API_URL/pesaje/$masa_id/ingredientes/$id")
    if [ "$http" != "200" ]; then
      fallo "PATCH ingrediente $id (masa $masa_id) -> HTTP $http: $(cat "$tmpfile")"
      rc=1
    fi
    rm -f "$tmpfile"
  done <<< "$items"
  return $rc
}

echo ""
echo "===================================================="
echo "PREP: stock de prueba suficiente para checklist (staging)"
echo "===================================================="
psql_q "UPDATE sap_inventario_mp SET stock_almp = 500, ultimo_sync = NOW() WHERE stock_almp < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id = $MASA_ID);" > /dev/null
psql_q "UPDATE sap_lotes_mp SET cantidad_disponible = 500, ultimo_sync = NOW() WHERE cantidad_disponible < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id = $MASA_ID);" > /dev/null
ok "stock y lotes de prueba ajustados para la masa $MASA_ID"

completar_checklist "$MASA_ID"
COMPLETADO=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_ID/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO" = "true" ]; then ok "checklist de masa $MASA_ID completo"; else fallo "checklist de masa $MASA_ID incompleto tras marcar ingredientes"; fi

echo ""
echo "===================================================="
echo "FASE A: confirmar pesaje con SAP inalcanzable -> debe BLOQUEAR (comportamiento original)"
echo "===================================================="
echo "-- bloqueando salida de red hacia SAP ($SAP_HOST -> $SAP_IP:$SAP_PORT) --"
sudo -n iptables -I OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset
IPTABLES_APPLIED=1
sleep 1
echo "evidencia de caída real:"
curl -s -o /dev/null -w '  curl a SAP -> exit code %{exitcode} (esperado: distinto de 0)\n' --max-time 5 -k "$SAP_URL_CFG/Login" 2>&1 || true

HTTP=$(curl -s -o /tmp/confirmar_bloqueado.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_ID/confirmar")
RESP=$(cat /tmp/confirmar_bloqueado.json)
echo "HTTP $HTTP :: $RESP"
if [ "$HTTP" = "502" ]; then ok "confirmar pesaje devolvió 502 con SAP caído (bloqueo síncrono restaurado)"; else fallo "confirmar pesaje devolvió HTTP $HTTP en vez de 502"; fi
REINTENTABLE=$(echo "$RESP" | jq -r '.reintentable // .data.reintentable // empty')
if [ "$REINTENTABLE" = "true" ]; then ok "respuesta incluye reintentable:true"; else fallo "respuesta NO incluye reintentable:true: $RESP"; fi
PENDIENTE_SAP=$(echo "$RESP" | jq -r 'if has("pendiente_sap") then "presente" elif (.data? // {} | has("pendiente_sap")) then "presente" else "ausente" end')
if [ "$PENDIENTE_SAP" = "ausente" ]; then ok "respuesta NO tiene campo pendiente_sap (funcionalidad eliminada)"; else fallo "respuesta todavía tiene pendiente_sap — la reversión no está completa"; fi

echo "-- verificando estado en BD (con SAP aún caído) --"
FASE=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_ID;")
if [ "$FASE" = "PESAJE" ]; then ok "masa $MASA_ID NO avanzó de fase (sigue en PESAJE)"; else fallo "masa $MASA_ID avanzó inesperadamente a $FASE"; fi

DOCENTRY=$(psql_q "SELECT COALESCE(sap_doc_entry_pesaje::text,'') FROM masas_produccion WHERE id=$MASA_ID;")
if [ -z "$DOCENTRY" ]; then ok "sap_doc_entry_pesaje sigue NULL"; else fallo "sap_doc_entry_pesaje inesperadamente poblado: $DOCENTRY"; fi

ULTIMO_LOG=$(psql_q "SELECT estado FROM sap_sync_log WHERE request_payload::text LIKE '%masa ${MASA_ID}\"%' AND tipo_operacion='GOODS_ISSUE_PESAJE' ORDER BY id DESC LIMIT 1;")
if [ "$ULTIMO_LOG" = "ERROR" ]; then
  ok "sap_sync_log registró el fallo como ERROR (nunca PENDING — esa columna/estado ya no se usa)"
elif [ -z "$ULTIMO_LOG" ]; then
  fallo "no se encontró fila en sap_sync_log para el intento fallido de la masa $MASA_ID"
else
  fallo "sap_sync_log quedó en estado '$ULTIMO_LOG' (se esperaba ERROR)"
fi

PLC_CONFIRMADO=$(psql_q "SELECT COUNT(*) FROM pesaje_lotes_consumo WHERE masa_id=$MASA_ID AND confirmado_sap=true;")
if [ "$PLC_CONFIRMADO" = "0" ]; then ok "pesaje_lotes_consumo: ningún lote se marcó confirmado_sap=true (no hubo descuento local optimista)"; else fallo "pesaje_lotes_consumo tiene $PLC_CONFIRMADO filas confirmado_sap=true pese al bloqueo — posible descuento local indebido"; fi

echo ""
echo "===================================================="
echo "FASE B: endpoints eliminados -> deben responder 404, no 200 con lista vacía"
echo "===================================================="
HTTP_GET=$(curl -s -o /tmp/get_pendientes.json -w '%{http_code}' -H "$AUTH_HEADER" "$API_URL/pesaje/sap-pendientes")
echo "GET /api/pesaje/sap-pendientes -> HTTP $HTTP_GET :: $(cat /tmp/get_pendientes.json)"
if [ "$HTTP_GET" = "404" ]; then ok "GET /api/pesaje/sap-pendientes -> 404"; else fallo "GET /api/pesaje/sap-pendientes -> HTTP $HTTP_GET (se esperaba 404)"; fi

HTTP_POST=$(curl -s -o /tmp/post_reenviar.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"fecha_produccion":"todas"}' "$API_URL/pesaje/sap-pendientes/reenviar")
echo "POST /api/pesaje/sap-pendientes/reenviar -> HTTP $HTTP_POST :: $(cat /tmp/post_reenviar.json)"
if [ "$HTTP_POST" = "404" ]; then ok "POST /api/pesaje/sap-pendientes/reenviar -> 404"; else fallo "POST /api/pesaje/sap-pendientes/reenviar -> HTTP $HTTP_POST (se esperaba 404)"; fi

echo ""
echo "===================================================="
echo "FASE C: restaurar conectividad -> la masa debe poder confirmarse normalmente"
echo "===================================================="
echo "-- restaurando conectividad a SAP --"
sudo -n iptables -D OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset
IPTABLES_APPLIED=0
sleep 1

HTTP_OK=$(curl -s -o /tmp/confirmar_ok.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_ID/confirmar")
RESP_OK=$(cat /tmp/confirmar_ok.json)
echo "HTTP $HTTP_OK :: $RESP_OK"
if [ "$HTTP_OK" = "200" ]; then ok "con SAP disponible, confirmar pesaje vuelve a funcionar normalmente (HTTP 200)"; else fallo "confirmar pesaje con SAP disponible dio HTTP $HTTP_OK en vez de 200: $RESP_OK"; fi

FASE_FINAL=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_ID;")
if [ "$FASE_FINAL" = "AMASADO" ]; then ok "masa $MASA_ID avanzó a AMASADO tras confirmar con éxito"; else fallo "masa $MASA_ID no avanzó a AMASADO (fase_actual=$FASE_FINAL)"; fi

DOCENTRY_FINAL=$(psql_q "SELECT COALESCE(sap_doc_entry_pesaje::text,'') FROM masas_produccion WHERE id=$MASA_ID;")
if [ -n "$DOCENTRY_FINAL" ]; then ok "sap_doc_entry_pesaje quedó poblado: $DOCENTRY_FINAL"; else fallo "sap_doc_entry_pesaje sigue vacío tras confirmar con éxito"; fi

echo ""
echo "===================================================="
echo "RESUMEN"
echo "===================================================="
if [ "$FALLOS" = "0" ]; then
  echo "TODOS LOS CHECKS PASARON"
  exit 0
else
  echo "$FALLOS CHECK(S) FALLARON"
  exit 1
fi
