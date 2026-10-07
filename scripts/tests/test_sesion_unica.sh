#!/bin/bash
# ============================================================================
# test_sesion_unica.sh
# Script de aceptación — SESIÓN ÚNICA POR USUARIO (siempre activa) con cierre inmediato.
#
# Requisito: cuando un usuario inicia sesión en otro dispositivo o navegador se cierran todas sus
# demás sesiones, y las cerradas quedan fuera DE INMEDIATO (el access token lleva el claim sid y el
# middleware lo comprueba contra usuarios_sesiones). Interruptor de emergencia: SINGLE_SESSION_PER_USER=false
# (solo un 'false' explícito lo desactiva; ver docs/SESION_UNICA_POR_USUARIO.md).
#
# Casos (numeración del encargo):
#   1) login A y login B del mismo usuario: refresh de A => 400; access de A => 401 SESSION_REPLACED al
#      instante; B sigue funcionando.
#   2) dos logins SIMULTÁNEOS del mismo usuario (5 rondas): siempre exactamente UNA sesión viva.
#   3) auditoría SESION_REEMPLAZADA: cuántas se cerraron, IP/navegador de las desplazadas y del nuevo
#      login; sin tokens ni hashes en el jsonb ni en el motivo; sin fila si no se cerró ninguna.
#   4) changePassword: el access token de la otra estación cae de inmediato; la sesión que cambió la
#      clave sigue viva.
#   5) /auth/refresh: no revoca las demás sesiones ni genera SESION_REEMPLAZADA; el access nuevo trae sid.
#   6) interruptor SINGLE_SESSION_PER_USER=false: A y B conviven y no hay SESION_REEMPLAZADA; se restaura
#      el valor por defecto al terminar (reinicio de PM2 con el entorno limpio) y se confirma.
#   7) access token SIN sid => 401 SESSION_REPLACED; token con sid funciona. Ninguna ruta pública, login,
#      refresh ni /api/version dependen del sid. Excepción acotada: token de alta (scp=set-password).
#   8) (frontend) lo cubre F8 del harness: scripts/tests/frontend-token-refresh.test.mjs
#   +) carga: EXPLAIN/benchmark de la consulta del middleware con y sin la subconsulta por PK.
#
# Manejo de credenciales: ninguna contraseña/token es literal; se generan en runtime. Los cuerpos HTTP
# se arman por entorno/stdin y la salida se filtra con jq. Los tokens firmados por este script viven en
# variables de shell y nunca se imprimen.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa), con el backend corriendo el código bajo prueba:
#   bash scripts/tests/test_sesion_unica.sh
# Requiere: psql, curl, jq, node, pm2 (vía nvm). Crea y desactiva sus propios usuarios de prueba.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
VALIDATOR_FILE="$REPO_ROOT/backend/src/validators/auth.validator.js"
API_URL="${API_URL:-http://localhost:3000/api}"
PM2_NAME="${PM2_NAME:-artesa-backend-staging}"
FALLOS=0
fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }
seccion() { echo ""; echo "===================================================="; echo "$1"; echo "===================================================="; }
assert_eq() { if [ "$2" = "$3" ]; then ok "$1 (= '$3')"; else fallo "$1: obtuvo '$2', esperaba '$3'"; fi; }

