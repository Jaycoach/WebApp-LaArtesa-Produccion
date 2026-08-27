#!/bin/bash
# ============================================================================
# test_sap_pendiente_pesaje.sh
# Script de aceptación — feature "pesaje pendiente por desconexión SAP",
# ahora con: clasificación AUTENTICACION (tratada como CONEXION), cola
# agrupada por fecha de producción (GET/POST /api/pesaje/sap-pendientes) y
# reintento en lote por grupo. Reusa además, en la misma corrida, TODA la
# regresión de auth/sesiones/roles ya validada en tareas anteriores.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   ADMIN_USER=admin ADMIN_PASSWORD='...' \
#     bash scripts/tests/test_sap_pendiente_pesaje.sh \
#       <MASA_ID_CONEXION> <MASA_ID_NEGOCIO> <MASA_ID_AUTENTICACION>
#
# Las 3 masas deben estar en fase PESAJE, estado APROBADA, sin confirmar.
#
# Requiere: psql, curl, jq, dig, node, `sudo -n iptables` sin password,
# permiso para reiniciar pm2 (artesa-backend-staging) — se usa para simular
# AUTENTICACION corrompiendo temporalmente SAP_PASSWORD en .env, restaurado
# siempre al final (trap), incluso si el script se interrumpe.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"
PM2_NAME="${PM2_NAME:-artesa-backend-staging}"

MASA_ID_CONEXION="${1:?Uso: $0 <MASA_ID_CONEXION> <MASA_ID_NEGOCIO> <MASA_ID_AUTENTICACION>}"
MASA_ID_NEGOCIO="${2:?Uso: $0 <MASA_ID_CONEXION> <MASA_ID_NEGOCIO> <MASA_ID_AUTENTICACION>}"
MASA_ID_AUTENTICACION="${3:?Uso: $0 <MASA_ID_CONEXION> <MASA_ID_NEGOCIO> <MASA_ID_AUTENTICACION>}"
ADMIN_USER="${ADMIN_USER:?Definir ADMIN_USER}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Definir ADMIN_PASSWORD}"

FALLOS=0
IPTABLES_APPLIED=0
FAKE_LOTE_INSERTADO=0
FAKE_LOTE_ITEM=""
FAKE_LOTE_BATCH="BATCH-TEST-INEXISTENTE-$$"
SAP_PASSWORD_CORROMPIDA=0
SAP_PASSWORD_ORIGINAL=""

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
SAP_PASSWORD_ORIGINAL=$(grep -E '^SAP_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$SAP_IP" ]; then
  echo "FALLO: no se pudo resolver IP de $SAP_HOST"
  exit 1
fi

psql_q() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"
}

