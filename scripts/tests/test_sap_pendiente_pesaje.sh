#!/bin/bash
# ============================================================================
# test_sap_pendiente_pesaje.sh
# Script de aceptación — feature "pesaje pendiente por desconexión SAP"
# Valida: migración 070 (sap_sync_log.masa_id), GET/POST /api/pesaje/sap-pendientes,
# y que el caso de negocio (rechazo real de SAP) siga bloqueando con 502 sin cambios.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   ADMIN_USER=admin ADMIN_PASSWORD='...' \
#     bash scripts/tests/test_sap_pendiente_pesaje.sh <MASA_ID_CONEXION> <MASA_ID_NEGOCIO>
#
# MASA_ID_CONEXION: masa en fase PESAJE, estado APROBADA, sin confirmar — se usa
#   para el escenario "SAP inalcanzable" (se bloquea la salida de red hacia SAP
#   con iptables durante la confirmación, luego se restaura).
# MASA_ID_NEGOCIO: otra masa en las mismas condiciones — se usa para el escenario
#   de rechazo real de SAP (lote inexistente), que debe seguir devolviendo 502.
#
# Requiere: psql, curl, jq, dig, `sudo -n iptables` sin password.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"

MASA_ID_CONEXION="${1:?Uso: $0 <MASA_ID_CONEXION> <MASA_ID_NEGOCIO>}"
MASA_ID_NEGOCIO="${2:?Uso: $0 <MASA_ID_CONEXION> <MASA_ID_NEGOCIO>}"
ADMIN_USER="${ADMIN_USER:?Definir ADMIN_USER}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Definir ADMIN_PASSWORD}"

FALLOS=0
IPTABLES_APPLIED=0
FAKE_LOTE_INSERTADO=0
FAKE_LOTE_ITEM=""
FAKE_LOTE_BATCH="BATCH-TEST-INEXISTENTE-$$"

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
  if [ "$FAKE_LOTE_INSERTADO" = "1" ] && [ -n "$FAKE_LOTE_ITEM" ]; then
    psql_q "DELETE FROM sap_lotes_mp WHERE item_code='$FAKE_LOTE_ITEM' AND batch='$FAKE_LOTE_BATCH';" >/dev/null
    echo "[cleanup] lote de prueba $FAKE_LOTE_BATCH eliminado."
  fi
}
trap cleanup EXIT

echo "===================================================="
echo "PRECHECK: migración 070 (sap_sync_log.masa_id)"
echo "===================================================="
COL=$(psql_q "SELECT column_name FROM information_schema.columns WHERE table_name='sap_sync_log' AND column_name='masa_id';")
if [ "$COL" = "masa_id" ]; then
  ok "columna masa_id existe en sap_sync_log"
else
  fallo "columna masa_id NO existe en sap_sync_log — migración 070 no aplicada"
  echo "TODOS LOS CHECKS FALLARON (abortando, sin migración no tiene sentido continuar)"
  exit 1
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

