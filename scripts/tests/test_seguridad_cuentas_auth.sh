#!/bin/bash
# ============================================================================
# test_seguridad_cuentas_auth.sh
# Script de aceptación — bloqueo de cuentas, cambio/reset de contraseña,
# trazabilidad de login, auditoría de seguridad y renovación de token.
#
# Origen: incidente del usuario compartido "pesaje" (6-oct-2026). Puntos:
#   1. contador de intentos se reinicia al vencer el bloqueo
#   2. changePassword / reset por token / reset admin: mismo comportamiento
#   3. login: ip_address + user_agent en usuarios_sesiones; log de fallos
#      con username + IP + motivo (sin contraseña)
#   4. auditoría en auditoria_cambios SIN hashes ni tokens
#   5. pantalla de usuarios (la parte API; la parte visual se verifica en
#      navegador real, ver reporte)
#   6. renovación automática de token (interceptor real, harness .mjs)
#
# Manejo de credenciales (CLAUDE.md / skill secrets-hygiene-in-tests):
#   - ninguna contraseña es literal: se generan en runtime leyendo las reglas
#     REALES de backend/src/validators/auth.validator.js
#   - los cuerpos HTTP se arman por entorno/stdin, nunca como argumento
#   - la salida se filtra con jq (solo success/message/errors)
#   - los hashes bcrypt solo viven en variables de shell; jamás se imprimen
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa), con el backend
# YA corriendo el código bajo prueba:
#   bash scripts/tests/test_seguridad_cuentas_auth.sh
#
# Requiere: psql, curl, jq, node, openssl/tr/fold/shuf. Crea y desactiva sus
# propios usuarios de prueba (no productivos). No toca producción.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
VALIDATOR_FILE="$REPO_ROOT/backend/src/validators/auth.validator.js"
API_URL="${API_URL:-http://localhost:3000/api}"
LOG_FILE="$REPO_ROOT/backend/logs/combined-$(date -u +%F).log"
SKIP_REGRESION="${SKIP_REGRESION:-0}"

FALLOS=0
fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }
seccion() { echo ""; echo "===================================================="; echo "$1"; echo "===================================================="; }
assert_eq() { # nombre actual esperado
  if [ "$2" = "$3" ]; then ok "$1 (= '$3')"; else fallo "$1: obtuvo '$2', esperaba '$3'"; fi
}

[ -f "$ENV_FILE" ] || { echo "FALLO: no se encontró $ENV_FILE"; exit 1; }
[ -f "$VALIDATOR_FILE" ] || { echo "FALLO: no se encontró $VALIDATOR_FILE"; exit 1; }

DB_HOST=$(grep -E '^DB_HOST='     "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep -E '^DB_PORT='     "$ENV_FILE" | cut -d= -f2-)
DB_NAME=$(grep -E '^DB_NAME='     "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep -E '^DB_USER='     "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

# Salvaguarda: este script SOLO corre contra staging.
if echo "$DB_NAME" | grep -qi 'prod' && ! echo "$DB_NAME" | grep -qi 'staging'; then
  echo "FALLO: DB_NAME='$DB_NAME' parece producción. Este script es solo para staging."; exit 1
fi

psql_q() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"; }
psql_tab() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -P pager=off -c "$1"; }
psql_file() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -f "$1"; }