[ -f "$ENV_FILE" ] || { echo "FALLO: no se encontró $ENV_FILE"; exit 1; }
DB_HOST=$(grep -E '^DB_HOST='     "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep -E '^DB_PORT='     "$ENV_FILE" | cut -d= -f2-)
DB_NAME=$(grep -E '^DB_NAME='     "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep -E '^DB_USER='     "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
if echo "$DB_NAME" | grep -qi 'prod' && ! echo "$DB_NAME" | grep -qi 'staging'; then
  echo "FALLO: DB_NAME='$DB_NAME' parece producción. Este script es solo para staging."; exit 1
fi
[ -f "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" > /dev/null 2>&1

psql_q()   { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"; }
psql_tab() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -P pager=off -c "$1"; }
psql_file(){ PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -f "$1"; }
run_node() { if command -v node > /dev/null 2>&1; then node "$@"; else bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"; fi; }

RULES=$(run_node -e "
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const block = src.slice(src.indexOf('changePasswordValidation'), src.indexOf('changePasswordValidation') + 800);
const minM = block.match(/isLength\(\{\s*min:\s*(\d+)/);
const specM = block.match(/\(\?=\.\*\[([^\]]+)\]\)\[A-Za-z/);
if (!minM || !specM) { process.exit(1); }
console.log(minM[1] + '|' + specM[1]);
" "$VALIDATOR_FILE")
[ -n "$RULES" ] || { echo "FALLO: no se pudieron leer las reglas del validador"; exit 1; }
IFS='|' read -r MIN_LEN SPECIAL_CHARS <<< "$RULES"
rand_chars() { tr -dc "$2" < /dev/urandom | head -c "$1"; }
gen_valid_password() {
  local upper lower digit special n idx
  upper=$(rand_chars 3 'A-Z'); lower=$(rand_chars 4 'a-z'); digit=$(rand_chars 3 '0-9')
  n=${#SPECIAL_CHARS}; idx=$((RANDOM % n)); special="${SPECIAL_CHARS:$idx:1}"
  echo "${upper}${lower}${digit}${special}" | fold -w1 | shuf | tr -d '\n'
}
hash_password() { (cd "$REPO_ROOT/backend" && printf '%s' "$1" | run_node -e "
let pw = ''; process.stdin.on('data', d => pw += d);
process.stdin.on('end', () => { require('bcrypt').hash(pw, 12).then(h => console.log(h)); });"); }

SECRETS_FILE=$(mktemp); registrar_secreto() { printf '%s\n' "$1" >> "$SECRETS_FILE"; }
RESP_FILE=$(mktemp)
TEST_USER_IDS=()
SWITCH_TOCADO=0

pm2_env_nombres() { # nombres (NO valores) de variables SINGLE_SESSION* del proceso en PM2
  pm2 jlist 2>/dev/null | run_node -e "
let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const l=JSON.parse(t.slice(t.indexOf('[')));
const p=l.find(x=>x.name===process.argv[1]);const e=(p&&p.pm2_env)||{};
console.log(Object.keys(e).filter(k=>/^SINGLE_SESSION/.test(k)).join(',')||'(ninguna)')}catch(e){console.log('(error)')}})" "$PM2_NAME"
}
esperar_backend() { local i; for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' "${API_URL%/api}/health")" = "200" ] && return 0; sleep 1; done; return 1; }
restaurar_interruptor() {
  # TRAMPA DE PM2: `pm2 restart --update-env` FUSIONA el entorno actual con el guardado, así que quitar la
  # variable del shell NO la quita del proceso (verificado). Para volver al valor por defecto (variable no
  # definida) hay que recrear el proceso desde el ecosistema, con el entorno limpio, y guardar la lista.
  ( env -u SINGLE_SESSION_PER_USER bash -c 'source ~/.nvm/nvm.sh >/dev/null 2>&1; cd "'"$REPO_ROOT"'/backend" && pm2 delete "'"$PM2_NAME"'" >/dev/null 2>&1; pm2 start ecosystem.config.js --only "'"$PM2_NAME"'" >/dev/null 2>&1; pm2 save >/dev/null 2>&1' )
  esperar_backend
}

cleanup() {
  if [ "$SWITCH_TOCADO" = "1" ]; then
    echo "[cleanup] restaurando SINGLE_SESSION_PER_USER (valor por defecto) tras una interrupción…"
    restaurar_interruptor
  fi
  for id in "${TEST_USER_IDS[@]:-}"; do
    [ -z "$id" ] && continue
    psql_q "UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username=username || '_DEACTIVATED' WHERE id=$id AND username NOT LIKE '%_DEACTIVATED';" > /dev/null 2>&1
  done
  echo "[cleanup] usuarios de prueba desactivados: ${TEST_USER_IDS[*]:-ninguno}"
  rm -f "$RESP_FILE" "$SECRETS_FILE"
}
trap cleanup EXIT

NEW_ID=""; NEW_NAME=""
crear_usuario() { # rol password [debe_cambiar]
  local rol="$1" pw="$2" deb="${3:-false}" hash uname tmp id
  hash=$(hash_password "$pw"); uname="test_su_${rol,,}_$$_${RANDOM}"; tmp=$(mktemp)
  cat > "$tmp" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password)
VALUES ('$uname', '$uname@artesa-staging-test.com', '$hash', 'Usuario Prueba Sesion Unica $rol', '$rol', true, true, 0, NULL, $deb)
RETURNING id;
EOF
  id=$(psql_file "$tmp"); rm -f "$tmp"; TEST_USER_IDS+=("$id"); NEW_ID="$id"; NEW_NAME="$uname"
}

HTTP=""; BODY_JSON=""; REQ_BODY=""
call() { # METHOD PATH [TOKEN] [IP] [UA]
  local m="$1" p="$2" tok="${3:-}" ip="${4:-198.51.100.1}" ua="${5:-acceptance-test/1.0}"
  local args=(-s -o "$RESP_FILE" -w '%{http_code}' -X "$m" "$API_URL$p" -H 'Content-Type: application/json' -H "X-Real-IP: $ip" -H "User-Agent: $ua")
  [ -n "$tok" ] && args+=(-H "Authorization: Bearer $tok")
  HTTP=$(printf '%s' "${REQ_BODY:-}" | curl "${args[@]}" --data-binary @-); BODY_JSON=$(cat "$RESP_FILE"); REQ_BODY=""
}
msg()  { echo "$BODY_JSON" | jq -r '.message // empty' 2>/dev/null; }
code() { echo "$BODY_JSON" | jq -r '.code // empty' 2>/dev/null; }
print_safe() { echo "$BODY_JSON" | jq -c '{success, status, message, code}' 2>/dev/null || echo "<no-JSON omitido>"; }
ACCESS=""; REFRESH=""
login() { # user pass ip ua
  REQ_BODY=$(U="$1" P="$2" jq -n '{username:env.U,password:env.P}'); call POST /auth/login "" "${3:-198.51.100.1}" "${4:-acceptance-test/1.0}"
  ACCESS=$(echo "$BODY_JSON" | jq -r '.data.accessToken // empty' 2>/dev/null); REFRESH=$(echo "$BODY_JSON" | jq -r '.data.refreshToken // empty' 2>/dev/null)
  [ -n "$ACCESS" ] && registrar_secreto "$ACCESS"; [ -n "$REFRESH" ] && registrar_secreto "$REFRESH"
}
refresh_con() { REQ_BODY=$(R="$1" jq -n '{refreshToken:env.R}'); call POST /auth/refresh "" "${2:-198.51.100.1}" "${3:-acceptance-test/1.0}"; }
sid_de() { printf '%s' "$1" | run_node -e "let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{try{const s=JSON.parse(Buffer.from(t.split('.')[1],'base64url')).sid;console.log(s===undefined?'':s)}catch(e){console.log('')}})"; }
firmar_access() { # user_id sid(opcional) scp(opcional) -> token firmado con el secreto REAL (no se imprime)
  ( cd "$REPO_ROOT/backend" && U_ID="$1" S_ID="${2:-}" S_CP="${3:-}" run_node -e "
const jwt=require('jsonwebtoken');const c=require('./src/config');
const p={id:Number(process.env.U_ID),username:'t',email:'t@x.test',rol:'OPERARIO'};
if(process.env.S_ID)p.sid=Number(process.env.S_ID);
if(process.env.S_CP)p.scp=process.env.S_CP;
process.stdout.write(jwt.sign(p,c.jwt.secret,{expiresIn:'10m',jwtid:require('crypto').randomUUID()}));" )
}
sesiones_vivas() { psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$1 AND revocado=false;"; }
audit_reemp() { psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$1 AND motivo LIKE 'SESION_REEMPLAZADA%';"; }
sesion_extra() { # usuario_id n -> inserta n sesiones vivas "de otras estaciones" por SQL (no hay JWT real para ellas)
  local i; for i in $(seq 1 "$2"); do
    psql_q "INSERT INTO usuarios_sesiones (usuario_id, refresh_token, expires_at, ip_address, user_agent) VALUES ($1, '$(rand_chars 48 'A-Za-z0-9')', NOW() + INTERVAL '7 days', '198.51.100.$((200+i))', 'estacion-extra-$i/1.0');" > /dev/null
  done
}
id_sesion_de_refresh() { psql_q "SELECT id FROM usuarios_sesiones WHERE refresh_token='$1';"; }

echo "===================================================="
echo "PRECHECK"
echo "===================================================="
[ "$(curl -s -o /dev/null -w '%{http_code}' "${API_URL%/api}/health")" = "200" ] && ok "backend responde" || { fallo "backend NO responde"; exit 1; }
echo "Variables SINGLE_SESSION* en el entorno de PM2 (solo nombres): $(pm2_env_nombres)"
assert_eq "el interruptor NO está definido: comportamiento por defecto (sesión única ACTIVA)" "$(pm2_env_nombres)" "(ninguna)"
CFG=$(cd "$REPO_ROOT/backend" && run_node -e "console.log(require('./src/config').security.singleSessionPerUser)")
assert_eq "config.security.singleSessionPerUser efectivo en este entorno" "$CFG" "true"

PW=$(gen_valid_password); registrar_secreto "$PW"
crear_usuario OPERARIO "$PW"; U1="$NEW_ID"; U1N="$NEW_NAME"
ok "usuario de prueba U1=$U1 ($U1N)"

# ===========================================================================
seccion "CASO 1 — login A y login B del mismo usuario"
# ===========================================================================
IP_A="198.51.100.61"; UA_A="estacion-A/1.0 (caso1)"; IP_B="198.51.100.62"; UA_B="estacion-B/1.0 (caso1)"
login "$U1N" "$PW" "$IP_A" "$UA_A"; AA="$ACCESS"; RA="$REFRESH"
assert_eq "login A => HTTP" "$HTTP" "200"
assert_eq "access de A (sesión vigente) funciona: GET /auth/profile => HTTP" "$(call GET /auth/profile "$AA"; echo $HTTP)" "200"
assert_eq "el access de A lleva claim sid" "$([ -n "$(sid_de "$AA")" ] && echo si || echo no)" "si"
assert_eq "tras el primer login de un usuario SIN sesiones previas no hay SESION_REEMPLAZADA" "$(audit_reemp "$U1")" "0"
login "$U1N" "$PW" "$IP_B" "$UA_B"; AB="$ACCESS"; RB="$REFRESH"
assert_eq "login B => HTTP" "$HTTP" "200"
echo "Sesiones del usuario tras el login B (evidencia, sin tokens):"
psql_tab "SELECT id, revocado, host(ip_address) AS ip, left(user_agent,26) AS ua FROM usuarios_sesiones WHERE usuario_id=$U1 ORDER BY id;"
assert_eq "exactamente UNA sesión viva tras el login B" "$(sesiones_vivas "$U1")" "1"

refresh_con "$RA" "$IP_A" "$UA_A"
echo "refresh de A => HTTP $HTTP :: $(print_safe)"
assert_eq "refresh de A => HTTP" "$HTTP" "400"
assert_eq "refresh de A => mensaje" "$(msg)" "Token inválido o revocado"
T0=$(date +%s%N); call GET /auth/profile "$AA" "$IP_A" "$UA_A"; T1=$(date +%s%N)
echo "access de A en una petición protegida => HTTP $HTTP :: $(print_safe)  ($(( (T1-T0)/1000000 )) ms)"
assert_eq "access de A => HTTP (al instante, sin esperar a que venza el token)" "$HTTP" "401"
assert_eq "access de A => code" "$(code)" "SESSION_REPLACED"
call GET /auth/profile "$AB" "$IP_B" "$UA_B"
echo "access de B => HTTP $HTTP :: $(print_safe)"
assert_eq "access de B sigue funcionando => HTTP" "$HTTP" "200"
refresh_con "$RB" "$IP_B" "$UA_B"; assert_eq "refresh de B sigue funcionando => HTTP" "$HTTP" "200"

# ===========================================================================
seccion "CASO 2 — dos logins SIMULTÁNEOS del mismo usuario (5 rondas)"
# ===========================================================================
PW2=$(gen_valid_password); registrar_secreto "$PW2"; crear_usuario OPERARIO "$PW2"; U2="$NEW_ID"; U2N="$NEW_NAME"
UNA_VIVA=0; UNO_Y_UNO=0
for i in 1 2 3 4 5; do
  CUERPO=$(U="$U2N" P="$PW2" jq -n '{username:env.U,password:env.P}')
  rm -f "/tmp/sl1_$$" "/tmp/sl2_$$" "/tmp/sl1b_$$" "/tmp/sl2b_$$"
  ( printf '%s' "$CUERPO" | curl -s -o "/tmp/sl1b_$$" -w '%{http_code}' -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' -H "X-Real-IP: 198.51.100.7$i" -H 'User-Agent: simultaneo-1/1.0' --data-binary @- > "/tmp/sl1_$$" ) &
  ( printf '%s' "$CUERPO" | curl -s -o "/tmp/sl2b_$$" -w '%{http_code}' -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' -H "X-Real-IP: 198.51.100.8$i" -H 'User-Agent: simultaneo-2/1.0' --data-binary @- > "/tmp/sl2_$$" ) &
  wait
  C1=$(cat "/tmp/sl1_$$"); C2=$(cat "/tmp/sl2_$$")
  TK1=$(jq -r '.data.accessToken // empty' "/tmp/sl1b_$$"); TK2=$(jq -r '.data.accessToken // empty' "/tmp/sl2b_$$")
  [ -n "$TK1" ] && registrar_secreto "$TK1"; [ -n "$TK2" ] && registrar_secreto "$TK2"
  [ "$(sesiones_vivas "$U2")" = "1" ] && UNA_VIVA=$((UNA_VIVA+1)) || echo "ronda $i: sesiones vivas = $(sesiones_vivas "$U2") (códigos de login $C1/$C2)"
  call GET /auth/profile "$TK1"; S1=$HTTP; K1=$(code)
  call GET /auth/profile "$TK2"; S2=$HTTP; K2=$(code)
  if [ "$C1" = "200" ] && [ "$C2" = "200" ] && { { [ "$S1" = "200" ] && [ "$S2" = "401" ] && [ "$K2" = "SESSION_REPLACED" ]; } || { [ "$S1" = "401" ] && [ "$K1" = "SESSION_REPLACED" ] && [ "$S2" = "200" ]; }; }; then
    UNO_Y_UNO=$((UNO_Y_UNO+1))
  else echo "ronda $i: logins $C1/$C2, accesos $S1($K1)/$S2($K2)"; fi
done
rm -f /tmp/sl1_$$ /tmp/sl2_$$ /tmp/sl1b_$$ /tmp/sl2b_$$
assert_eq "tras cada una de las 5 rondas hay exactamente UNA sesión viva" "$UNA_VIVA" "5"
assert_eq "en cada ronda los dos logins dieron 200 y SOLO un access token sigue valiendo (el otro: 401 SESSION_REPLACED)" "$UNO_Y_UNO" "5"
echo "Estado final de sesiones del usuario (evidencia):"; psql_tab "SELECT count(*) FILTER (WHERE NOT revocado) AS vivas, count(*) FILTER (WHERE revocado) AS revocadas FROM usuarios_sesiones WHERE usuario_id=$U2;"

# ===========================================================================
seccion "CASO 3 — auditoría SESION_REEMPLAZADA (sin tokens ni hashes)"
# ===========================================================================
echo "Fila del login B del caso 1 (A fue desplazada):"
psql_tab "SELECT id, registro_id AS usuario, usuario_id AS actor, host(ip_address) AS ip_nuevo, left(user_agent,26) AS ua_nuevo, motivo, datos_nuevos FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U1 AND motivo LIKE 'SESION_REEMPLAZADA%' ORDER BY id;"
assert_eq "se registró exactamente 1 SESION_REEMPLAZADA para el usuario del caso 1" "$(audit_reemp "$U1")" "1"
J="SELECT datos_nuevos FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U1 AND motivo LIKE 'SESION_REEMPLAZADA%' ORDER BY id DESC LIMIT 1"
assert_eq "sesiones_cerradas" "$(psql_q "SELECT ($J)->>'sesiones_cerradas';")" "1"
assert_eq "IP de la sesión desplazada (A)" "$(psql_q "SELECT ($J)->'desplazadas'->0->>'ip';")" "$IP_A"
assert_eq "navegador de la sesión desplazada (A)" "$(psql_q "SELECT ($J)->'desplazadas'->0->>'navegador';")" "$UA_A"
assert_eq "IP del nuevo login (B) en el jsonb" "$(psql_q "SELECT ($J)->'nuevo_login'->>'ip';")" "$IP_B"
assert_eq "navegador del nuevo login (B) en el jsonb" "$(psql_q "SELECT ($J)->'nuevo_login'->>'navegador';")" "$UA_B"
assert_eq "columna ip_address = IP del nuevo login" "$(psql_q "SELECT host(ip_address) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U1 AND motivo LIKE 'SESION_REEMPLAZADA%' ORDER BY id DESC LIMIT 1;")" "$IP_B"
assert_eq "el actor es el propio usuario" "$(psql_q "SELECT usuario_id FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U1 AND motivo LIKE 'SESION_REEMPLAZADA%' ORDER BY id DESC LIMIT 1;")" "$U1"
echo "-- escaneo de fugas sobre TODAS las filas SESION_REEMPLAZADA de esta corrida (casos 1 y 2)"
IDS_SU=$(IFS=,; echo "${TEST_USER_IDS[*]}")
TEXTO=$(psql_q "SELECT COALESCE(datos_anteriores::text,'')||' '||COALESCE(datos_nuevos::text,'')||' '||COALESCE(motivo,'')||' '||COALESCE(usuario_nombre,'') FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id IN ($IDS_SU) AND motivo LIKE 'SESION_REEMPLAZADA%';")
printf '%s' "$TEXTO" | grep -qE '\$2[aby]\$' && fallo "hay un hash bcrypt en la auditoría" || ok "ningún hash bcrypt en jsonb/motivo"
printf '%s' "$TEXTO" | grep -qE 'eyJ[A-Za-z0-9_-]{10,}\.' && fallo "hay un JWT en la auditoría" || ok "ningún JWT en jsonb/motivo"
printf '%s' "$TEXTO" | grep -q -F -f "$SECRETS_FILE" && fallo "un token/contraseña de esta corrida aparece en la auditoría" || ok "ningún access/refresh token ni contraseña generada en esta corrida aparece en la auditoría"
assert_eq "ninguna CLAVE de aspecto secreto en el jsonb (nivel superior)" "$(psql_q "SELECT count(*) FROM auditoria_cambios a, LATERAL jsonb_object_keys(a.datos_nuevos) k WHERE a.tabla='usuarios' AND a.registro_id IN ($IDS_SU) AND a.motivo LIKE 'SESION_REEMPLAZADA%' AND k ~* '(pass|hash|token|secret|clave|credencial)';")" "0"
echo "Claves del jsonb (evidencia):"; psql_tab "SELECT DISTINCT k AS clave FROM auditoria_cambios a, LATERAL jsonb_object_keys(a.datos_nuevos) k WHERE a.tabla='usuarios' AND a.registro_id IN ($IDS_SU) AND a.motivo LIKE 'SESION_REEMPLAZADA%' ORDER BY 1;"

# ===========================================================================
seccion "CASO 4 — changePassword: la otra estación cae de inmediato; la que cambió la clave sigue viva"
# ===========================================================================
PW4=$(gen_valid_password); registrar_secreto "$PW4"; crear_usuario OPERARIO "$PW4"; U4="$NEW_ID"; U4N="$NEW_NAME"
login "$U4N" "$PW4" 198.51.100.91 "estacion-que-cambia/1.0"; A4="$ACCESS"; R4="$REFRESH"
sesion_extra "$U4" 1
SID_OTRA=$(psql_q "SELECT id FROM usuarios_sesiones WHERE usuario_id=$U4 AND refresh_token NOT LIKE 'eyJ%' ORDER BY id DESC LIMIT 1;")
OTRA=$(firmar_access "$U4" "$SID_OTRA"); registrar_secreto "$OTRA"
assert_eq "antes del cambio hay 2 sesiones vivas (la real y la 'otra estación')" "$(sesiones_vivas "$U4")" "2"
assert_eq "antes del cambio el access de la OTRA estación funciona => HTTP" "$(call GET /auth/profile "$OTRA"; echo $HTTP)" "200"
sleep 1.1
NEW4=$(gen_valid_password); registrar_secreto "$NEW4"
REQ_BODY=$(C="$PW4" N="$NEW4" R="$R4" jq -n '{currentPassword:env.C,newPassword:env.N,refreshToken:env.R}')
call POST /auth/change-password "$A4" 198.51.100.91 "estacion-que-cambia/1.0"
assert_eq "change-password (enviando el refreshToken de la sesión actual) => HTTP" "$HTTP" "200"
call GET /auth/profile "$OTRA"
echo "access de la OTRA estación justo después => HTTP $HTTP :: $(print_safe)"
assert_eq "la OTRA estación cae de inmediato => HTTP" "$HTTP" "401"
assert_eq "la OTRA estación cae de inmediato => code" "$(code)" "SESSION_REPLACED"
assert_eq "la sesión que cambió la clave sigue VIVA en BD" "$(psql_q "SELECT count(*) FROM usuarios_sesiones WHERE refresh_token='$R4' AND revocado=false;")" "1"
assert_eq "sesiones vivas tras el cambio (solo la que cambió la clave)" "$(sesiones_vivas "$U4")" "1"
call GET /auth/profile "$A4"
echo "access ANTERIOR de la sesión que cambió la clave => HTTP $HTTP :: $(print_safe)  (comportamiento previo: token emitido antes del cambio; se recupera con refresh)"
[ "$(code)" != "SESSION_REPLACED" ] && ok "ese 401 NO es SESSION_REPLACED: el frontend lo renueva con refresh en vez de cerrar la sesión" || fallo "la sesión que cambió la clave recibió SESSION_REPLACED"
sleep 1.1
refresh_con "$R4" 198.51.100.91 "estacion-que-cambia/1.0"
assert_eq "la sesión que cambió la clave RENUEVA con su refresh => HTTP" "$HTTP" "200"
A4N=$(echo "$BODY_JSON" | jq -r '.data.accessToken // empty'); registrar_secreto "$A4N"
assert_eq "el access renovado funciona => HTTP" "$(call GET /auth/profile "$A4N"; echo $HTTP)" "200"
assert_eq "auditoría: sesion_actual_conservada = true" "$(psql_q "SELECT datos_nuevos->>'sesion_actual_conservada' FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U4 AND motivo LIKE 'CAMBIO_PASSWORD%' ORDER BY id DESC LIMIT 1;")" "true"

# ===========================================================================
seccion "CASO 5 — /auth/refresh no aplica la sesión única"
# ===========================================================================
PW5=$(gen_valid_password); registrar_secreto "$PW5"; crear_usuario OPERARIO "$PW5"; U5="$NEW_ID"; U5N="$NEW_NAME"
login "$U5N" "$PW5" 198.51.100.51 "estacion-5/1.0"; R5="$REFRESH"
sesion_extra "$U5" 2
assert_eq "antes de rotar hay 3 sesiones vivas (la real + 2 de otras estaciones)" "$(sesiones_vivas "$U5")" "3"
AUD_ANTES5=$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U5;")
sleep 1.1
refresh_con "$R5" 198.51.100.51 "estacion-5/1.0"
assert_eq "refresh => HTTP" "$HTTP" "200"
A5=$(echo "$BODY_JSON" | jq -r '.data.accessToken // empty'); registrar_secreto "$A5"
SID5=$(sid_de "$A5"); NUEVA5=$(psql_q "SELECT id FROM usuarios_sesiones WHERE usuario_id=$U5 AND revocado=false AND refresh_token LIKE 'eyJ%' ORDER BY id DESC LIMIT 1;")
assert_eq "el access nuevo trae sid y es el id de la fila NUEVA de la rotación" "$SID5" "$NUEVA5"
assert_eq "el access nuevo funciona => HTTP" "$(call GET /auth/profile "$A5"; echo $HTTP)" "200"
assert_eq "tras la rotación siguen 3 sesiones vivas (la rotación NO revocó las demás)" "$(sesiones_vivas "$U5")" "3"
assert_eq "las 2 sesiones de otras estaciones siguen vivas" "$(psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$U5 AND revocado=false AND refresh_token NOT LIKE 'eyJ%';")" "2"
assert_eq "la rotación NO generó SESION_REEMPLAZADA ni ninguna otra fila de auditoría" "$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$U5;")" "$AUD_ANTES5"

# ===========================================================================
seccion "CASO 7 — access token SIN sid => 401 SESSION_REPLACED (ingreso limpio tras el deploy)"
# ===========================================================================
PW7=$(gen_valid_password); registrar_secreto "$PW7"; crear_usuario OPERARIO "$PW7"; U7="$NEW_ID"; U7N="$NEW_NAME"
login "$U7N" "$PW7" 198.51.100.71; A7="$ACCESS"; R7="$REFRESH"
SIN_SID=$(firmar_access "$U7"); registrar_secreto "$SIN_SID"
assert_eq "el token de prueba NO lleva sid (simula uno emitido con el código anterior)" "$([ -z "$(sid_de "$SIN_SID")" ] && echo si || echo no)" "si"
call GET /auth/profile "$SIN_SID"
echo "access SIN sid (firma y expiración válidas) => HTTP $HTTP :: $(print_safe)"
assert_eq "access sin sid => HTTP" "$HTTP" "401"
assert_eq "access sin sid => code" "$(code)" "SESSION_REPLACED"
call GET /auth/profile "$A7"
echo "access NUEVO (con sid) => HTTP $HTTP :: $(print_safe)"
assert_eq "access nuevo con sid => HTTP" "$HTTP" "200"
SID_FALSO=$(firmar_access "$U7" 999999999); registrar_secreto "$SID_FALSO"
call GET /auth/profile "$SID_FALSO"
assert_eq "sid de una sesión inexistente => HTTP|code" "$HTTP|$(code)" "401|SESSION_REPLACED"
# sid de una sesión de OTRO usuario
OTRO_SID=$(sid_de "$A4N"); CRUZADO=$(firmar_access "$U7" "$OTRO_SID"); registrar_secreto "$CRUZADO"
call GET /auth/profile "$CRUZADO"
assert_eq "sid de una sesión de OTRO usuario => HTTP|code" "$HTTP|$(code)" "401|SESSION_REPLACED"
echo ""
echo "-- 7b) nada público depende del sid; los demás 401 conservan mensaje y code"
assert_eq "GET /api/version sin token (polling del frontend) => HTTP" "$(call GET /version; echo $HTTP)" "200"
assert_eq "GET /api/version con un token basura => HTTP" "$(call GET /version "$(rand_chars 40 'A-Za-z0-9')"; echo $HTTP)" "200"
assert_eq "GET /health (interno) => HTTP" "$(curl -s -o /dev/null -w '%{http_code}' "${API_URL%/api}/health")" "200"
call GET /auth/profile ""
assert_eq "sin token: 401 con el mensaje de siempre" "$HTTP|$(msg)|$(code)" "401|No autenticado. Por favor inicie sesión.|"
call GET /auth/profile "$(rand_chars 30 'A-Za-z0-9')"
assert_eq "token basura: 401 con el mensaje de siempre y sin code" "$HTTP|$(msg)|$(code)" "401|Token inválido|"
refresh_con "$R7"; assert_eq "/auth/refresh (público) no depende del sid => HTTP" "$HTTP" "200"
echo ""
echo "-- 7c) excepción acotada: token corto de alta de usuario (scp=set-password), solo en /auth/set-initial-password"
PWN=$(gen_valid_password); registrar_secreto "$PWN"; crear_usuario OPERARIO "$PWN" true; UN="$NEW_ID"
ALTA=$(firmar_access "$UN" "" "set-password"); registrar_secreto "$ALTA"
call GET /auth/profile "$ALTA"
assert_eq "el token de alta en OTRA ruta => HTTP|code" "$HTTP|$(code)" "401|SESSION_REPLACED"
NUEVA_CLAVE=$(gen_valid_password); registrar_secreto "$NUEVA_CLAVE"
REQ_BODY=$(N="$NUEVA_CLAVE" jq -n '{newPassword:env.N}'); call POST /auth/set-initial-password "$ALTA"
echo "set-initial-password con el token de alta => HTTP $HTTP :: $(print_safe)"
assert_eq "el token de alta funciona en /auth/set-initial-password => HTTP" "$HTTP" "200"
assert_eq "el alta quedó completa (debe_cambiar_password = false)" "$(psql_q "SELECT debe_cambiar_password FROM usuarios WHERE id=$UN;")" "f"
SIN_SCP=$(firmar_access "$UN"); registrar_secreto "$SIN_SCP"
REQ_BODY=$(N="$(gen_valid_password)" jq -n '{newPassword:env.N}'); call POST /auth/set-initial-password "$SIN_SCP"
assert_eq "un token sin sid NI scp tampoco vale en /auth/set-initial-password => HTTP|code" "$HTTP|$(code)" "401|SESSION_REPLACED"

# ===========================================================================
seccion "CARGA — la consulta del middleware con la subconsulta por PK vs la anterior"
# ===========================================================================
SID_BENCH=$(psql_q "SELECT id FROM usuarios_sesiones WHERE usuario_id=$U7 AND revocado=false ORDER BY id DESC LIMIT 1;")
Q_NUEVA="SELECT id, uuid, username, email, nombre_completo, rol, activo, bloqueado_hasta, ultimo_cambio_password, (SELECT s.revocado = false AND s.usuario_id = usuarios.id FROM usuarios_sesiones s WHERE s.id = $SID_BENCH::integer) AS sesion_vigente FROM usuarios WHERE id = $U7"
Q_VIEJA="SELECT id, uuid, username, email, nombre_completo, rol, activo, bloqueado_hasta, ultimo_cambio_password FROM usuarios WHERE id = $U7"
echo "Plan de la consulta NUEVA (EXPLAIN ANALYZE):"
PLAN=$(psql_q "EXPLAIN (ANALYZE, BUFFERS, SUMMARY) $Q_NUEVA")
echo "$PLAN" | sed 's/^/  /'
echo "$PLAN" | grep -q "usuarios_sesiones_pkey" && ok "la subconsulta usa la clave primaria (usuarios_sesiones_pkey), no un barrido" || fallo "la subconsulta NO usa usuarios_sesiones_pkey"
echo "Plan de la consulta ANTERIOR:"; psql_q "EXPLAIN (ANALYZE, BUFFERS, SUMMARY) $Q_VIEJA" | sed 's/^/  /'
# Benchmark: 3000 ejecuciones REALES de cada consulta (EXECUTE dentro de un bucle PL/pgSQL; cada vuelta es una
# ejecución completa, sin que el planner pueda agruparlas). Mide solo el lado servidor (sin red).
SQL_BENCH=$(mktemp)
cat > "$SQL_BENCH" <<'EOSQL'
DO $bench$
DECLARE i int; r record; t0 timestamptz; ms_n numeric; ms_v numeric;
BEGIN
  t0 := clock_timestamp();
  FOR i IN 1..3000 LOOP
    EXECUTE 'SELECT id, uuid, username, email, nombre_completo, rol, activo, bloqueado_hasta, ultimo_cambio_password, (SELECT s.revocado = false AND s.usuario_id = usuarios.id FROM usuarios_sesiones s WHERE s.id = $2::integer) AS sesion_vigente FROM usuarios WHERE id = $1' INTO r USING __UID__, __SID__;
  END LOOP;
  ms_n := extract(epoch FROM clock_timestamp() - t0) * 1000;
  t0 := clock_timestamp();
  FOR i IN 1..3000 LOOP
    EXECUTE 'SELECT id, uuid, username, email, nombre_completo, rol, activo, bloqueado_hasta, ultimo_cambio_password FROM usuarios WHERE id = $1' INTO r USING __UID__;
  END LOOP;
  ms_v := extract(epoch FROM clock_timestamp() - t0) * 1000;
  RAISE NOTICE 'BENCH nueva_ms=% anterior_ms=%', round(ms_n, 2), round(ms_v, 2);
END
$bench$;
EOSQL
sed -i "s/__UID__/$U7/g; s/__SID__/$SID_BENCH/g" "$SQL_BENCH"
SALIDA_B=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -f "$SQL_BENCH" 2>&1 | grep 'BENCH')
rm -f "$SQL_BENCH"
MS_N=$(echo "$SALIDA_B" | sed -E 's/.*nueva_ms=([0-9.]+).*/\1/'); MS_V=$(echo "$SALIDA_B" | sed -E 's/.*anterior_ms=([0-9.]+).*/\1/')
echo "3000 ejecuciones reales de cada consulta: nueva ${MS_N} ms (=$(awk -v a="$MS_N" 'BEGIN{printf "%.4f", a/3000}') ms c/u) · anterior ${MS_V} ms (=$(awk -v b="$MS_V" 'BEGIN{printf "%.4f", b/3000}') ms c/u) · diferencia $(awk -v a="$MS_N" -v b="$MS_V" 'BEGIN{printf "%.4f", (a-b)/3000}') ms por petición"
awk -v a="$MS_N" 'BEGIN{exit !(a > 100)}' && ok "el benchmark ejecutó de verdad 3000 consultas (>100 ms en total; antes de esta corrección medía ~1 ms por un artefacto del planner)" || fallo "el benchmark es sospechosamente rápido (${MS_N} ms): no se puede confiar en la medición"
awk -v a="$MS_N" -v b="$MS_V" 'BEGIN{exit !((a-b)/3000 < 0.1)}' && ok "la subconsulta añade < 0,1 ms por petición (a 1 petición/15 s del checklist de Pesaje es despreciable)" || fallo "la subconsulta añade >= 0,1 ms por petición"

# ===========================================================================
seccion "CASO 6 — interruptor de emergencia SINGLE_SESSION_PER_USER=false (A y B conviven)"
# ===========================================================================
PW6=$(gen_valid_password); registrar_secreto "$PW6"; crear_usuario OPERARIO "$PW6"; U6="$NEW_ID"; U6N="$NEW_NAME"
echo "Reiniciando PM2 con SINGLE_SESSION_PER_USER=false (solo en el entorno del proceso; NO se toca ningún .env)…"
SWITCH_TOCADO=1
( bash -c 'source ~/.nvm/nvm.sh >/dev/null 2>&1; SINGLE_SESSION_PER_USER=false pm2 restart "'"$PM2_NAME"'" --update-env >/dev/null 2>&1' )
esperar_backend && ok "backend arriba con el interruptor en false" || fallo "el backend no volvió a responder"
echo "Variables SINGLE_SESSION* en PM2 (solo nombres): $(pm2_env_nombres)"
assert_eq "el interruptor quedó definido en el proceso" "$(pm2_env_nombres)" "SINGLE_SESSION_PER_USER"
login "$U6N" "$PW6" 198.51.100.66 "estacion-A6/1.0"; A6A="$ACCESS"; R6A="$REFRESH"
login "$U6N" "$PW6" 198.51.100.67 "estacion-B6/1.0"; A6B="$ACCESS"; R6B="$REFRESH"
assert_eq "dos logins del mismo usuario => 2 sesiones vivas (conviven)" "$(sesiones_vivas "$U6")" "2"
assert_eq "access de A sigue funcionando => HTTP" "$(call GET /auth/profile "$A6A"; echo $HTTP)" "200"
assert_eq "access de B funciona => HTTP" "$(call GET /auth/profile "$A6B"; echo $HTTP)" "200"
refresh_con "$R6A"; assert_eq "refresh de A funciona => HTTP" "$HTTP" "200"
assert_eq "NO hay SESION_REEMPLAZADA" "$(audit_reemp "$U6")" "0"
assert_eq "el access sigue llevando sid con el interruptor en false" "$([ -n "$(sid_de "$A6A")" ] && echo si || echo no)" "si"
echo "Restaurando el valor por defecto (proceso PM2 recreado desde ecosystem.config.js con el entorno limpio)…"
restaurar_interruptor && ok "backend arriba tras restaurar" || fallo "el backend no volvió a responder tras restaurar"
SWITCH_TOCADO=0
echo "Variables SINGLE_SESSION* en PM2 tras restaurar (solo nombres): $(pm2_env_nombres)"
assert_eq "el interruptor YA NO está definido en el proceso (valor por defecto restaurado)" "$(pm2_env_nombres)" "(ninguna)"
assert_eq "config efectiva tras restaurar" "$(cd "$REPO_ROOT/backend" && run_node -e "console.log(require('./src/config').security.singleSessionPerUser)")" "true"
PW6B=$(gen_valid_password); registrar_secreto "$PW6B"; crear_usuario OPERARIO "$PW6B"; U6B="$NEW_ID"; U6BN="$NEW_NAME"
login "$U6BN" "$PW6B" 198.51.100.68 "estacion-A6b/1.0"; X1="$ACCESS"
login "$U6BN" "$PW6B" 198.51.100.69 "estacion-B6b/1.0"
call GET /auth/profile "$X1"
assert_eq "tras restaurar, la sesión única vuelve a regir (A cae con B) => HTTP|code" "$HTTP|$(code)" "401|SESSION_REPLACED"

echo ""
echo "===================================================="
if [ "$FALLOS" -eq 0 ]; then echo "TODOS LOS CHECKS PASARON"; exit 0; else echo "$FALLOS CHECK(S) FALLARON"; exit 1; fi
