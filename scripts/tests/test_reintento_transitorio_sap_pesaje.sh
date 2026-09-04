#!/bin/bash
# ============================================================================
# test_reintento_transitorio_sap_pesaje.sh
# Script de aceptación — resiliencia ante fallas TRANSITORIAS del Service
# Layer de SAP al confirmar pesaje (incidente masas 1139/1149, 2026-09-03).
#
# Verifica:
#   FASE A: falla de TRANSPORTE (SAP inalcanzable) -> confirmar pesaje
#           reintenta automáticamente (backoff 2s/5s) antes de fallar, y si
#           la conectividad se restaura durante el backoff, el pesaje
#           termina confirmándose con éxito (sin que el usuario reintente).
#   FASE B: falla de NEGOCIO (stock insuficiente) -> NUNCA se reintenta
#           automáticamente, falla de inmediato como antes.
#   FASE C: falla de TRANSPORTE persistente (SAP caído todo el tiempo) ->
#           tras agotar los reintentos, el mensaje final al usuario es claro
#           y accionable (no el error crudo de axios/socket).
#   FASE D: flujo normal exitoso (SAP disponible) sin regresión.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   bash scripts/tests/test_reintento_transitorio_sap_pesaje.sh <MASA_RETRY_OK> <MASA_STOCK> <MASA_TIMEOUT_PERSISTENTE> <MASA_NORMAL>
#
# Los 4 MASA_ID deben estar en fase PESAJE, estado APROBADA, sin confirmar.
# MASA_STOCK debe tener un ingrediente cuyo lote asignado NO tenga stock real
# suficiente en SAP (para forzar el error 10001153).
#
# Credenciales (CLAUDE.md): el script crea su propio usuario ADMIN de prueba
# con contraseña generada en runtime (nunca hardcodeada) siguiendo el mismo
# patrón que scripts/tests/user_hierarchy_and_full_regression.sh, y lo
# desactiva al terminar (trap), incluso si el script se interrumpe. No usa
# ni necesita la contraseña real de ningún usuario existente.
#
# Requiere: psql, curl, jq, dig, node (o nvm), `sudo -n iptables` sin password.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"
BACKEND_LOG="${BACKEND_LOG:-$REPO_ROOT/backend/logs/combined.log}"

MASA_RETRY_OK="${1:?Uso: $0 <MASA_RETRY_OK> <MASA_STOCK> <MASA_TIMEOUT_PERSISTENTE> <MASA_NORMAL>}"
MASA_STOCK="${2:?falta MASA_STOCK}"
MASA_TIMEOUT_PERSISTENTE="${3:?falta MASA_TIMEOUT_PERSISTENTE}"
MASA_NORMAL="${4:?falta MASA_NORMAL}"