run_node() {
  if command -v node > /dev/null 2>&1; then node "$@"; else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

# ---- reglas reales del validador (no se asume nada) ----
RULES=$(run_node -e "
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const idx = src.indexOf('changePasswordValidation');
const block = src.slice(idx, idx + 800);
const minM = block.match(/isLength\(\{\s*min:\s*(\d+)/);
const specM = block.match(/\(\?=\.\*\[([^\]]+)\]\)\[A-Za-z/);
if (!minM || !specM) { console.error('NO_MATCH'); process.exit(1); }
console.log(minM[1] + '|' + specM[1]);
" "$VALIDATOR_FILE")
[ -n "$RULES" ] || { echo "FALLO: no se pudieron extraer las reglas del validador"; exit 1; }
IFS='|' read -r MIN_LEN SPECIAL_CHARS <<< "$RULES"

rand_chars() { tr -dc "$2" < /dev/urandom | head -c "$1"; }
gen_valid_password() {
  local upper lower digit special n idx
  upper=$(rand_chars 3 'A-Z'); lower=$(rand_chars 4 'a-z'); digit=$(rand_chars 3 '0-9')
  n=${#SPECIAL_CHARS}; idx=$((RANDOM % n)); special="${SPECIAL_CHARS:$idx:1}"
  echo "${upper}${lower}${digit}${special}" | fold -w1 | shuf | tr -d '\n'
}
gen_password_generica() { rand_chars 16 'A-Za-z0-9'; }

hash_password() { # $1 = password, por stdin (no queda en `ps`)
  (cd "$REPO_ROOT/backend" && printf '%s' "$1" | run_node -e "
let pw = '';
process.stdin.on('data', d => pw += d);
process.stdin.on('end', () => { require('bcrypt').hash(pw, 12).then(h => console.log(h)); });
")
}

# ---- registro de contraseñas generadas, para el escaneo de fugas (sección D) ----
SECRETS_FILE=$(mktemp)
registrar_secreto() { printf '%s\n' "$1" >> "$SECRETS_FILE"; }

TEST_USER_IDS=()
RESP_FILE=$(mktemp)
cleanup() {
  for id in "${TEST_USER_IDS[@]:-}"; do
    [ -z "$id" ] && continue
    psql_q "UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username=username || '_DEACTIVATED' WHERE id=$id AND username NOT LIKE '%_DEACTIVATED';" > /dev/null 2>&1
  done
  echo "[cleanup] usuarios de prueba desactivados: ${TEST_USER_IDS[*]:-ninguno}"
  rm -f "$RESP_FILE" "$SECRETS_FILE"
}
trap cleanup EXIT

NEW_ID=""; NEW_NAME=""
crear_usuario() { # $1=rol $2=password -> setea NEW_ID / NEW_NAME (NO usar en subshell: registra para limpieza)
  local rol="$1" pw="$2" hash uname tmp id
  hash=$(hash_password "$pw")
  uname="test_seg_${rol,,}_$$_${RANDOM}"
  tmp=$(mktemp)
  cat > "$tmp" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password)
VALUES ('$uname', '$uname@artesa-staging-test.com', '$hash', 'Usuario Prueba Seguridad $rol', '$rol', true, true, 0, NULL, false)
RETURNING id;
EOF
  id=$(psql_file "$tmp"); rm -f "$tmp"
  TEST_USER_IDS+=("$id")
  NEW_ID="$id"; NEW_NAME="$uname"
}

# ---- HTTP ----
HTTP=""; BODY_JSON=""
call() { # METHOD PATH [TOKEN] [IP] [UA]  (cuerpo en $REQ_BODY, por stdin hacia curl)
  local m="$1" p="$2" tok="${3:-}" ip="${4:-198.51.100.1}" ua="${5:-acceptance-test/1.0}"
  local args=(-s -o "$RESP_FILE" -w '%{http_code}' -X "$m" "$API_URL$p" -H 'Content-Type: application/json' -H "X-Real-IP: $ip" -H "User-Agent: $ua")
  [ -n "$tok" ] && args+=(-H "Authorization: Bearer $tok")
  HTTP=$(printf '%s' "${REQ_BODY:-}" | curl "${args[@]}" --data-binary @-)
  BODY_JSON=$(cat "$RESP_FILE")
  REQ_BODY=""
}
msg() { echo "$BODY_JSON" | jq -r '.message // empty' 2>/dev/null; }
print_safe() { echo "$BODY_JSON" | jq -c '{success, message} + (if .errors then {errors: (.errors | map({field, message}))} else {} end)' 2>/dev/null || echo "<no-JSON omitido>"; }

login() { # username password ip [ua] -> deja HTTP, ACCESS, REFRESH
  REQ_BODY=$(U="$1" P="$2" jq -n '{username:env.U,password:env.P}')
  call POST /auth/login "" "${3:-198.51.100.1}" "${4:-acceptance-test/1.0}"
  ACCESS=$(echo "$BODY_JSON" | jq -r '.data.accessToken // empty' 2>/dev/null)
  REFRESH=$(echo "$BODY_JSON" | jq -r '.data.refreshToken // empty' 2>/dev/null)
}
nuevo_login() { sleep 1.1; login "$@"; } # evita colisión de refresh JWT (mismo iat) al loguear seguido

estado() { # id -> intentos|bloqueado(Y/N)|ultimo_cambio epoch
  psql_q "SELECT intentos_fallidos, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()), COALESCE(bloqueado_hasta IS NULL,false), EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$1;"
}
intentos() { psql_q "SELECT intentos_fallidos FROM usuarios WHERE id=$1;"; }
bloqueado_null() { psql_q "SELECT bloqueado_hasta IS NULL FROM usuarios WHERE id=$1;"; }
sesiones_activas() { psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$1 AND revocado=false;"; }
sesiones_total() { psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$1;"; }
historial_count() { psql_q "SELECT count(*) FROM usuarios_historial_passwords WHERE usuario_id=$1;"; }
# Con la SESIÓN ÚNICA un segundo login del mismo usuario cierra el primero, así que las "otras estaciones"
# con sesión viva se simulan insertando filas en usuarios_sesiones (refresh token aleatorio, sin JWT real).
# Los asserts de conteo de sesiones de las secciones 2 y 2e se mantienen idénticos.
insertar_sesiones_extra() { # usuario_id n
  local i
  for i in $(seq 1 "$2"); do
    psql_q "INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at, ip_address, user_agent) VALUES ($1, '$(rand_chars 48 'A-Za-z0-9')', NOW() + INTERVAL '7 days', '198.51.100.$((140+i))', 'estacion-extra-$i/1.0');" > /dev/null
  done
}
audit_count() { # usuario_id motivo_prefijo
  psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$1 AND motivo LIKE '$2%';"
}

echo "===================================================="
echo "PRECHECK: backend alcanzable y reglas del validador"
echo "===================================================="
HC=$(curl -s -o /dev/null -w '%{http_code}' "${API_URL%/api}/health" 2>/dev/null || echo 000)
[ "$HC" = "200" ] && ok "backend responde en $API_URL (health=$HC)" || { fallo "backend NO responde (health=$HC) en $API_URL"; exit 1; }
ok "reglas leídas del validador real: longitud mínima=$MIN_LEN, especiales='$SPECIAL_CHARS'"
CFG=$(cd "$REPO_ROOT/backend" && run_node -e "const c=require('./src/config'); console.log(c.security.maxLoginAttempts+'|'+c.security.lockoutDuration)")
assert_eq "config efectiva maxLoginAttempts|lockoutDuration(min) (valores efectivos NO cambian)" "$CFG" "5|30"

# ---------------------------------------------------------------------------
# Usuarios de prueba
# ---------------------------------------------------------------------------
PW_U1=$(gen_valid_password); registrar_secreto "$PW_U1"
crear_usuario OPERARIO "$PW_U1"; U1="$NEW_ID"; U1_NAME="$NEW_NAME"
PW_ADM=$(gen_valid_password); registrar_secreto "$PW_ADM"
crear_usuario ADMIN "$PW_ADM"; ADM="$NEW_ID"; ADM_NAME="$NEW_NAME"
ok "usuarios de prueba creados: U1=$U1 ($U1_NAME), ADMIN=$ADM ($ADM_NAME)"

# ===========================================================================
seccion "PUNTO 1 — el contador se reinicia al vencer el bloqueo"
# ===========================================================================
echo "-- 1a) 5 contraseñas incorrectas => bloqueado"
for i in 1 2 3 4 5; do
  W=$(gen_password_generica)
  login "$U1_NAME" "$W" 203.0.113.11
  [ "$HTTP" = "400" ] && [ "$(msg)" = "Credenciales inválidas" ] || fallo "intento $i: HTTP $HTTP :: $(print_safe)"
done
assert_eq "intentos_fallidos tras 5 fallos" "$(intentos "$U1")" "5"
assert_eq "bloqueado_hasta en el futuro (bloqueado)" "$(psql_q "SELECT bloqueado_hasta > NOW() FROM usuarios WHERE id=$U1;")" "t"
MIN_BLOQ=$(psql_q "SELECT round(EXTRACT(EPOCH FROM (bloqueado_hasta - NOW()))/60) FROM usuarios WHERE id=$U1;")
assert_eq "duración del bloqueo efectiva (min, sin cambios)" "$MIN_BLOQ" "30"
login "$U1_NAME" "$PW_U1" 203.0.113.11
echo "login correcto estando bloqueado => HTTP $HTTP :: $(print_safe)"
if [ "$HTTP" = "400" ] && [[ "$(msg)" == "Cuenta bloqueada hasta"* ]]; then ok "login bloqueado sigue rechazado con el mensaje original"; else fallo "esperaba 400 'Cuenta bloqueada hasta…'"; fi
assert_eq "intentos_fallidos NO crece mientras está bloqueado" "$(intentos "$U1")" "5"

echo ""
echo "-- 1b) bloqueo vencido + contador en 5: UN fallo => intentos=1 y SIN bloqueo"
echo "SELECT previo al UPDATE controlado:"
psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado FROM usuarios WHERE id=$U1;"
psql_q "UPDATE usuarios SET bloqueado_hasta = NOW() - INTERVAL '1 minute', intentos_fallidos = 5 WHERE id=$U1;" > /dev/null
echo "Estado tras el UPDATE controlado (bloqueo vencido, intentos=5):"
psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado FROM usuarios WHERE id=$U1;"
login "$U1_NAME" "$(gen_password_generica)" 203.0.113.12
echo "un solo fallo => HTTP $HTTP :: $(print_safe)"
echo "Estado tras UN fallo:"
psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta IS NULL AS sin_bloqueo FROM usuarios WHERE id=$U1;"
assert_eq "intentos_fallidos tras 1 fallo post-vencimiento" "$(intentos "$U1")" "1"
assert_eq "bloqueado_hasta es NULL (sin re-bloqueo)" "$(bloqueado_null "$U1")" "t"
assert_eq "el mensaje visible sigue siendo el de siempre" "$(msg)" "Credenciales inválidas"

echo ""
echo "-- 1c) login correcto deja el contador en 0"
login "$U1_NAME" "$(gen_password_generica)" 203.0.113.12  # intentos=2
assert_eq "intentos_fallidos antes del login correcto" "$(intentos "$U1")" "2"
login "$U1_NAME" "$PW_U1" 203.0.113.12
assert_eq "login correcto => HTTP" "$HTTP" "200"
assert_eq "intentos_fallidos tras login correcto" "$(intentos "$U1")" "0"

echo ""
echo "-- 1d) bloqueo vencido + contraseña CORRECTA => entra y queda en 0/NULL"
psql_q "UPDATE usuarios SET bloqueado_hasta = NOW() - INTERVAL '1 minute', intentos_fallidos = 9 WHERE id=$U1;" > /dev/null
nuevo_login "$U1_NAME" "$PW_U1" 203.0.113.12
assert_eq "login correcto con bloqueo vencido y 9 intentos acumulados => HTTP" "$HTTP" "200"
assert_eq "intentos_fallidos" "$(intentos "$U1")" "0"
assert_eq "bloqueado_hasta NULL" "$(bloqueado_null "$U1")" "t"

echo ""
echo "-- 1e) umbral sin cambios: 4 fallos NO bloquean, el 5º sí (sin bloqueo previo)"
for i in 1 2 3 4; do login "$U1_NAME" "$(gen_password_generica)" 203.0.113.13; done
assert_eq "intentos tras 4 fallos" "$(intentos "$U1")" "4"
assert_eq "NO bloqueado tras 4 fallos" "$(psql_q "SELECT bloqueado_hasta IS NULL FROM usuarios WHERE id=$U1;")" "t"
login "$U1_NAME" "$(gen_password_generica)" 203.0.113.13
assert_eq "bloqueado tras el 5º fallo" "$(psql_q "SELECT bloqueado_hasta > NOW() FROM usuarios WHERE id=$U1;")" "t"

# ===========================================================================
seccion "PUNTO 3 — trazabilidad de login (sesión con IP/UA, log de fallos)"
# ===========================================================================
psql_q "UPDATE usuarios SET bloqueado_hasta=NULL, intentos_fallidos=0 WHERE id=$U1;" > /dev/null
UA_TEST="acceptance-test/1.0 (seguridad; $$)"
nuevo_login "$U1_NAME" "$PW_U1" 198.51.100.23 "$UA_TEST"
assert_eq "login exitoso => HTTP" "$HTTP" "200"
echo "Última fila de usuarios_sesiones del usuario (evidencia, sin refresh_token):"
psql_tab "SELECT id, usuario_id, ip_address, user_agent, revocado, created_at FROM usuarios_sesiones WHERE usuario_id=$U1 ORDER BY id DESC LIMIT 1;"
assert_eq "ip_address poblada (login)" "$(psql_q "SELECT host(ip_address) FROM usuarios_sesiones WHERE usuario_id=$U1 ORDER BY id DESC LIMIT 1;")" "198.51.100.23"
assert_eq "user_agent poblado (login)" "$(psql_q "SELECT user_agent FROM usuarios_sesiones WHERE usuario_id=$U1 ORDER BY id DESC LIMIT 1;")" "$UA_TEST"

sleep 1.1
REQ_BODY=$(R="$REFRESH" jq -n '{refreshToken:env.R}')
call POST /auth/refresh "" 198.51.100.24 "$UA_TEST"
assert_eq "refresh => HTTP" "$HTTP" "200"
assert_eq "ip_address poblada en la sesión rotada por /auth/refresh" "$(psql_q "SELECT host(ip_address) FROM usuarios_sesiones WHERE usuario_id=$U1 ORDER BY id DESC LIMIT 1;")" "198.51.100.24"

echo ""
echo "-- 3b) log de fallos: username + IP + motivo, sin contraseña"
NOEXISTE="noexiste_$$_${RANDOM}"
PW_LOG=$(gen_password_generica); registrar_secreto "$PW_LOG"
login "$NOEXISTE" "$PW_LOG" 198.51.100.31
assert_eq "usuario inexistente => mensaje visible sin cambios" "$(msg)" "Credenciales inválidas"
login "$U1_NAME" "$PW_LOG" 198.51.100.32
psql_q "UPDATE usuarios SET bloqueado_hasta = NOW() + INTERVAL '10 minutes', intentos_fallidos = 5 WHERE id=$U1;" > /dev/null
login "$U1_NAME" "$PW_U1" 198.51.100.33
sleep 2
# El log es JSON (las comillas del username salen escapadas), así que se busca por fragmentos fijos.
log_linea() { tail -n 5000 "$LOG_FILE" 2>/dev/null | grep -F -- 'Login fallido username=' | grep -F -- "$1" | grep -F -- "$2" | grep -F -- "$3" | head -1; }
echo "Líneas de log de fallos de login (evidencia):"
for caso in "$NOEXISTE|198.51.100.31|usuario_inexistente" "$U1_NAME|198.51.100.32|password_incorrecta" "$U1_NAME|198.51.100.33|cuenta_bloqueada"; do
  IFS='|' read -r un ip mo <<< "$caso"
  L=$(log_linea "$un" "ip=$ip" "motivo=$mo")
  if [ -n "$L" ]; then ok "log con username, IP y motivo=$mo"; echo "    ${L:0:220}"; else fallo "NO hay línea de log para username=$un ip=$ip motivo=$mo"; fi
done
if [ -f "$LOG_FILE" ]; then
  FUGAS=$(grep -c -F -f "$SECRETS_FILE" "$LOG_FILE" 2>/dev/null || true)
  assert_eq "ninguna contraseña generada por este script aparece en el log de hoy" "${FUGAS:-0}" "0"
else
  fallo "no existe $LOG_FILE"
fi
psql_q "UPDATE usuarios SET bloqueado_hasta=NULL, intentos_fallidos=0 WHERE id=$U1;" > /dev/null

# ===========================================================================
seccion "PUNTO 2 — changePassword / reset por token / reset admin: comportamiento unificado"
# ===========================================================================
# Prepara un usuario con 3 sesiones y estado "sucio" (intentos + bloqueo vencido)
preparar_usuario_con_sesiones() { # rol pw -> setea P_ID P_NAME P_PW S1_ACCESS S1_REFRESH
  P_PW="$2"; registrar_secreto "$P_PW"
  crear_usuario "$1" "$P_PW"; P_ID="$NEW_ID"; P_NAME="$NEW_NAME"
  nuevo_login "$P_NAME" "$P_PW" 198.51.100.41; S1_ACCESS="$ACCESS"; S1_REFRESH="$REFRESH"
  insertar_sesiones_extra "$P_ID" 2   # otras 2 estaciones con sesión viva (3 en total, como antes)
}

echo "-- 2a) changePassword CON refreshToken de la sesión actual => se conserva esa sesión, el resto se revoca"
# (cambio voluntario de contraseña: SOLO ADMIN; el cambio obligatorio de los demás roles va por /auth/set-initial-password)
preparar_usuario_con_sesiones ADMIN "$(gen_valid_password)"; C1="$P_ID"; C1_NAME="$P_NAME"; C1_PW="$P_PW"
psql_q "UPDATE usuarios SET intentos_fallidos=5, bloqueado_hasta = NOW() - INTERVAL '1 minute', ultimo_cambio_password = NOW() - INTERVAL '1 day' WHERE id=$C1;" > /dev/null
HASH_ANTES=$(psql_q "SELECT password_hash FROM usuarios WHERE id=$C1;")
CAMBIO_ANTES=$(psql_q "SELECT EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$C1;")
echo "ANTES:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta IS NULL AS sin_bloqueo, ultimo_cambio_password, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=u.id AND NOT s.revocado) AS sesiones_activas, (SELECT count(*) FROM usuarios_historial_passwords h WHERE h.usuario_id=u.id) AS historial FROM usuarios u WHERE id=$C1;"
NEW_C1=$(gen_valid_password); registrar_secreto "$NEW_C1"
REQ_BODY=$(C="$C1_PW" N="$NEW_C1" R="$S1_REFRESH" jq -n '{currentPassword:env.C,newPassword:env.N,refreshToken:env.R}')
call POST /auth/change-password "$S1_ACCESS" 198.51.100.41 "$UA_TEST"
echo "change-password => HTTP $HTTP :: $(print_safe)"
assert_eq "HTTP change-password" "$HTTP" "200"
echo "DESPUÉS:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta IS NULL AS sin_bloqueo, ultimo_cambio_password, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=u.id AND NOT s.revocado) AS sesiones_activas, (SELECT count(*) FROM usuarios_historial_passwords h WHERE h.usuario_id=u.id) AS historial FROM usuarios u WHERE id=$C1;"
assert_eq "intentos_fallidos" "$(intentos "$C1")" "0"
assert_eq "bloqueado_hasta NULL" "$(bloqueado_null "$C1")" "t"
CAMBIO_DESP=$(psql_q "SELECT EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$C1;")
[ "$CAMBIO_DESP" -gt "$CAMBIO_ANTES" ] && ok "ultimo_cambio_password actualizado" || fallo "ultimo_cambio_password NO se actualizó"
assert_eq "sesiones activas (solo la actual)" "$(sesiones_activas "$C1")" "1"
assert_eq "la sesión conservada ES la del refreshToken enviado" "$(psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$C1 AND revocado=false AND refresh_token='$S1_REFRESH';")" "1"
assert_eq "historial: 1 fila" "$(historial_count "$C1")" "1"
assert_eq "el historial guarda el hash ANTERIOR (comparación en SQL, sin imprimir)" "$(psql_q "SELECT count(*) FROM usuarios_historial_passwords WHERE usuario_id=$C1 AND password_hash='$HASH_ANTES';")" "1"
nuevo_login "$C1_NAME" "$NEW_C1" 198.51.100.44; assert_eq "login con la contraseña NUEVA" "$HTTP" "200"
login "$C1_NAME" "$C1_PW" 198.51.100.44;       assert_eq "login con la contraseña ANTERIOR es rechazado" "$HTTP" "400"

echo ""
echo "-- 2b) changePassword SIN refreshToken (o con uno ajeno) => se revocan TODAS las sesiones"
preparar_usuario_con_sesiones ADMIN "$(gen_valid_password)"; C2="$P_ID"; C2_NAME="$P_NAME"; C2_PW="$P_PW"; C2_ACCESS="$S1_ACCESS"
assert_eq "sesiones activas antes" "$(sesiones_activas "$C2")" "3"
NEW_C2=$(gen_valid_password); registrar_secreto "$NEW_C2"
REQ_BODY=$(C="$C2_PW" N="$NEW_C2" R="refresh-ajeno-inexistente" jq -n '{currentPassword:env.C,newPassword:env.N,refreshToken:env.R}')
call POST /auth/change-password "$C2_ACCESS" 198.51.100.45
assert_eq "HTTP change-password (refreshToken que no es de este usuario)" "$HTTP" "200"
assert_eq "sesiones activas después (todas revocadas)" "$(sesiones_activas "$C2")" "0"

echo ""
echo "-- 2c) reset por token de recuperación"
preparar_usuario_con_sesiones OPERARIO "$(gen_valid_password)"; C3="$P_ID"; C3_NAME="$P_NAME"
RAW_TOKEN=$(rand_chars 48 'a-f0-9'); registrar_secreto "$RAW_TOKEN"
TOK_HASH=$(printf '%s' "$RAW_TOKEN" | sha256sum | cut -d' ' -f1)
psql_q "UPDATE usuarios SET token_recuperacion='$TOK_HASH', token_recuperacion_expira=NOW()+INTERVAL '1 hour', intentos_fallidos=5, bloqueado_hasta=NOW()+INTERVAL '20 minutes', ultimo_cambio_password = NOW() - INTERVAL '1 day' WHERE id=$C3;" > /dev/null
HASH_ANTES3=$(psql_q "SELECT password_hash FROM usuarios WHERE id=$C3;")
CAMBIO_ANTES3=$(psql_q "SELECT EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$C3;")
echo "ANTES:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=u.id AND NOT s.revocado) AS sesiones_activas FROM usuarios u WHERE id=$C3;"
NEW_C3=$(gen_valid_password); registrar_secreto "$NEW_C3"
REQ_BODY=$(T="$RAW_TOKEN" N="$NEW_C3" jq -n '{resetToken:env.T,newPassword:env.N}')
call POST /auth/reset-password "" 198.51.100.46
echo "reset-password => HTTP $HTTP :: $(print_safe)"
assert_eq "HTTP reset-password" "$HTTP" "200"
echo "DESPUÉS:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta IS NULL AS sin_bloqueo, ultimo_cambio_password, (token_recuperacion IS NULL) AS token_limpio, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=u.id AND NOT s.revocado) AS sesiones_activas, (SELECT count(*) FROM usuarios_historial_passwords h WHERE h.usuario_id=u.id) AS historial FROM usuarios u WHERE id=$C3;"
assert_eq "intentos_fallidos" "$(intentos "$C3")" "0"
assert_eq "bloqueado_hasta NULL" "$(bloqueado_null "$C3")" "t"
CAMBIO_DESP3=$(psql_q "SELECT EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$C3;")
[ "$CAMBIO_DESP3" -gt "$CAMBIO_ANTES3" ] && ok "ultimo_cambio_password actualizado" || fallo "ultimo_cambio_password NO se actualizó"
assert_eq "sesiones activas (todas revocadas)" "$(sesiones_activas "$C3")" "0"
assert_eq "historial guarda el hash anterior" "$(psql_q "SELECT count(*) FROM usuarios_historial_passwords WHERE usuario_id=$C3 AND password_hash='$HASH_ANTES3';")" "1"
assert_eq "token_recuperacion limpiado" "$(psql_q "SELECT token_recuperacion IS NULL FROM usuarios WHERE id=$C3;")" "t"

echo ""
echo "-- 2d) reset por administrador"
preparar_usuario_con_sesiones OPERARIO "$(gen_valid_password)"; C4="$P_ID"; C4_NAME="$P_NAME"
psql_q "UPDATE usuarios SET intentos_fallidos=5, bloqueado_hasta=NOW()+INTERVAL '20 minutes', ultimo_cambio_password = NOW() - INTERVAL '1 day' WHERE id=$C4;" > /dev/null
HASH_ANTES4=$(psql_q "SELECT password_hash FROM usuarios WHERE id=$C4;")
CAMBIO_ANTES4=$(psql_q "SELECT EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$C4;")
nuevo_login "$ADM_NAME" "$PW_ADM" 198.51.100.50; ADM_ACCESS="$ACCESS"
[ -n "$ADM_ACCESS" ] || fallo "no se pudo loguear el ADMIN de prueba"
echo "ANTES:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=u.id AND NOT s.revocado) AS sesiones_activas FROM usuarios u WHERE id=$C4;"
NEW_C4=$(gen_valid_password); registrar_secreto "$NEW_C4"
REQ_BODY=$(N="$NEW_C4" jq -n '{newPassword:env.N}')
call POST "/users/$C4/reset-password" "$ADM_ACCESS" 198.51.100.50
echo "admin reset-password => HTTP $HTTP :: $(print_safe)"
assert_eq "HTTP admin reset-password" "$HTTP" "200"
echo "DESPUÉS:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta IS NULL AS sin_bloqueo, ultimo_cambio_password, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=u.id AND NOT s.revocado) AS sesiones_activas, (SELECT count(*) FROM usuarios_historial_passwords h WHERE h.usuario_id=u.id) AS historial FROM usuarios u WHERE id=$C4;"
assert_eq "intentos_fallidos" "$(intentos "$C4")" "0"
assert_eq "bloqueado_hasta NULL" "$(bloqueado_null "$C4")" "t"
CAMBIO_DESP4=$(psql_q "SELECT EXTRACT(EPOCH FROM ultimo_cambio_password)::bigint FROM usuarios WHERE id=$C4;")
[ "$CAMBIO_DESP4" -gt "$CAMBIO_ANTES4" ] && ok "ultimo_cambio_password actualizado (antes el reset admin NO lo hacía)" || fallo "ultimo_cambio_password NO se actualizó"
assert_eq "sesiones activas (todas revocadas)" "$(sesiones_activas "$C4")" "0"
assert_eq "historial guarda el hash anterior" "$(psql_q "SELECT count(*) FROM usuarios_historial_passwords WHERE usuario_id=$C4 AND password_hash='$HASH_ANTES4';")" "1"
nuevo_login "$C4_NAME" "$NEW_C4" 198.51.100.51; assert_eq "el usuario entra con la contraseña puesta por el admin" "$HTTP" "200"

echo ""
echo "-- 2e) NEGATIVOS: nada cambia si la operación falla o no está permitida"
preparar_usuario_con_sesiones ADMIN "$(gen_valid_password)"; N1="$P_ID"; N1_NAME="$P_NAME"; N1_PW="$P_PW"; N1_ACCESS="$S1_ACCESS"
psql_q "UPDATE usuarios SET intentos_fallidos=2 WHERE id=$N1;" > /dev/null
AUD_ANTES=$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$N1;")
REQ_BODY=$(C="$(gen_password_generica)" N="$(gen_valid_password)" jq -n '{currentPassword:env.C,newPassword:env.N}')
call POST /auth/change-password "$N1_ACCESS" 198.51.100.60
assert_eq "clave actual incorrecta => HTTP" "$HTTP" "400"
assert_eq "clave actual incorrecta => mensaje sin cambios" "$(msg)" "Contraseña actual incorrecta"
assert_eq "intentos_fallidos intacto" "$(intentos "$N1")" "2"
assert_eq "sesiones intactas" "$(sesiones_activas "$N1")" "3"
assert_eq "sin fila de historial" "$(historial_count "$N1")" "0"
assert_eq "sin fila de auditoría nueva" "$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$N1;")" "$AUD_ANTES"
# rol sin permiso: un OPERARIO intenta reset admin sobre otro usuario y cambiar SU contraseña
PW_N0=$(gen_valid_password); registrar_secreto "$PW_N0"; crear_usuario OPERARIO "$PW_N0"; N0="$NEW_ID"; N0_NAME="$NEW_NAME"
nuevo_login "$N0_NAME" "$PW_N0" 198.51.100.63; N0_ACCESS="$ACCESS"
REQ_BODY=$(N="$(gen_valid_password)" jq -n '{newPassword:env.N}')
call POST "/users/$C1/reset-password" "$N0_ACCESS" 198.51.100.61
assert_eq "OPERARIO intenta reset admin => HTTP" "$HTTP" "403"
assert_eq "no se creó auditoría de reset para el objetivo" "$(audit_count "$C1" RESET_PASSWORD_ADMIN)" "0"
HASH_N0=$(psql_q "SELECT md5(password_hash) FROM usuarios WHERE id=$N0;")
REQ_BODY=$(C="$PW_N0" N="$(gen_valid_password)" jq -n '{currentPassword:env.C,newPassword:env.N}')
call POST /auth/change-password "$N0_ACCESS" 198.51.100.64
assert_eq "OPERARIO intenta cambiar su contraseña (solo ADMIN) => HTTP" "$HTTP" "403"
assert_eq "la contraseña del OPERARIO no cambió" "$(psql_q "SELECT md5(password_hash) FROM usuarios WHERE id=$N0;")" "$HASH_N0"
# nueva contraseña que incumple la regla real
SIN_ESPECIAL=$(rand_chars 12 'A-Za-z0-9')
REQ_BODY=$(C="$N1_PW" N="$SIN_ESPECIAL" jq -n '{currentPassword:env.C,newPassword:env.N}')
call POST /auth/change-password "$N1_ACCESS" 198.51.100.62
assert_eq "nueva contraseña inválida => HTTP" "$HTTP" "400"
assert_eq "sesiones siguen intactas tras validación fallida" "$(sesiones_activas "$N1")" "3"

# ===========================================================================
seccion "PUNTO 4 — auditoría de seguridad en auditoria_cambios (sin hashes ni tokens)"
# ===========================================================================
echo "-- 4a) desbloqueo manual por admin"
psql_q "UPDATE usuarios SET intentos_fallidos=5, bloqueado_hasta=NOW()+INTERVAL '25 minutes' WHERE id=$U1;" > /dev/null
call GET "/users/$U1" "$ADM_ACCESS" 198.51.100.50
assert_eq "GET /users/:id devuelve bloqueado_hasta con valor (UI puede mostrarlo)" "$(echo "$BODY_JSON" | jq -r '.data.bloqueado_hasta // .data.user.bloqueado_hasta // empty' | grep -c .)" "1"
echo "SELECT previo al desbloqueo:"; psql_tab "SELECT id, intentos_fallidos, bloqueado_hasta > NOW() AS bloqueado FROM usuarios WHERE id=$U1;"
# negativo: un OPERARIO NO puede desbloquear (ni se audita ni cambia nada)
REQ_BODY='{}'
call POST "/users/$U1/unlock" "$N0_ACCESS" 198.51.100.62
assert_eq "OPERARIO intenta desbloquear => HTTP" "$HTTP" "403"
assert_eq "tras el intento sin permiso la cuenta sigue bloqueada" "$(psql_q "SELECT bloqueado_hasta > NOW() FROM usuarios WHERE id=$U1;")" "t"
assert_eq "sin auditoría de desbloqueo por el intento sin permiso" "$(audit_count "$U1" DESBLOQUEO_MANUAL)" "0"
REQ_BODY='{}'
call POST "/users/$U1/unlock" "$ADM_ACCESS" 198.51.100.50 "$UA_TEST"
echo "unlock => HTTP $HTTP :: $(print_safe)"
assert_eq "HTTP unlock" "$HTTP" "200"
assert_eq "intentos_fallidos tras unlock" "$(intentos "$U1")" "0"
assert_eq "bloqueado_hasta NULL tras unlock" "$(bloqueado_null "$U1")" "t"
call GET "/users/$U1" "$ADM_ACCESS" 198.51.100.50
assert_eq "tras el unlock la API ya no informa bloqueo (se refleja en la UI)" "$(echo "$BODY_JSON" | jq -r '.data.bloqueado_hasta // .data.user.bloqueado_hasta // "null"')" "null"

echo ""
echo "-- 4b) filas de auditoría de ESTA corrida (sin hash, token ni contraseña)"
IDS_PRUEBA=$(IFS=,; echo "${TEST_USER_IDS[*]}")
psql_tab "SELECT id, registro_id AS objetivo, operacion, campos_modificados, usuario_id AS actor, usuario_nombre, host(ip_address) AS ip, left(user_agent,24) AS ua, motivo, datos_nuevos FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id IN ($IDS_PRUEBA) AND motivo NOT LIKE 'SESION_REEMPLAZADA%' ORDER BY id;"
echo "(las filas SESION_REEMPLAZADA que generan los logins repetidos de esta prueba se verifican en test_sesion_unica.sh; aquí: $(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id IN ($IDS_PRUEBA) AND motivo LIKE 'SESION_REEMPLAZADA%';") filas)"
assert_eq "CAMBIO_PASSWORD (C1)"             "$(audit_count "$C1" CAMBIO_PASSWORD)" "1"
assert_eq "CAMBIO_PASSWORD (C2)"             "$(audit_count "$C2" CAMBIO_PASSWORD)" "1"
assert_eq "auditoría C1: sesion_actual_conservada = true (se envió su refreshToken y esa sesión sigue viva)" "$(psql_q "SELECT datos_nuevos->>'sesion_actual_conservada' FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$C1 AND motivo LIKE 'CAMBIO_PASSWORD%' ORDER BY id DESC LIMIT 1;")" "true"
assert_eq "auditoría C2: sesion_actual_conservada = false (refreshToken ajeno: se revocaron todas)" "$(psql_q "SELECT datos_nuevos->>'sesion_actual_conservada' FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$C2 AND motivo LIKE 'CAMBIO_PASSWORD%' ORDER BY id DESC LIMIT 1;")" "false"
assert_eq "RESET_PASSWORD_TOKEN (C3)"        "$(audit_count "$C3" RESET_PASSWORD_TOKEN)" "1"
assert_eq "RESET_PASSWORD_ADMIN (C4)"        "$(audit_count "$C4" RESET_PASSWORD_ADMIN)" "1"
LOCKS=$(audit_count "$U1" BLOQUEO_CUENTA_INTENTOS)
[ "${LOCKS:-0}" -ge 2 ] && ok "BLOQUEO_CUENTA_INTENTOS registrado ($LOCKS veces para U1: 1a y 1e)" || fallo "BLOQUEO_CUENTA_INTENTOS: se esperaban >=2 filas para U1, hay $LOCKS"
assert_eq "DESBLOQUEO_MANUAL (U1)"           "$(audit_count "$U1" DESBLOQUEO_MANUAL)" "1"
assert_eq "el actor del desbloqueo es el ADMIN" "$(psql_q "SELECT usuario_id FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U1 AND motivo LIKE 'DESBLOQUEO_MANUAL%' ORDER BY id DESC LIMIT 1;")" "$ADM"
assert_eq "el actor del reset admin es el ADMIN" "$(psql_q "SELECT usuario_id FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$C4 AND motivo LIKE 'RESET_PASSWORD_ADMIN%' LIMIT 1;")" "$ADM"
assert_eq "la auditoría del cambio de contraseña guarda la IP real" "$(psql_q "SELECT host(ip_address) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$C1 AND motivo LIKE 'CAMBIO_PASSWORD%' LIMIT 1;")" "198.51.100.41"

echo ""
echo "-- 4c) escaneo de fugas: ni hash bcrypt, ni token, ni contraseña en claro en ningún jsonb/motivo"
TEXTO_AUDIT=$(psql_q "SELECT COALESCE(datos_anteriores::text,'')||' '||COALESCE(datos_nuevos::text,'')||' '||COALESCE(motivo,'')||' '||COALESCE(usuario_nombre,'') FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id IN ($IDS_PRUEBA);")
if printf '%s' "$TEXTO_AUDIT" | grep -qE '\$2[aby]\$'; then fallo "hay un hash bcrypt en auditoria_cambios"; else ok "ningún hash bcrypt (\$2a\$/\$2b\$/\$2y\$) en datos_anteriores/datos_nuevos/motivo"; fi
CLAVES_SECRETAS=$(psql_q "SELECT count(*) FROM auditoria_cambios a, LATERAL jsonb_object_keys(COALESCE(a.datos_nuevos,'{}'::jsonb) || COALESCE(a.datos_anteriores,'{}'::jsonb)) AS k WHERE a.tabla='usuarios' AND a.registro_id IN ($IDS_PRUEBA) AND k ~* '(pass|hash|token|secret|clave|credencial)';")
assert_eq "ninguna CLAVE de aspecto secreto (pass/hash/token/secret/clave) en datos_anteriores/datos_nuevos" "$CLAVES_SECRETAS" "0"
echo "Claves presentes en los jsonb de esta corrida (evidencia):"
psql_tab "SELECT DISTINCT k AS clave_jsonb FROM auditoria_cambios a, LATERAL jsonb_object_keys(COALESCE(a.datos_nuevos,'{}'::jsonb) || COALESCE(a.datos_anteriores,'{}'::jsonb)) AS k WHERE a.tabla='usuarios' AND a.registro_id IN ($IDS_PRUEBA) ORDER BY 1;"
if printf '%s' "$TEXTO_AUDIT" | grep -q -F -f "$SECRETS_FILE"; then fallo "una contraseña/token en claro generado por este script aparece en la auditoría"; else ok "ninguna contraseña ni token en claro generado por este script aparece en la auditoría"; fi
FUGAS_SESION=$(psql_q "SELECT count(*) FROM auditoria WHERE tabla='usuarios_sesiones' AND usuario_id IN ($IDS_PRUEBA) AND cambios::text ~ 'refresh|token|\$2[aby]\$';")
assert_eq "la tabla auditoria (trigger de sesiones) tampoco filtra tokens" "$FUGAS_SESION" "0"

# ===========================================================================
seccion "PUNTO 6 — renovación automática de token (interceptor REAL de api.ts vs staging)"
# ===========================================================================
PW_F=$(gen_valid_password); registrar_secreto "$PW_F"
PW_F2=$(gen_valid_password); registrar_secreto "$PW_F2"
crear_usuario ADMIN "$PW_F"; UF="$NEW_ID"; UF_NAME="$NEW_NAME"
if (cd "$REPO_ROOT" && API_URL="$API_URL" TEST_USERNAME="$UF_NAME" TEST_PASSWORD="$PW_F" NEW_PASSWORD="$PW_F2" run_node scripts/tests/frontend-token-refresh.test.mjs); then
  ok "harness del interceptor: TODOS los escenarios F0–F7 pasaron"
else
  fallo "el harness del interceptor (frontend-token-refresh.test.mjs) FALLÓ — ver salida arriba"
fi
echo "Evidencia server-side del flujo F1/F2 (sesiones del usuario de prueba):"
psql_tab "SELECT id, revocado, host(ip_address) AS ip, left(user_agent,20) AS ua, created_at FROM usuarios_sesiones WHERE usuario_id=$UF ORDER BY id;"
if grep -q "fetch(" "$REPO_ROOT/frontend/src/hooks/useVersionCheck.ts" && ! grep -q "apiService\|axios" "$REPO_ROOT/frontend/src/hooks/useVersionCheck.ts"; then
  ok "el polling de /api/version usa fetch nativo (no pasa por el interceptor de axios => no puede disparar renovaciones)"
else
  fallo "useVersionCheck.ts ya no usa fetch nativo: revisar que no pase por el interceptor"
fi

# ===========================================================================
seccion "PUNTO 7 — refresh: mismo segundo, simultáneos, jti único, encabezados inválidos"
# ===========================================================================
PW_R=$(gen_valid_password); registrar_secreto "$PW_R"
crear_usuario OPERARIO "$PW_R"; R_ID="$NEW_ID"; R_NAME="$NEW_NAME"
refresh_con() { # refreshToken ip [ua]  -> HTTP/BODY_JSON
  REQ_BODY=$(R="$1" jq -n '{refreshToken:env.R}')
  call POST /auth/refresh "" "$2" "${3:-acceptance-test/1.0}"
}

echo "-- 7a) login + refresh INMEDIATOS (mismo segundo), 5 rondas sin esperas"
OK7A=0; DISTINTOS=0
for i in 1 2 3 4 5; do
  login "$R_NAME" "$PW_R" 198.51.100.81
  RT_VIEJO="$REFRESH"
  refresh_con "$RT_VIEJO" 198.51.100.81
  RT_NUEVO=$(echo "$BODY_JSON" | jq -r '.data.refreshToken // empty')
  if [ "$HTTP" = "200" ]; then OK7A=$((OK7A+1)); else echo "ronda $i: HTTP $HTTP :: $(print_safe)"; fi
  [ -n "$RT_NUEVO" ] && [ "$RT_NUEVO" != "$RT_VIEJO" ] && DISTINTOS=$((DISTINTOS+1))
done
echo "Sesiones de la prueba (login y rotación caen en el mismo segundo; evidencia):"
psql_tab "SELECT id, revocado, to_char(created_at,'HH24:MI:SS') AS segundo FROM usuarios_sesiones WHERE usuario_id=$R_ID ORDER BY id LIMIT 10;"
assert_eq "5 rondas login->refresh en el mismo segundo => HTTP 200 en todas (antes: 409/23505)" "$OK7A" "5"
assert_eq "el refresh token rotado es distinto del anterior en las 5 rondas" "$DISTINTOS" "5"
# Con la sesión única cada login cierra la sesión de la ronda anterior: de las 10 filas (5 logins + 5 rotaciones)
# queda UNA viva y 9 revocadas (antes: 5 vivas y 5 revocadas). La aserción es más estricta, no más débil.
assert_eq "tras 5 rondas (5 logins + 5 rotaciones = 10 filas) queda UNA sesión viva y 9 revocadas" "$(sesiones_activas "$R_ID")|$(psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$R_ID AND revocado=true;")" "1|9"

echo ""
echo "-- 7b) DOS refresh SIMULTÁNEOS con el mismo token: uno gana, el otro falla limpio (5 rondas)"
ACTIVAS_BASE=$(sesiones_activas "$R_ID")
GANA_OK=0; PIERDE_OK=0; SESION_OK=0; ESPERADO=$ACTIVAS_BASE
for i in 1 2 3 4 5; do
  login "$R_NAME" "$PW_R" 198.51.100.82
  RT="$REFRESH"; ESPERADO=1   # sesión única: cada login cierra la ronda anterior, siempre queda 1 viva
  REQ_ESTE=$(R="$RT" jq -n '{refreshToken:env.R}')
  rm -f "/tmp/par1_$$" "/tmp/par2_$$" "/tmp/par1b_$$" "/tmp/par2b_$$"
  ( printf '%s' "$REQ_ESTE" | curl -s -o "/tmp/par1b_$$" -w '%{http_code}' -X POST "$API_URL/auth/refresh" -H 'Content-Type: application/json' -H 'X-Real-IP: 198.51.100.82' --data-binary @- > "/tmp/par1_$$" ) &
  ( printf '%s' "$REQ_ESTE" | curl -s -o "/tmp/par2b_$$" -w '%{http_code}' -X POST "$API_URL/auth/refresh" -H 'Content-Type: application/json' -H 'X-Real-IP: 198.51.100.82' --data-binary @- > "/tmp/par2_$$" ) &
  wait
  C1=$(cat "/tmp/par1_$$"); C2=$(cat "/tmp/par2_$$")
  if { [ "$C1" = "200" ] && [ "$C2" = "400" ]; } || { [ "$C1" = "400" ] && [ "$C2" = "200" ]; }; then GANA_OK=$((GANA_OK+1)); else echo "ronda $i: códigos $C1 / $C2 (se esperaba un 200 y un 400)"; fi
  if [ "$C1" = "200" ]; then GANADOR="/tmp/par1b_$$"; PERDEDOR="/tmp/par2b_$$"; else GANADOR="/tmp/par2b_$$"; PERDEDOR="/tmp/par1b_$$"; fi
  [ "$(jq -r '.message // empty' "$PERDEDOR" 2>/dev/null)" = "Token inválido o revocado" ] && PIERDE_OK=$((PIERDE_OK+1))
  # la sesión del usuario NO quedó rota: el token del ganador sigue sirviendo y no hay sesiones de más ni de menos
  GRT=$(jq -r '.data.refreshToken // empty' "$GANADOR" 2>/dev/null)
  refresh_con "$GRT" 198.51.100.82
  if [ "$HTTP" = "200" ] && [ "$(sesiones_activas "$R_ID")" = "$ESPERADO" ]; then SESION_OK=$((SESION_OK+1)); else echo "ronda $i: el token del ganador dio HTTP $HTTP y hay $(sesiones_activas "$R_ID") sesiones vivas (esperadas $ESPERADO)"; fi
done
rm -f /tmp/par1_$$ /tmp/par2_$$ /tmp/par1b_$$ /tmp/par2b_$$
assert_eq "en las 5 rondas hubo exactamente un 200 y un 400 (nunca dos 200, nunca un 500)" "$GANA_OK" "5"
assert_eq "el perdedor recibió el mensaje original 'Token inválido o revocado' en las 5 rondas" "$PIERDE_OK" "5"
assert_eq "tras cada ronda el token del ganador sigue vigente y el conteo de sesiones vivas es el esperado" "$SESION_OK" "5"
echo "Sesiones vivas del usuario tras las rondas (evidencia):"; psql_tab "SELECT count(*) FILTER (WHERE NOT revocado) AS vivas, count(*) FILTER (WHERE revocado) AS revocadas FROM usuarios_sesiones WHERE usuario_id=$R_ID;"

echo ""
echo "-- 7c) jti único en access y refresh"
nuevo_login "$R_NAME" "$PW_R" 198.51.100.83; A1="$ACCESS"; B1="$REFRESH"
login "$R_NAME" "$PW_R" 198.51.100.83;       A2="$ACCESS"; B2="$REFRESH"
jti_de() { printf '%s' "$1" | run_node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{console.log(JSON.parse(Buffer.from(t.split('.')[1],'base64url')).jti||'')}catch(e){console.log('')}})"; }
JA1=$(jti_de "$A1"); JA2=$(jti_de "$A2"); JB1=$(jti_de "$B1"); JB2=$(jti_de "$B2")
[ -n "$JA1" ] && [ -n "$JB1" ] && ok "access y refresh llevan jti (longitud ${#JA1} y ${#JB1})" || fallo "falta el claim jti"
[ "$JB1" != "$JB2" ] && [ "$B1" != "$B2" ] && ok "dos logins consecutivos del mismo usuario dan refresh tokens y jti distintos" || fallo "dos logins seguidos dieron el mismo refresh token"

echo ""
echo "-- 7d) encabezados inválidos NUNCA rompen un login, un refresh ni un cambio de contraseña (6e)"
PW_G=$(gen_valid_password); registrar_secreto "$PW_G"
crear_usuario ADMIN "$PW_G"; G_ID="$NEW_ID"; G_NAME="$NEW_NAME"
IP_BASURA="no-es-ip'; DROP TABLE usuarios;--"
IP_ENORME=$(head -c 12000 /dev/zero | tr '\0' 'x')
UA_ENORME=$(head -c 8000 /dev/zero | tr '\0' 'A')
login "$G_NAME" "$PW_G" "$IP_BASURA" "$UA_ENORME"
assert_eq "login con X-Real-IP basura y User-Agent de 8000 caracteres => HTTP" "$HTTP" "200"
GA="$ACCESS"; GR="$REFRESH"
echo "Última sesión (evidencia): ip y largo del user_agent guardados"
psql_tab "SELECT id, ip_address, length(user_agent) AS largo_ua FROM usuarios_sesiones WHERE usuario_id=$G_ID ORDER BY id DESC LIMIT 1;"
# Un X-Real-IP inválido se DESCARTA y se usa el siguiente origen del orden (req.ip; al probar directo
# contra :3000 es 127.0.0.1). NULL solo queda si ningún origen es válido (cubierto en jest).
assert_eq "X-Real-IP basura NO se guarda: se descarta y se usa el siguiente origen válido (req.ip)" "$(psql_q "SELECT host(ip_address) FROM usuarios_sesiones WHERE usuario_id=$G_ID ORDER BY id DESC LIMIT 1;")" "127.0.0.1"
assert_eq "user_agent truncado a 512" "$(psql_q "SELECT length(user_agent) FROM usuarios_sesiones WHERE usuario_id=$G_ID ORDER BY id DESC LIMIT 1;")" "512"
nuevo_login "$G_NAME" "$PW_G" "$IP_ENORME" "acceptance-test/1.0"
assert_eq "login con X-Real-IP de 12000 caracteres => HTTP" "$HTTP" "200"
assert_eq "X-Real-IP de 12000 caracteres se descarta (se usa req.ip)" "$(psql_q "SELECT host(ip_address) FROM usuarios_sesiones WHERE usuario_id=$G_ID ORDER BY id DESC LIMIT 1;")" "127.0.0.1"
GA="$ACCESS"; GR="$REFRESH"
refresh_con "$GR" "$IP_BASURA" "$UA_ENORME"
assert_eq "refresh con encabezados basura => HTTP" "$HTTP" "200"
GA=$(echo "$BODY_JSON" | jq -r '.data.accessToken // empty'); GR=$(echo "$BODY_JSON" | jq -r '.data.refreshToken // empty')
NEW_G=$(gen_valid_password); registrar_secreto "$NEW_G"
REQ_BODY=$(C="$PW_G" N="$NEW_G" R="$GR" jq -n '{currentPassword:env.C,newPassword:env.N,refreshToken:env.R}')
call POST /auth/change-password "$GA" "$IP_BASURA" "$UA_ENORME"
assert_eq "cambio de contraseña con encabezados basura => HTTP" "$HTTP" "200"
echo "Auditoría del cambio con IP inválida (evidencia):"
psql_tab "SELECT id, registro_id AS objetivo, ip_address, length(user_agent) AS largo_ua, left(motivo,40) AS motivo FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$G_ID ORDER BY id;"
assert_eq "la auditoría del cambio se registró aun con encabezados basura (IP válida de respaldo, UA a 512)" "$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$G_ID AND motivo LIKE 'CAMBIO_PASSWORD%' AND host(ip_address)='127.0.0.1' AND length(user_agent)=512;")" "1"
login "$G_NAME" "$NEW_G" 198.51.100.84; assert_eq "el usuario entra con la contraseña nueva" "$HTTP" "200"