# --- completa el checklist de una masa marcando todos los ingredientes no-decoración ---
# uso: completar_checklist <masa_id> [override_ing_id] [override_lote]
completar_checklist() {
  local masa_id="$1" override_id="${2:-}" override_lote="${3:-}"
  local checklist
  checklist=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$masa_id/checklist")
  local items
  items=$(echo "$checklist" | jq -c --arg oid "$override_id" --arg olote "$override_lote" '
    .data.ingredientes[]
    | select(.es_decoracion == false)
    | {
        id: .id,
        peso_real: (.cantidad_kilos * 1000),
        lote: (if (.id|tostring) == $oid then $olote else (.lote_sugerido // "") end),
        lotes_consumo: (if (.id|tostring) == $oid then [{batch:$olote, cantidad_kg:.cantidad_kilos}] else (.lotes_consumo_sugerido // []) end)
      }
  ')
  if [ -z "$items" ]; then
    fallo "checklist de masa $masa_id vino vacío: $checklist"
    return 1
  fi
  local rc=0
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
psql_q "UPDATE sap_inventario_mp SET stock_almp = 500, ultimo_sync = NOW() WHERE stock_almp < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id IN ($MASA_ID_CONEXION, $MASA_ID_NEGOCIO));" > /dev/null
psql_q "UPDATE sap_lotes_mp SET cantidad_disponible = 500, ultimo_sync = NOW() WHERE cantidad_disponible < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id IN ($MASA_ID_CONEXION, $MASA_ID_NEGOCIO));" > /dev/null
ok "stock y lotes de prueba ajustados para las masas $MASA_ID_CONEXION y $MASA_ID_NEGOCIO"

echo ""
echo "===================================================="
echo "FASE A: confirmar pesaje con SAP inalcanzable (masa $MASA_ID_CONEXION)"
echo "===================================================="
completar_checklist "$MASA_ID_CONEXION"
COMPLETADO=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_ID_CONEXION/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO" = "true" ]; then ok "checklist de masa $MASA_ID_CONEXION completo"; else fallo "checklist de masa $MASA_ID_CONEXION incompleto tras marcar ingredientes"; fi

echo "-- bloqueando salida de red hacia SAP ($SAP_HOST -> $SAP_IP:$SAP_PORT) --"
sudo -n iptables -I OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset
IPTABLES_APPLIED=1
sleep 1
echo "evidencia de caída real:"
curl -s -o /dev/null -w '  curl a SAP -> exit code %{exitnum} (esperado: distinto de 0)\n' --max-time 5 -k "$SAP_URL_CFG/Login" 2>&1 || true

HTTP=$(curl -s -o /tmp/confirmar_conexion.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_ID_CONEXION/confirmar")
RESP=$(cat /tmp/confirmar_conexion.json)
echo "HTTP $HTTP :: $RESP"
if [ "$HTTP" = "200" ] && [ "$(echo "$RESP" | jq -r '.data.pendiente_sap')" = "true" ]; then
  ok "confirmar pesaje devolvió pendiente_sap=true con SAP caído"
else
  fallo "confirmar pesaje NO devolvió 200/pendiente_sap=true con SAP caído (HTTP $HTTP)"
fi

echo "-- restaurando conectividad a SAP --"
sudo -n iptables -D OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset
IPTABLES_APPLIED=0

echo "-- verificando estado en BD --"
FASE=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_ID_CONEXION;")
if [ "$FASE" = "AMASADO" ]; then ok "masa $MASA_ID_CONEXION avanzó a AMASADO"; else fallo "masa $MASA_ID_CONEXION NO avanzó a AMASADO (fase_actual=$FASE)"; fi

DOCENTRY=$(psql_q "SELECT COALESCE(sap_doc_entry_pesaje::text,'') FROM masas_produccion WHERE id=$MASA_ID_CONEXION;")
if [ -z "$DOCENTRY" ]; then ok "sap_doc_entry_pesaje sigue NULL (no se transmitió realmente)"; else fallo "sap_doc_entry_pesaje inesperadamente poblado: $DOCENTRY"; fi

PENDING_LOG_ID=$(psql_q "SELECT id FROM sap_sync_log WHERE masa_id=$MASA_ID_CONEXION AND estado='PENDING' AND tipo_operacion='GOODS_ISSUE_PESAJE' ORDER BY id DESC LIMIT 1;")
if [ -n "$PENDING_LOG_ID" ]; then
  ok "sap_sync_log PENDING creado con masa_id=$MASA_ID_CONEXION (id=$PENDING_LOG_ID) — migración 070 funcionando"
else
  fallo "no se encontró fila PENDING en sap_sync_log con masa_id=$MASA_ID_CONEXION"
fi

echo ""
echo "===================================================="
echo "FASE B: GET /api/pesaje/sap-pendientes"
echo "===================================================="
LIST_RESP=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/sap-pendientes")
echo "$LIST_RESP" | jq .
if [ -n "$PENDING_LOG_ID" ]; then
  FOUND=$(echo "$LIST_RESP" | jq --arg id "$PENDING_LOG_ID" '.data[] | select((.id|tostring)==$id)')
  if [ -n "$FOUND" ]; then
    CODIGO_MASA_LISTADO=$(echo "$FOUND" | jq -r '.codigo_masa')
    LOTE_LISTADO=$(echo "$FOUND" | jq -r '.lote_produccion')
    ok "sap-pendientes lista id $PENDING_LOG_ID con codigo_masa=$CODIGO_MASA_LISTADO, lote_produccion=$LOTE_LISTADO (join por masa_id OK)"
  else
    fallo "sap-pendientes NO listó el id $PENDING_LOG_ID"
  fi
fi

echo ""
echo "===================================================="
echo "FASE C: POST /api/pesaje/sap-pendientes/reenviar (SAP ya disponible)"
echo "===================================================="
if [ -n "$PENDING_LOG_ID" ]; then
  HTTP2=$(curl -s -o /tmp/reenviar_resp.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d "{\"ids\":[$PENDING_LOG_ID]}" "$API_URL/pesaje/sap-pendientes/reenviar")
  RESP2=$(cat /tmp/reenviar_resp.json)
  echo "HTTP $HTTP2 :: $RESP2"
  REENVIO_OK=$(echo "$RESP2" | jq --arg id "$PENDING_LOG_ID" -r '.data[] | select((.id|tostring)==$id) | .success')
  if [ "$HTTP2" = "200" ] && [ "$REENVIO_OK" = "true" ]; then
    ok "reenvío de pendiente exitoso"
  else
    fallo "reenvío de pendiente NO exitoso (HTTP $HTTP2, success=$REENVIO_OK): $RESP2"
  fi

  ESTADO_FINAL=$(psql_q "SELECT estado FROM sap_sync_log WHERE id=$PENDING_LOG_ID;")
  if [ "$ESTADO_FINAL" = "SUCCESS" ]; then ok "sap_sync_log id $PENDING_LOG_ID quedó SUCCESS"; else fallo "sap_sync_log id $PENDING_LOG_ID quedó en estado '$ESTADO_FINAL'"; fi

  DOCENTRY2=$(psql_q "SELECT COALESCE(sap_doc_entry_pesaje::text,'') FROM masas_produccion WHERE id=$MASA_ID_CONEXION;")
  if [ -n "$DOCENTRY2" ]; then ok "masa $MASA_ID_CONEXION quedó con sap_doc_entry_pesaje=$DOCENTRY2 tras reenvío"; else fallo "masa $MASA_ID_CONEXION sigue sin sap_doc_entry_pesaje tras reenvío exitoso"; fi

  LIST_RESP2=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/sap-pendientes")
  FOUND2=$(echo "$LIST_RESP2" | jq --arg id "$PENDING_LOG_ID" '.data[] | select((.id|tostring)==$id)')
  if [ -z "$FOUND2" ]; then ok "id $PENDING_LOG_ID ya no aparece en sap-pendientes tras reenvío exitoso"; else fallo "id $PENDING_LOG_ID sigue apareciendo en sap-pendientes tras reenvío exitoso"; fi
else
  fallo "se omitió FASE C: no hubo PENDING_LOG_ID de la FASE A"
fi

echo ""
echo "===================================================="
echo "FASE D: caso de negocio real — lote inexistente en SAP (masa $MASA_ID_NEGOCIO)"
echo "===================================================="
NEGOCIO_CHECKLIST=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_ID_NEGOCIO/checklist")
TARGET=$(echo "$NEGOCIO_CHECKLIST" | jq '[.data.ingredientes[] | select(.es_decoracion==false and .lote_sugerido != null)][0]')
FAKE_LOTE_ITEM=$(echo "$TARGET" | jq -r '.ingrediente_sap_code // empty')
FAKE_LOTE_ING_ID=$(echo "$TARGET" | jq -r '.id // empty')

if [ -z "$FAKE_LOTE_ITEM" ] || [ -z "$FAKE_LOTE_ING_ID" ]; then
  fallo "no se encontró un ingrediente con manejo de lote en masa $MASA_ID_NEGOCIO para forzar el rechazo de SAP"
else
  psql_q "INSERT INTO sap_lotes_mp (item_code, batch, cantidad_disponible, status, ultimo_sync) VALUES ('$FAKE_LOTE_ITEM','$FAKE_LOTE_BATCH', 999, 'released', NOW());" > /dev/null
  FAKE_LOTE_INSERTADO=1
  ok "lote ficticio $FAKE_LOTE_BATCH insertado en sap_lotes_mp para $FAKE_LOTE_ITEM (existe localmente, NO existe en SAP real)"

  completar_checklist "$MASA_ID_NEGOCIO" "$FAKE_LOTE_ING_ID" "$FAKE_LOTE_BATCH"

  HTTP3=$(curl -s -o /tmp/confirmar_negocio.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d '{}' "$API_URL/pesaje/$MASA_ID_NEGOCIO/confirmar")
  RESP3=$(cat /tmp/confirmar_negocio.json)
  echo "HTTP $HTTP3 :: $RESP3"
  if [ "$HTTP3" = "502" ]; then
    ok "caso de negocio (lote inexistente) sigue bloqueando con 502"
  else
    fallo "caso de negocio devolvió HTTP $HTTP3 en vez de 502: $RESP3"
  fi

  FASE_NEG=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_ID_NEGOCIO;")
  if [ "$FASE_NEG" = "PESAJE" ]; then ok "masa $MASA_ID_NEGOCIO permanece en PESAJE (bloqueada, sin cambios)"; else fallo "masa $MASA_ID_NEGOCIO avanzó de fase indebidamente: $FASE_NEG"; fi

  ERROR_LOG=$(psql_q "SELECT estado || '|' || COALESCE(masa_id::text,'') FROM sap_sync_log WHERE tipo_operacion='GOODS_ISSUE_PESAJE' AND estado='ERROR' ORDER BY id DESC LIMIT 1;")
  echo "Último log ERROR (estado|masa_id): $ERROR_LOG"
  if [ "$ERROR_LOG" = "ERROR|" ]; then
    ok "log ERROR de negocio sin masa_id — comportamiento sin cambios respecto a antes de la migración 070"
  else
    fallo "log ERROR con formato inesperado: '$ERROR_LOG'"
  fi
fi

echo ""
echo "===================================================="
if [ "$FALLOS" -eq 0 ]; then
  echo "TODOS LOS CHECKS PASARON"
  exit 0
else
  echo "$FALLOS CHECK(S) FALLARON"
  exit 1
fi