FALLOS=0
IPTABLES_APPLIED=0
TEST_USER_ID=""

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
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"
}
psql_file() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -f "$1"
}
run_node() {
  if command -v node > /dev/null 2>&1; then node "$@"; else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

block_sap() {
  sudo -n iptables -I OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset
  IPTABLES_APPLIED=1
}
unblock_sap() {
  if [ "$IPTABLES_APPLIED" = "1" ]; then
    sudo -n iptables -D OUTPUT -d "$SAP_IP" -p tcp --dport "$SAP_PORT" -j REJECT --reject-with tcp-reset 2>/dev/null
    IPTABLES_APPLIED=0
  fi
}
cleanup() {
  unblock_sap
  if [ -n "$TEST_USER_ID" ]; then
    psql_q "UPDATE usuarios SET activo=false, username=username || '_DEACTIVATED' WHERE id=$TEST_USER_ID AND username NOT LIKE '%_DEACTIVATED';" > /dev/null 2>&1
    echo "[cleanup] usuario de prueba $TEST_USER_ID desactivado"
  fi
}
trap cleanup EXIT

echo "===================================================="
echo "PRECHECK: código de reintento presente en el controller"
echo "===================================================="
if grep -q "esFallaTransitoriaSap" "$REPO_ROOT/backend/src/controllers/pesaje.controller.js"; then
  ok "helper esFallaTransitoriaSap presente en pesaje.controller.js (deploy correcto)"
else
  fallo "esFallaTransitoriaSap NO está en pesaje.controller.js -- ¿se hizo deploy?"
  exit 1
fi

echo ""
echo "===================================================="
echo "SETUP: crear usuario ADMIN de prueba (password generada en runtime)"
echo "===================================================="
# Password sintética generada en el momento — nunca un literal en el archivo.
TEST_PASSWORD=$(run_node -e "
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%^&*';
let pw = '';
for (let i = 0; i < 16; i++) pw += chars[Math.floor(Math.random() * chars.length)];
console.log(pw);
")
if [ -z "$TEST_PASSWORD" ]; then
  echo "FALLO: no se pudo generar password de prueba (¿node disponible?)"
  exit 1
fi

TEST_HASH=$( (cd "$REPO_ROOT/backend" && printf '%s' "$TEST_PASSWORD" | run_node -e "
let pw = '';
process.stdin.on('data', d => pw += d);
process.stdin.on('end', () => { require('bcrypt').hash(pw, 12).then(h => console.log(h)); });
") )
if [ -z "$TEST_HASH" ]; then
  echo "FALLO: no se pudo hashear password de prueba (¿bcrypt disponible en backend?)"
  exit 1
fi

TEST_USERNAME="test_retry_sap_$$_${RANDOM}"
TMP_SQL=$(mktemp)
cat > "$TMP_SQL" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password)
VALUES ('$TEST_USERNAME', 'test.retry.sap.$$.${RANDOM}@artesa-staging-test.com', '$TEST_HASH', 'Usuario Prueba Reintento SAP', 'ADMIN', true, true, 0, NULL, false)
RETURNING id;
EOF
TEST_USER_ID=$(psql_file "$TMP_SQL")
rm -f "$TMP_SQL"
if [ -z "$TEST_USER_ID" ]; then
  fallo "no se pudo crear usuario de prueba"
  exit 1
fi
ok "usuario de prueba creado: $TEST_USERNAME (id $TEST_USER_ID, rol ADMIN, se desactiva al final)"

echo ""
echo "===================================================="
echo "LOGIN usuario de prueba"
echo "===================================================="
LOGIN_RESP=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}")
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // .data.token // empty')
if [ -z "$TOKEN" ]; then
  echo "$(echo "$LOGIN_RESP" | jq -c '{success, message}' 2>/dev/null || echo '<respuesta no-JSON omitida>')"
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

prep_stock_suficiente() {
  local masa_id="$1"
  psql_q "UPDATE sap_inventario_mp SET stock_almp = 500, ultimo_sync = NOW() WHERE stock_almp < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id = $masa_id);" > /dev/null
  psql_q "UPDATE sap_lotes_mp SET cantidad_disponible = 500, ultimo_sync = NOW() WHERE cantidad_disponible < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id = $masa_id);" > /dev/null
}

log_marker() { date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"; }

echo ""
echo "===================================================="
echo "FASE A: falla TRANSITORIA con recuperación durante el backoff -> debe terminar en éxito"
echo "===================================================="
prep_stock_suficiente "$MASA_RETRY_OK"
completar_checklist "$MASA_RETRY_OK"
COMPLETADO=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_RETRY_OK/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO" = "true" ]; then ok "checklist de masa $MASA_RETRY_OK completo"; else fallo "checklist de masa $MASA_RETRY_OK incompleto"; fi

MARK_A=$(log_marker)
echo "-- bloqueando SAP y reprogramando restauración en 4s (dentro del primer backoff de 2s, antes del segundo intento a los ~2s y del tercero a los ~7s) --"
block_sap
( sleep 4; unblock_sap ) &
UNBLOCK_PID=$!

T0=$(date +%s)
HTTP_A=$(curl -s -o /tmp/confirmar_retry_ok.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_RETRY_OK/confirmar")
T1=$(date +%s)
wait "$UNBLOCK_PID" 2>/dev/null
DUR_A=$((T1-T0))
RESP_A=$(cat /tmp/confirmar_retry_ok.json)
echo "HTTP $HTTP_A (duración ${DUR_A}s) :: $RESP_A"

if [ "$HTTP_A" = "200" ]; then
  ok "confirmar pesaje terminó en éxito pese al corte inicial (el reintento server-side recuperó la conexión)"
else
  fallo "confirmar pesaje NO terminó en éxito tras recuperar conectividad: HTTP $HTTP_A :: $RESP_A"
fi
if [ "$DUR_A" -ge 2 ]; then
  ok "la petición tardó ${DUR_A}s (consistente con al menos un reintento con backoff, no fue instantánea)"
else
  fallo "la petición tardó solo ${DUR_A}s -- no parece haber pasado por el backoff de reintento"
fi

echo "-- evidencia en logs del backend (reintento visible) --"
if [ -f "$BACKEND_LOG" ]; then
  EVIDENCIA_RETRY=$(awk -v d="$MARK_A" '$0 >= d' "$BACKEND_LOG" 2>/dev/null | grep "InventoryGenExits masa $MASA_RETRY_OK" | grep -i "reintentando")
  if [ -n "$EVIDENCIA_RETRY" ]; then
    ok "log muestra reintento automático:"
    echo "$EVIDENCIA_RETRY"
  else
    fallo "no se encontró línea de 'reintentando' en el log del backend para masa $MASA_RETRY_OK"
  fi
else
  echo "AVISO: no se encontró $BACKEND_LOG -- ajustar BACKEND_LOG= si el log vive en otra ruta/journalctl"
fi

FASE_A_FINAL=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_RETRY_OK;")
if [ "$FASE_A_FINAL" = "AMASADO" ]; then ok "masa $MASA_RETRY_OK avanzó a AMASADO"; else fallo "masa $MASA_RETRY_OK no avanzó (fase_actual=$FASE_A_FINAL)"; fi

echo ""
echo "===================================================="
echo "FASE B: falla de NEGOCIO (stock insuficiente) -> NUNCA debe reintentarse"
echo "===================================================="
completar_checklist "$MASA_STOCK"
COMPLETADO_B=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_STOCK/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO_B" = "true" ]; then ok "checklist de masa $MASA_STOCK completo"; else fallo "checklist de masa $MASA_STOCK incompleto"; fi

MARK_B=$(log_marker)
T0=$(date +%s)
HTTP_B=$(curl -s -o /tmp/confirmar_stock.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_STOCK/confirmar")
T1=$(date +%s)
DUR_B=$((T1-T0))
RESP_B=$(cat /tmp/confirmar_stock.json)
echo "HTTP $HTTP_B (duración ${DUR_B}s) :: $RESP_B"

if [ "$HTTP_B" = "502" ]; then ok "confirmar pesaje devolvió 502 por stock insuficiente"; else fallo "confirmar pesaje devolvió HTTP $HTTP_B en vez de 502"; fi
LOTE_FALLIDO_B=$(echo "$RESP_B" | jq -r '.data.lote_fallido.item_code // empty')
if [ -n "$LOTE_FALLIDO_B" ]; then ok "respuesta trae lote_fallido.item_code=$LOTE_FALLIDO_B (parseo de error de negocio intacto)"; else fallo "respuesta NO trae lote_fallido -- ¿la masa $MASA_STOCK realmente forzó stock insuficiente?"; fi
TRANSIENT_B=$(echo "$RESP_B" | jq -r '.data.transient')
if [ "$TRANSIENT_B" = "false" ]; then ok "data.transient=false (correctamente clasificado como error de negocio, no transitorio)"; else fallo "data.transient=$TRANSIENT_B (se esperaba false)"; fi
if [ "$DUR_B" -lt 2 ]; then ok "la petición fue rápida (${DUR_B}s) -- confirma que NO hubo reintento ante error de negocio"; else fallo "la petición tardó ${DUR_B}s -- ¿se reintentó indebidamente un error de negocio?"; fi

if [ -f "$BACKEND_LOG" ]; then
  REINTENTO_INDEBIDO=$(awk -v d="$MARK_B" '$0 >= d' "$BACKEND_LOG" 2>/dev/null | grep "InventoryGenExits masa $MASA_STOCK" | grep -i "reintentando")
  if [ -z "$REINTENTO_INDEBIDO" ]; then
    ok "log confirma: ninguna línea de 'reintentando' para el error de negocio de masa $MASA_STOCK"
  else
    fallo "el log muestra reintento para un error de NEGOCIO (no debería reintentarse): $REINTENTO_INDEBIDO"
  fi
fi

echo ""
echo "===================================================="
echo "FASE C: falla TRANSITORIA persistente (SAP caído todo el tiempo) -> mensaje final claro"
echo "===================================================="
completar_checklist "$MASA_TIMEOUT_PERSISTENTE"
COMPLETADO_C=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_TIMEOUT_PERSISTENTE/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO_C" = "true" ]; then ok "checklist de masa $MASA_TIMEOUT_PERSISTENTE completo"; else fallo "checklist de masa $MASA_TIMEOUT_PERSISTENTE incompleto"; fi

block_sap
T0=$(date +%s)
HTTP_C=$(curl -s -o /tmp/confirmar_persistente.json -w '%{http_code}' --max-time 60 -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_TIMEOUT_PERSISTENTE/confirmar")
T1=$(date +%s)
unblock_sap
DUR_C=$((T1-T0))
RESP_C=$(cat /tmp/confirmar_persistente.json)
echo "HTTP $HTTP_C (duración ${DUR_C}s) :: $RESP_C"

if [ "$HTTP_C" = "502" ]; then ok "confirmar pesaje devolvió 502 tras agotar reintentos"; else fallo "confirmar pesaje devolvió HTTP $HTTP_C en vez de 502"; fi
if [ "$DUR_C" -ge 7 ]; then ok "la petición tardó ${DUR_C}s (consistente con backoff 2s+5s agotado antes de fallar)"; else fallo "la petición tardó solo ${DUR_C}s -- no parece haber agotado el backoff completo"; fi
MSG_C=$(echo "$RESP_C" | jq -r '.message')
if echo "$MSG_C" | grep -qi "no respondió a tiempo"; then
  ok "mensaje final claro y accionable: \"$MSG_C\""
else
  fallo "mensaje final NO es el esperado (mensaje crudo filtrado al usuario): \"$MSG_C\""
fi
if echo "$MSG_C" | grep -qiE "ECONNRESET|ETIMEDOUT|failure when receiving data from the peer|socket hang up"; then
  fallo "el mensaje al usuario todavía expone texto técnico crudo de axios/socket"
else
  ok "el mensaje al usuario NO expone texto técnico crudo"
fi
TRANSIENT_C=$(echo "$RESP_C" | jq -r '.data.transient')
if [ "$TRANSIENT_C" = "true" ]; then ok "data.transient=true"; else fallo "data.transient=$TRANSIENT_C (se esperaba true)"; fi
REINTENTABLE_C=$(echo "$RESP_C" | jq -r '.data.reintentable')
if [ "$REINTENTABLE_C" = "true" ]; then ok "data.reintentable=true"; else fallo "data.reintentable=$REINTENTABLE_C (se esperaba true)"; fi

FASE_C_FINAL=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_TIMEOUT_PERSISTENTE;")
if [ "$FASE_C_FINAL" = "PESAJE" ]; then ok "masa $MASA_TIMEOUT_PERSISTENTE NO avanzó de fase (sigue en PESAJE, sin duplicados)"; else fallo "masa $MASA_TIMEOUT_PERSISTENTE avanzó inesperadamente a $FASE_C_FINAL"; fi

echo ""
echo "===================================================="
echo "FASE D: flujo normal exitoso (SAP disponible) -- sin regresión"
echo "===================================================="
prep_stock_suficiente "$MASA_NORMAL"
completar_checklist "$MASA_NORMAL"
COMPLETADO_D=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_NORMAL/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO_D" = "true" ]; then ok "checklist de masa $MASA_NORMAL completo"; else fallo "checklist de masa $MASA_NORMAL incompleto"; fi

T0=$(date +%s)
HTTP_D=$(curl -s -o /tmp/confirmar_normal.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_NORMAL/confirmar")
T1=$(date +%s)
DUR_D=$((T1-T0))
RESP_D=$(cat /tmp/confirmar_normal.json)
echo "HTTP $HTTP_D (duración ${DUR_D}s) :: $RESP_D"
if [ "$HTTP_D" = "200" ]; then ok "confirmar pesaje exitoso sin fallas de SAP (HTTP 200)"; else fallo "confirmar pesaje con SAP disponible dio HTTP $HTTP_D en vez de 200"; fi
if [ "$DUR_D" -lt 2 ]; then ok "la petición fue rápida (${DUR_D}s) -- sin retraso indebido cuando SAP responde bien a la primera"; else fallo "la petición tardó ${DUR_D}s -- posible retraso indebido en el camino feliz"; fi

FASE_D_FINAL=$(psql_q "SELECT fase_actual FROM masas_produccion WHERE id=$MASA_NORMAL;")
if [ "$FASE_D_FINAL" = "AMASADO" ]; then ok "masa $MASA_NORMAL avanzó a AMASADO tras confirmar con éxito"; else fallo "masa $MASA_NORMAL no avanzó (fase_actual=$FASE_D_FINAL)"; fi

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