# ===========================================================================
seccion "REGRESIÓN COMPLETA (qa-agent: no solo lo nuevo)"
# ===========================================================================
echo "-- jest (backend)"
JEST_OUT=$(cd "$REPO_ROOT/backend" && run_node ./node_modules/.bin/jest --silent 2>&1)
if echo "$JEST_OUT" | grep -qE '^Tests:.* failed'; then fallo "hay tests de jest en rojo"; else ok "jest sin fallos"; fi
echo "$JEST_OUT" | grep -E '^(Tests|Test Suites):'

if [ "$SKIP_REGRESION" = "1" ]; then
  echo "SKIP_REGRESION=1: se omiten los scripts de regresión previos (solo para depurar este script)."
else
  SQL_ADMINS_REALES="SELECT id, username, rol, activo FROM usuarios WHERE rol='ADMIN' AND username !~ '^test_' AND username !~ '_DEACTIVATED$' ORDER BY id"
  echo "AVISO: user_hierarchy_and_full_regression.sh desactiva BREVEMENTE a los admins REALES de staging y los restaura (trap)."
  echo "Admins reales ANTES de la regresión:"; psql_tab "$SQL_ADMINS_REALES"
  ADMINS_ANTES=$(psql_q "SELECT string_agg(id||':'||activo::text, ',' ORDER BY id) FROM usuarios WHERE rol='ADMIN' AND username !~ '^test_' AND username !~ '_DEACTIVATED$'")
  for s in test_error_desconocido_cambio_password.sh fix-audit-session-trigger.sh user_hierarchy_and_full_regression.sh test_session_replaced_guard.sh test_rate_limit_diferenciado.sh test_sesion_unica.sh test_aviso_sesion_y_password_admin.sh; do
    echo ""; echo "-- $s"
    if [ -f "$REPO_ROOT/scripts/tests/$s" ]; then
      if bash "$REPO_ROOT/scripts/tests/$s" > "/tmp/reg_$s.out" 2>&1; then
        ok "$s: exit 0"; tail -n 3 "/tmp/reg_$s.out"
      else
        fallo "$s: FALLÓ"; tail -n 25 "/tmp/reg_$s.out"
      fi
    else
      fallo "no existe $s"
    fi
  done
  echo ""; echo "Admins reales DESPUÉS de la regresión (SELECT de confirmación):"; psql_tab "$SQL_ADMINS_REALES"
  ADMINS_DESPUES=$(psql_q "SELECT string_agg(id||':'||activo::text, ',' ORDER BY id) FROM usuarios WHERE rol='ADMIN' AND username !~ '^test_' AND username !~ '_DEACTIVATED$'")
  assert_eq "admins reales: mismo estado activo antes y después de la regresión" "$ADMINS_DESPUES" "$ADMINS_ANTES"