run_node() {
  if command -v node > /dev/null 2>&1; then node "$@"; else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

# PID actual del proceso pm2 (vacío si no se puede leer) — se usa para
# confirmar que un restart REALMENTE relanzó el proceso, en vez de confiar
# en un `sleep` fijo. Un `sleep 3` + healthcheck no es suficiente: el
# healthcheck puede responder desde el proceso VIEJO todavía vivo en su
# ventana de gracia antes de morir (confirmado con evidencia real — ver
# reporte de la tarea: un intento de simular AUTENTICACION dio un error de
# NEGOCIO real, señal de que el proceso seguía con la sesión SAP vieja).
pm2_pid() {
  run_node -e "
    const fs = require('fs');
    const os = require('os');
    const { execSync } = require('child_process');
    const out = execSync('pm2 jlist', { encoding: 'utf8' });
    const list = JSON.parse(out);
    const p = list.find(x => x.name === process.argv[1]);
    console.log(p ? p.pid : '');
  " "$PM2_NAME" 2>/dev/null
}

# Reinicia pm2 y espera hasta que el PID cambie de verdad (o timeout),
# además del healthcheck HTTP — evita la condición de carrera de arriba.
reiniciar_pm2_y_esperar() {
  local pid_anterior; pid_anterior=$(pm2_pid)
  (cd "$REPO_ROOT" && bash -c "source ~/.nvm/nvm.sh 2>/dev/null; NODE_ENV=staging pm2 restart $PM2_NAME --update-env" > /dev/null 2>&1)
  local intentos=0 pid_nuevo=""
  while [ $intentos -lt 20 ]; do
    sleep 1
    pid_nuevo=$(pm2_pid)
    if [ -n "$pid_nuevo" ] && [ "$pid_nuevo" != "$pid_anterior" ]; then
      break
    fi
    intentos=$((intentos + 1))
  done
  # Margen extra para que el proceso nuevo termine de bootear (conexión a
  # BD, etc.) antes de que el healthcheck del caller lo dé por bueno.
  sleep 2
  if [ -z "$pid_nuevo" ] || [ "$pid_nuevo" = "$pid_anterior" ]; then
    echo "  (advertencia: no se pudo confirmar que el PID cambió tras el restart — pid_anterior=$pid_anterior, pid_actual=$pid_nuevo)"
  else
    echo "  pm2 confirmado: pid $pid_anterior -> $pid_nuevo"
  fi
}

restaurar_sap_password() {
  if [ "$SAP_PASSWORD_CORROMPIDA" = "1" ]; then
    sed -i "s|^SAP_PASSWORD=.*|SAP_PASSWORD=${SAP_PASSWORD_ORIGINAL}|" "$ENV_FILE"
    reiniciar_pm2_y_esperar
    SAP_PASSWORD_CORROMPIDA=0
    echo "[cleanup] SAP_PASSWORD restaurada y $PM2_NAME reiniciado."
  fi
}

cleanup() {
  restaurar_sap_password
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
echo "PRECHECK: fuente única de clasificación (red de seguridad barata)"
echo "===================================================="
# El diagnóstico de la tarea de reubicación de UI confirmó que
# confirmarPesaje llama una sola vez a enviarInventoryGenExits, que a su
# vez invoca clasificarErrorSAP una sola vez -- pero clasificarErrorSAP
# COMO FUNCIÓN se invoca desde 2 lugares legítimos del archivo: el envío
# inicial (enviarInventoryGenExits) y el reintento (reenviarPendientesSAP).
# Son el MISMO código reutilizado, no dos implementaciones que puedan
# desalinearse -- por eso el valor esperado es 2, no 1 (la propuesta
# original de esta tarea asumía 1; se ajusta aquí con la evidencia real,
# ver reporte). Si en el futuro aparece un tercer call site, esta alarma
# debe sonar para que alguien confirme si es una reutilización legítima
# más o una bifurcación no intencional.
CLASIFICAR_COUNT=$(grep -c "clasificarErrorSAP(" "$REPO_ROOT/backend/src/controllers/pesaje.controller.js")
if [ "$CLASIFICAR_COUNT" = "2" ]; then
  ok "clasificarErrorSAP() se invoca 2 veces (envío inicial + reintento) — sin bifurcación nueva"
else
  fallo "clasificarErrorSAP() se invoca $CLASIFICAR_COUNT veces — se esperaban 2 (envío inicial + reintento); revisar si es una reutilización legítima o una fuente de verdad nueva sin anunciar"
fi

echo ""
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
    | (.cantidad_kilos | tonumber) as $kg
    | {
        id: .id,
        peso_real: ($kg * 1000),
        lote: (if (.id|tostring) == $oid then $olote else (.lote_sugerido // "") end),
        lotes_consumo: (if (.id|tostring) == $oid then [{batch:$olote, cantidad_kg:$kg}] else (.lotes_consumo_sugerido // []) end)
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
# Bug ya diagnosticado y reparado: el UPDATE de ultimo_sync estaba
# condicionado al MISMO WHERE cantidad_disponible < 500 que el bump de
# stock — un lote que YA tenía sobra de stock (por eso el bump no lo
# tocaba) se quedaba con su ultimo_sync real, que puede tener horas de
# antigüedad y disparar el bloqueo preexistente de "stock desactualizado"
# (pesaje_umbral_sync_lotes_horas, default 6h) ANTES de que el flujo
# intente siquiera contactar a SAP. El refresco de ultimo_sync ahora es
# INCONDICIONAL para todos los lotes de los ítems que estas 3 masas usan.
TODAS_LAS_MASAS="$MASA_ID_CONEXION, $MASA_ID_NEGOCIO, $MASA_ID_AUTENTICACION"
psql_q "UPDATE sap_inventario_mp SET stock_almp = 500 WHERE stock_almp < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id IN ($TODAS_LAS_MASAS));" > /dev/null
psql_q "UPDATE sap_inventario_mp SET ultimo_sync = NOW() WHERE item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id IN ($TODAS_LAS_MASAS));" > /dev/null
psql_q "UPDATE sap_lotes_mp SET cantidad_disponible = 500 WHERE cantidad_disponible < 500 AND item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id IN ($TODAS_LAS_MASAS));" > /dev/null
psql_q "UPDATE sap_lotes_mp SET ultimo_sync = NOW() WHERE item_code IN (SELECT DISTINCT ingrediente_sap_code FROM ingredientes_masa WHERE masa_id IN ($TODAS_LAS_MASAS));" > /dev/null
ok "stock y lotes de prueba ajustados para las masas $TODAS_LAS_MASAS (ultimo_sync refrescado para TODOS los lotes usados, no solo los de bajo stock)"

echo ""
echo "===================================================="
echo "FASE A: confirmar pesaje con SAP inalcanzable — CONEXION (masa $MASA_ID_CONEXION)"
echo "===================================================="
completar_checklist "$MASA_ID_CONEXION"
COMPLETADO=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_ID_CONEXION/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO" = "true" ]; then ok "checklist de masa $MASA_ID_CONEXION completo"; else fallo "checklist de masa $MASA_ID_CONEXION incompleto tras marcar ingredientes"; fi

FECHA_PRODUCCION_CONEXION=$(psql_q "SELECT fecha_produccion::text FROM masas_produccion WHERE id=$MASA_ID_CONEXION;")

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
  ok "confirmar pesaje devolvió pendiente_sap=true con SAP caído (CONEXION)"
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

PENDING_LOG_ID_CONEXION=$(psql_q "SELECT id FROM sap_sync_log WHERE masa_id=$MASA_ID_CONEXION AND estado='PENDING' AND tipo_operacion='GOODS_ISSUE_PESAJE' ORDER BY id DESC LIMIT 1;")
if [ -n "$PENDING_LOG_ID_CONEXION" ]; then
  ok "sap_sync_log PENDING creado con masa_id=$MASA_ID_CONEXION (id=$PENDING_LOG_ID_CONEXION)"
else
  fallo "no se encontró fila PENDING en sap_sync_log con masa_id=$MASA_ID_CONEXION"
fi

echo ""
echo "===================================================="
echo "FASE B: GET /api/pesaje/sap-pendientes — agrupado por fecha de producción"
echo "===================================================="
LIST_RESP=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/sap-pendientes")
echo "$LIST_RESP" | jq .
if [ -n "$PENDING_LOG_ID_CONEXION" ]; then
  GRUPO=$(echo "$LIST_RESP" | jq --arg id "$PENDING_LOG_ID_CONEXION" '.data[] | select(.masas[] .id == ($id|tonumber))')
  if [ -n "$GRUPO" ]; then
    FECHA_EN_GRUPO=$(echo "$GRUPO" | jq -r '.fecha_produccion')
    if [ "$FECHA_EN_GRUPO" = "$FECHA_PRODUCCION_CONEXION" ]; then
      ok "sap-pendientes agrupa el id $PENDING_LOG_ID_CONEXION bajo su fecha_produccion real ($FECHA_EN_GRUPO)"
    else
      fallo "el id $PENDING_LOG_ID_CONEXION apareció bajo fecha '$FECHA_EN_GRUPO', se esperaba '$FECHA_PRODUCCION_CONEXION'"
    fi
    MASA_EN_GRUPO=$(echo "$GRUPO" | jq --arg id "$PENDING_LOG_ID_CONEXION" '.masas[] | select((.id|tostring)==$id)')
    CODIGO_MASA_LISTADO=$(echo "$MASA_EN_GRUPO" | jq -r '.codigo_masa')
    ok "masa dentro del grupo trae codigo_masa=$CODIGO_MASA_LISTADO (join por masa_id OK)"
  else
    fallo "sap-pendientes (agrupado) NO listó el id $PENDING_LOG_ID_CONEXION en ningún grupo"
  fi
fi

echo ""
echo "===================================================="
echo "FASE C: caso de negocio real — lote inexistente en SAP (masa $MASA_ID_NEGOCIO)"
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
    ok "log ERROR de negocio sin masa_id — comportamiento sin cambios"
  else
    fallo "log ERROR con formato inesperado: '$ERROR_LOG'"
  fi

  LIST_RESP_NEGOCIO=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/sap-pendientes")
  APARECE_NEGOCIO=$(echo "$LIST_RESP_NEGOCIO" | jq --arg mid "$MASA_ID_NEGOCIO" '[.data[].masas[] | select((.masa_id|tostring)==$mid)] | length')
  if [ "$APARECE_NEGOCIO" = "0" ]; then
    ok "la masa de negocio ($MASA_ID_NEGOCIO) NO aparece en sap-pendientes (correcto — no es un caso reintentable)"
  else
    fallo "la masa de negocio ($MASA_ID_NEGOCIO) aparece en sap-pendientes — NO debería, es un rechazo de negocio"
  fi
fi

echo ""
echo "===================================================="
echo "FASE D: AUTENTICACION real — SAP_PASSWORD corrompida (masa $MASA_ID_AUTENTICACION)"
echo "===================================================="
completar_checklist "$MASA_ID_AUTENTICACION"
COMPLETADO_AUTH=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/$MASA_ID_AUTENTICACION/checklist" | jq -r '.data.completado')
if [ "$COMPLETADO_AUTH" = "true" ]; then ok "checklist de masa $MASA_ID_AUTENTICACION completo"; else fallo "checklist de masa $MASA_ID_AUTENTICACION incompleto"; fi

echo "-- corrompiendo SAP_PASSWORD y reiniciando $PM2_NAME (simula credenciales de integración inválidas) --"
sed -i "s|^SAP_PASSWORD=.*|SAP_PASSWORD=credencial-invalida-de-prueba-$$|" "$ENV_FILE"
SAP_PASSWORD_CORROMPIDA=1
reiniciar_pm2_y_esperar
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)
if [ "$HEALTH" != "200" ]; then
  fallo "el backend no respondió sano tras el reinicio con SAP_PASSWORD corrompida (health=$HEALTH)"
else
  ok "backend reiniciado y respondiendo (SAP_PASSWORD corrompida en este proceso)"
fi

HTTP4=$(curl -s -o /tmp/confirmar_auth.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' "$API_URL/pesaje/$MASA_ID_AUTENTICACION/confirmar")
RESP4=$(cat /tmp/confirmar_auth.json)
echo "HTTP $HTTP4 :: $RESP4"
if [ "$HTTP4" = "200" ] && [ "$(echo "$RESP4" | jq -r '.data.pendiente_sap')" = "true" ]; then
  ok "confirmar pesaje devolvió pendiente_sap=true con credenciales SAP inválidas (AUTENTICACION tratada como CONEXION)"
else
  fallo "confirmar pesaje NO devolvió 200/pendiente_sap=true con credenciales SAP inválidas (HTTP $HTTP4)"
fi

PENDING_LOG_ID_AUTH=$(psql_q "SELECT id FROM sap_sync_log WHERE masa_id=$MASA_ID_AUTENTICACION AND estado='PENDING' AND tipo_operacion='GOODS_ISSUE_PESAJE' ORDER BY id DESC LIMIT 1;")
if [ -n "$PENDING_LOG_ID_AUTH" ]; then
  ok "sap_sync_log PENDING creado con masa_id=$MASA_ID_AUTENTICACION (id=$PENDING_LOG_ID_AUTH)"
  ERROR_MSG_AUTH=$(psql_q "SELECT error_message FROM sap_sync_log WHERE id=$PENDING_LOG_ID_AUTH;")
  if echo "$ERROR_MSG_AUTH" | grep -qi "Error de autenticación SAP"; then
    ok "el error_message confirma que fue un fallo de LOGIN (autenticación), no de red: '$ERROR_MSG_AUTH'"
  else
    fallo "el error_message no tiene el prefijo esperado de autenticación: '$ERROR_MSG_AUTH'"
  fi
else
  fallo "no se encontró fila PENDING en sap_sync_log con masa_id=$MASA_ID_AUTENTICACION"
fi

echo "-- restaurando SAP_PASSWORD real y reiniciando $PM2_NAME --"
restaurar_sap_password
HEALTH2=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)
if [ "$HEALTH2" = "200" ]; then ok "backend saludable tras restaurar SAP_PASSWORD"; else fallo "backend no saludable tras restaurar SAP_PASSWORD (health=$HEALTH2)"; fi

echo ""
echo "===================================================="
echo "FASE E: reintento en LOTE por fecha de producción — deben limpiarse solas"
echo "===================================================="
if [ -n "$PENDING_LOG_ID_CONEXION" ] && [ -n "$PENDING_LOG_ID_AUTH" ]; then
  HTTP5=$(curl -s -o /tmp/reenviar_lote.json -w '%{http_code}' -X POST -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d '{"fecha_produccion":"todas"}' "$API_URL/pesaje/sap-pendientes/reenviar")
  RESP5=$(cat /tmp/reenviar_lote.json)
  echo "HTTP $HTTP5 :: $RESP5"
  if [ "$HTTP5" = "200" ]; then ok "reintento en lote (fecha_produccion=todas) respondió 200"; else fallo "reintento en lote respondió HTTP $HTTP5"; fi

  RESUMEN=$(echo "$RESP5" | jq -c '.resumen // empty')
  if [ -n "$RESUMEN" ]; then ok "respuesta incluye resumen: $RESUMEN"; else fallo "respuesta NO incluye un objeto 'resumen'"; fi

  EXITOSO_CONEXION=$(echo "$RESP5" | jq --arg id "$PENDING_LOG_ID_CONEXION" -r '.data[] | select((.id|tostring)==$id) | .success')
  EXITOSO_AUTH=$(echo "$RESP5" | jq --arg id "$PENDING_LOG_ID_AUTH" -r '.data[] | select((.id|tostring)==$id) | .success')
  if [ "$EXITOSO_CONEXION" = "true" ]; then ok "pendiente de CONEXION (id=$PENDING_LOG_ID_CONEXION) sincronizó en el reintento en lote"; else fallo "pendiente de CONEXION NO sincronizó en el reintento en lote (success=$EXITOSO_CONEXION)"; fi
  if [ "$EXITOSO_AUTH" = "true" ]; then ok "pendiente de AUTENTICACION (id=$PENDING_LOG_ID_AUTH) sincronizó en el reintento en lote (ya con credenciales restauradas)"; else fallo "pendiente de AUTENTICACION NO sincronizó en el reintento en lote (success=$EXITOSO_AUTH)"; fi

  for id_masa in "$MASA_ID_CONEXION:$PENDING_LOG_ID_CONEXION" "$MASA_ID_AUTENTICACION:$PENDING_LOG_ID_AUTH"; do
    masa_id="${id_masa%%:*}"; log_id="${id_masa##*:}"
    DOCENTRY_FINAL=$(psql_q "SELECT COALESCE(sap_doc_entry_pesaje::text,'') FROM masas_produccion WHERE id=$masa_id;")
    if [ -n "$DOCENTRY_FINAL" ]; then ok "masa $masa_id quedó con sap_doc_entry_pesaje=$DOCENTRY_FINAL tras el reintento en lote"; else fallo "masa $masa_id sigue sin sap_doc_entry_pesaje tras el reintento en lote"; fi
  done

  LIST_RESP_FINAL=$(curl -s -H "$AUTH_HEADER" "$API_URL/pesaje/sap-pendientes")
  QUEDAN=$(echo "$LIST_RESP_FINAL" | jq --arg c "$PENDING_LOG_ID_CONEXION" --arg a "$PENDING_LOG_ID_AUTH" \
    '[.data[].masas[] | select((.id|tostring)==$c or (.id|tostring)==$a)] | length')
  if [ "$QUEDAN" = "0" ]; then
    ok "ambas transmisiones se limpiaron solas de sap-pendientes tras sincronizar (auto-limpieza confirmada)"
  else
    fallo "$QUEDAN transmisión(es) que ya sincronizaron siguen apareciendo en sap-pendientes"
  fi
else
  fallo "se omitió FASE E: faltó PENDING_LOG_ID_CONEXION o PENDING_LOG_ID_AUTH de fases anteriores"
fi

echo ""
echo "############################################################"
echo "# REGRESIÓN COMPLETA: auth / sesiones / roles / trigger de auditoría"
echo "# (reusa scripts existentes — no se reescribe nada)"
echo "############################################################"
REGRESSION_SCRIPT="$REPO_ROOT/scripts/tests/test_session_replaced_guard.sh"
if [ -f "$REGRESSION_SCRIPT" ]; then
  if bash "$REGRESSION_SCRIPT"; then
    ok "regresión completa (sesión reemplazada + jerarquía + trigger auditoría + validación password): TODOS LOS CHECKS PASARON"
  else
    fallo "regresión completa FALLÓ — ver salida arriba"
  fi
else
  fallo "no se encontró $REGRESSION_SCRIPT — no se puede confirmar la regresión completa"
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