fi

# ===========================================================================
seccion "SANIDAD DE SECRETOS (secrets-hygiene-in-tests, regla 6)"
# ===========================================================================
# Lista explícita (el árbol de staging puede tener archivos sucios ajenos a esta tarea).
ARCHIVOS_TOCADOS="backend/src/utils/clientInfo.js backend/src/utils/__tests__/clientInfo.test.js backend/src/services/securityHelpers.js backend/src/services/auth.service.js backend/src/services/user.service.js backend/src/controllers/auth.controller.js backend/src/controllers/user.controller.js backend/src/services/__tests__/auth.service.security.test.js backend/src/services/__tests__/passwords.flujos.test.js backend/src/services/__tests__/auditoria.seguridad.test.js backend/src/services/__tests__/helpers/secretos.js backend/src/services/__tests__/helpers/fakeClient.js backend/src/services/__tests__/refresh.transaccional.test.js backend/src/utils/jwt.js frontend/src/services/api.ts frontend/src/services/authService.ts frontend/src/utils/bloqueoCuenta.ts frontend/src/pages/Configuracion/GestionUsuarios.tsx scripts/tests/test_seguridad_cuentas_auth.sh scripts/tests/frontend-token-refresh.test.mjs scripts/tests/frontend-bloqueo-cuenta.test.mjs backend/src/config/index.js backend/src/middleware/auth.js backend/src/middleware/errorHandler.js backend/src/middleware/__tests__/auth.sid.test.js backend/src/services/__tests__/sesion.unica.test.js frontend/src/utils/sesionReemplazada.ts frontend/src/pages/Login/Login.tsx scripts/tests/test_sesion_unica.sh scripts/tests/test_aviso_sesion_y_password_admin.sh backend/src/middleware/__tests__/auth.motivo.test.js backend/src/services/securityHelpers.js frontend/src/utils/avisoSesion.ts frontend/src/utils/reglasPassword.ts frontend/src/pages/Configuracion/ModalRestablecerPassword.tsx frontend/src/pages/Auth/SetPassword.tsx"
echo "Archivos revisados:"; echo "$ARCHIVOS_TOCADOS" | tr ' ' '\n' | sed 's/^/  /'
# Patrones (NO se excluyen líneas por contener "test": ahí viven justo los literales que importan):
#   1) identificador de aspecto secreto asignado a un literal entre comillas (propiedad u
#      objeto, constante, variable)
#   2) literal pasado a setItem de tokens o a campos de credencial en llamadas
#      (la línea de comentario NO lleva ejemplos literales: el propio patrón los detectaría)
#   3) hash bcrypt o JWT completos pegados en el código
PAT_ASIGNACION="(pass(word)?|pwd|secret|token|clave|credencial|hash)[A-Za-z_]*[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"'\$]{4,}[\"']"
PAT_LLAMADA="(setItem\([\"'](auth_token|refresh_token)[\"'],|(password|refreshToken|newPassword|currentPassword)[\"']?[[:space:]]*:)[[:space:]]*[\"'][^\"'\$]{2,}[\"']"
PAT_LITERAL_FUERTE="\\\$2[aby]\\\$[0-9]{2}\\\$[A-Za-z0-9./]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\."
HITS=$(cd "$REPO_ROOT" && grep -nE "$PAT_ASIGNACION|$PAT_LLAMADA|$PAT_LITERAL_FUERTE" $ARCHIVOS_TOCADOS 2>/dev/null | grep -vE "process\.env|req\.body|useState|placeholder|type=|toMatch|SELECT|UPDATE|INSERT|PAT_" || true)
FALTANTES=$(cd "$REPO_ROOT" && for f in $ARCHIVOS_TOCADOS; do [ -f "$f" ] || echo "$f"; done)
[ -z "$FALTANTES" ] && ok "los $(echo $ARCHIVOS_TOCADOS | wc -w) archivos de la lista existen y fueron escaneados" || fallo "archivos de la lista que no existen (no se escanearon): $FALTANTES"
if [ -z "$HITS" ]; then ok "grep de sanidad (3 patrones, sin exclusión por 'test'): sin literales de contraseña/credencial/hash/JWT"; else echo "$HITS"; fallo "posibles literales de credencial (revisar manualmente las líneas de arriba)"; fi

echo ""
echo "===================================================="
if [ "$FALLOS" -eq 0 ]; then
  echo "TODOS LOS CHECKS PASARON"
  exit 0
else
  echo "$FALLOS CHECK(S) FALLARON"
  exit 1
fi
