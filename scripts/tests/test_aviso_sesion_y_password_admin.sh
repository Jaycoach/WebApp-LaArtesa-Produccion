#!/bin/bash
# ============================================================================
# test_aviso_sesion_y_password_admin.sh
# Script de aceptación — (1) MOTIVO del cierre de sesión en el 401 SESSION_REPLACED y
# (2) CONTRASEÑAS: solo ADMIN las restablece/cambia; el cambio obligatorio (alta, temporal,
# vencimiento) sigue funcionando para todos los roles.
#
# Casos:
#   M)  motivo del 401: OTRO_INICIO (login A y luego B), CAMBIO_PASSWORD (reset por admin),
#       SESION_CERRADA (token sin sid, sid inexistente, revocación masiva); code SESSION_REPLACED
#       siempre; las peticiones válidas y los demás 401 NO cambian.
#   P1) POST /users/:id/reset-password: ADMIN => 200; SUPERVISOR/OPERARIO/CALIDAD/AUDITOR => 403 y la
#       cuenta objetivo NO cambia. /users/:id/unlock sigue abierto a supervisor.
#   P2) tras el reset: debe_cambiar_password=true, sesiones revocadas, desbloqueado, auditoría
#       RESET_PASSWORD_ADMIN que dice "temporal" y sin secretos. La sesión vieja recibe CAMBIO_PASSWORD.
#   P3) cambio obligatorio TEMPORAL: login con la temporal => debe_cambiar_password + motivo TEMPORAL;
#       el backend NO deja usar la app (403 PASSWORD_CHANGE_REQUIRED) hasta cambiarla; no se puede reutilizar
#       la temporal; al cambiar: debe=false, ultimo_cambio_password=ahora, historial, auditoría
#       CAMBIO_OBLIGATORIO_TEMPORAL; después entra normal y su sesión sigue viva.
#   P4) /auth/change-password: no admin => 403 (la contraseña NO cambia); ADMIN => 200.
#   P5) VENCIMIENTO (>3 meses) con un usuario NO admin: el login lo obliga (motivo VENCIMIENTO); el cambio
#       funciona aunque /auth/change-password sea solo admin; ultimo_cambio_password=ahora; sesión viva.
#   P6) ALTA: debe_cambiar_password de un usuario nuevo => motivo ALTA y auditoría CAMBIO_OBLIGATORIO_ALTA.
#
# Credenciales: nada literal; se generan en runtime con las reglas REALES del validador. Los cuerpos HTTP
# se arman por stdin y la salida se filtra con jq (nunca se imprime un body crudo ni un token).
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):  bash scripts/tests/test_aviso_sesion_y_password_admin.sh
# Requiere: psql, curl, jq, node. Crea y desactiva sus propios usuarios de prueba.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
VALIDATOR_FILE="$REPO_ROOT/backend/src/validators/auth.validator.js"
API_URL="${API_URL:-http://localhost:3000/api}"
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
crear_usuario() { # rol password [debe_cambiar] [ultimo_cambio_sql]
  local rol="$1" pw="$2" deb="${3:-false}" ult="${4:-CURRENT_TIMESTAMP}" hash uname tmp id
  hash=$(hash_password "$pw"); uname="test_avp_${rol,,}_$$_${RANDOM}"; tmp=$(mktemp)
  cat > "$tmp" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password, ultimo_cambio_password)
VALUES ('$uname', '$uname@artesa-staging-test.com', '$hash', 'Usuario Prueba Aviso $rol', '$rol', true, true, 0, NULL, $deb, $ult)
RETURNING id;
EOF
  id=$(psql_file "$tmp"); rm -f "$tmp"; TEST_USER_IDS+=("$id"); NEW_ID="$id"; NEW_NAME="$uname"
}

HTTP=""; BODY_JSON=""; REQ_BODY=""; IPN=10
call() { # METHOD PATH [TOKEN]
  local m="$1" p="$2" tok="${3:-}"; IPN=$((IPN+1))
  local args=(-s -o "$RESP_FILE" -w '%{http_code}' -X "$m" "$API_URL$p" -H 'Content-Type: application/json' -H "X-Real-IP: 198.51.100.$IPN" -H "User-Agent: acceptance-test/1.0")
  [ -n "$tok" ] && args+=(-H "Authorization: Bearer $tok")
  HTTP=$(printf '%s' "${REQ_BODY:-}" | curl "${args[@]}" --data-binary @-); BODY_JSON=$(cat "$RESP_FILE"); REQ_BODY=""
}
msg()    { echo "$BODY_JSON" | jq -r '.message // empty' 2>/dev/null; }
code()   { echo "$BODY_JSON" | jq -r '.code // empty' 2>/dev/null; }
motivo() { echo "$BODY_JSON" | jq -r '.motivo // empty' 2>/dev/null; }
print_safe() { echo "$BODY_JSON" | jq -c '{success, status, message, code, motivo}' 2>/dev/null || echo "<no-JSON omitido>"; }
ACCESS=""; REFRESH=""
login() { # user pass
  REQ_BODY=$(U="$1" P="$2" jq -n '{username:env.U,password:env.P}'); call POST /auth/login ""
  ACCESS=$(echo "$BODY_JSON" | jq -r '.data.accessToken // empty' 2>/dev/null); REFRESH=$(echo "$BODY_JSON" | jq -r '.data.refreshToken // empty' 2>/dev/null)
  [ -n "$ACCESS" ] && registrar_secreto "$ACCESS"; [ -n "$REFRESH" ] && registrar_secreto "$REFRESH"
}
firmar_access() { # user_id [sid] -> token firmado con el secreto REAL (no se imprime)
  ( cd "$REPO_ROOT/backend" && U_ID="$1" S_ID="${2:-}" run_node -e "
const jwt=require('jsonwebtoken');const c=require('./src/config');
const p={id:Number(process.env.U_ID),username:'t',email:'t@x.test',rol:'OPERARIO'};
if(process.env.S_ID)p.sid=Number(process.env.S_ID);
process.stdout.write(jwt.sign(p,c.jwt.secret,{expiresIn:'10m',jwtid:require('crypto').randomUUID()}));" )
}
sesiones_vivas() { psql_q "SELECT count(*) FROM usuarios_sesiones WHERE usuario_id=$1 AND revocado=false;"; }
campo() { psql_q "SELECT $1 FROM usuarios WHERE id=$2;"; }
audit_n() { psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$1 AND motivo LIKE '$2%';"; }

seccion "PRECHECK"
[ "$(curl -s -o /dev/null -w '%{http_code}' "${API_URL%/api}/health")" = "200" ] && ok "backend responde" || { fallo "backend NO responde"; exit 1; }

# ===========================================================================
seccion "M — motivo del cierre de sesión en el 401 SESSION_REPLACED"
# ===========================================================================
PWM=$(gen_valid_password); registrar_secreto "$PWM"
crear_usuario OPERARIO "$PWM"; UM="$NEW_ID"; UMN="$NEW_NAME"
PWADM=$(gen_valid_password); registrar_secreto "$PWADM"
crear_usuario ADMIN "$PWADM"; ADM="$NEW_ID"; ADMN="$NEW_NAME"

echo "-- M1) OTRO_INICIO: login A y luego login B del mismo usuario"
login "$UMN" "$PWM"; AA="$ACCESS"
assert_eq "access de A funciona antes del login B => HTTP" "$(call GET /auth/profile "$AA"; echo $HTTP)" "200"
call GET /auth/profile "$AA"; echo "respuesta 200 válida (sin motivo): motivo='$(motivo)'"; assert_eq "una petición válida NO trae motivo" "$(motivo)" ""
sleep 1; login "$UMN" "$PWM"; AB="$ACCESS"
call GET /auth/profile "$AA"; echo "access de A tras el login B => HTTP $HTTP :: $(print_safe)"
assert_eq "A => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401|SESSION_REPLACED|OTRO_INICIO"
assert_eq "B sigue funcionando => HTTP" "$(call GET /auth/profile "$AB"; echo $HTTP)" "200"

echo "-- M2) CAMBIO_PASSWORD: reset por admin"
login "$ADMN" "$PWADM"; ADM_TOKEN="$ACCESS"
PWM2=$(gen_valid_password); registrar_secreto "$PWM2"
sleep 1
REQ_BODY=$(P="$PWM2" jq -n '{newPassword:env.P}'); call POST "/users/$UM/reset-password" "$ADM_TOKEN"
assert_eq "admin resetea la clave de UM => HTTP" "$HTTP" "200"
call GET /auth/profile "$AB"; echo "sesión de UM tras el reset => HTTP $HTTP :: $(print_safe)"
assert_eq "UM => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401|SESSION_REPLACED|CAMBIO_PASSWORD"

echo "-- M3) SESION_CERRADA: token sin sid, sid inexistente"
SIN_SID=$(firmar_access "$UM"); registrar_secreto "$SIN_SID"
call GET /auth/profile "$SIN_SID"; echo "token sin sid => HTTP $HTTP :: $(print_safe)"
assert_eq "token sin sid => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401|SESSION_REPLACED|SESION_CERRADA"
FALSO=$(firmar_access "$UM" 999999999); registrar_secreto "$FALSO"
call GET /auth/profile "$FALSO"
assert_eq "sid inexistente => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401|SESSION_REPLACED|SESION_CERRADA"

echo "-- M4) SESION_CERRADA: revocación masiva por SQL (usuario de prueba)"
PWM3=$(gen_valid_password); registrar_secreto "$PWM3"; crear_usuario OPERARIO "$PWM3"; UR="$NEW_ID"; URN="$NEW_NAME"
login "$URN" "$PWM3"; AR="$ACCESS"
echo "SELECT previo (filas que se van a revocar):"; psql_tab "SELECT id, usuario_id, revocado FROM usuarios_sesiones WHERE usuario_id=$UR AND revocado=false;"
psql_q "UPDATE usuarios_sesiones SET revocado=true WHERE usuario_id=$UR AND revocado=false;" > /dev/null
call GET /auth/profile "$AR"; echo "revocación masiva => HTTP $HTTP :: $(print_safe)"
assert_eq "revocación masiva => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401|SESSION_REPLACED|SESION_CERRADA"

echo "-- M5) los demás 401 NO cambian (sin code ni motivo)"
call GET /auth/profile ""; echo "sin token => HTTP $HTTP :: $(print_safe)"
assert_eq "sin token => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401||"
assert_eq "sin token => mensaje" "$(msg)" "No autenticado. Por favor inicie sesión."
call GET /auth/profile "token-basura-$(rand_chars 8 'a-z')"; assert_eq "token inválido => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401||"

# ===========================================================================
seccion "P1/P2 — reset-password SOLO ADMIN; clave temporal"
# ===========================================================================
PWT=$(gen_valid_password); registrar_secreto "$PWT"
crear_usuario OPERARIO "$PWT"; TG="$NEW_ID"; TGN="$NEW_NAME"
psql_q "UPDATE usuarios SET intentos_fallidos=5, bloqueado_hasta=NOW() + INTERVAL '30 minutes' WHERE id=$TG;" > /dev/null
HASH_ANTES=$(campo "md5(password_hash)" "$TG")
declare -A TOK
for R in SUPERVISOR OPERARIO CALIDAD AUDITOR; do
  PWR=$(gen_valid_password); registrar_secreto "$PWR"; crear_usuario "$R" "$PWR"; RID="$NEW_ID"; RN="$NEW_NAME"
  login "$RN" "$PWR"; TOK[$R]="$ACCESS"
  NP=$(gen_valid_password); registrar_secreto "$NP"
  REQ_BODY=$(P="$NP" jq -n '{newPassword:env.P}'); call POST "/users/$TG/reset-password" "${TOK[$R]}"
  echo "$R intenta reset => HTTP $HTTP :: $(print_safe)"
  assert_eq "$R reset-password => HTTP" "$HTTP" "403"
done
assert_eq "tras los 403 la contraseña de la cuenta objetivo NO cambió" "$(campo "md5(password_hash)" "$TG")" "$HASH_ANTES"
assert_eq "tras los 403 sigue bloqueada (no se desbloqueó)" "$(campo "bloqueado_hasta IS NOT NULL" "$TG")" "t"
assert_eq "tras los 403 debe_cambiar_password sigue false" "$(campo debe_cambiar_password "$TG")" "f"

echo "-- /unlock NO cambia: supervisor sigue pudiendo desbloquear"
call POST "/users/$TG/unlock" "${TOK[SUPERVISOR]}"; assert_eq "SUPERVISOR unlock => HTTP" "$HTTP" "200"
psql_q "UPDATE usuarios SET intentos_fallidos=5, bloqueado_hasta=NOW() + INTERVAL '30 minutes' WHERE id=$TG;" > /dev/null

login "$TGN" "$PWT" > /dev/null; ACCESS_TG_ANTES=""   # bloqueado: el login falla (esperado)
psql_q "UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=$TG;" > /dev/null
login "$TGN" "$PWT"; TG_OLD="$ACCESS"; assert_eq "TG entra con su clave (sesión previa al reset) => HTTP" "$HTTP" "200"
psql_q "UPDATE usuarios SET intentos_fallidos=5, bloqueado_hasta=NOW() + INTERVAL '30 minutes' WHERE id=$TG;" > /dev/null
sleep 1

echo "-- ADMIN con clave débil => 400, sin cambios"
REQ_BODY=$(P="abc" jq -n '{newPassword:env.P}'); call POST "/users/$TG/reset-password" "$ADM_TOKEN"; assert_eq "clave débil => HTTP" "$HTTP" "400"
assert_eq "la contraseña no cambió" "$(campo "md5(password_hash)" "$TG")" "$HASH_ANTES"

TEMP=$(gen_valid_password); registrar_secreto "$TEMP"
REQ_BODY=$(P="$TEMP" jq -n '{newPassword:env.P}'); call POST "/users/$TG/reset-password" "$ADM_TOKEN"
echo "ADMIN reset => HTTP $HTTP :: $(print_safe)"; assert_eq "ADMIN reset-password => HTTP" "$HTTP" "200"
echo "Estado de la cuenta tras el reset:"
psql_tab "SELECT debe_cambiar_password, intentos_fallidos, bloqueado_hasta IS NULL AS desbloqueado, (ultimo_cambio_password > NOW() - INTERVAL '1 minute') AS clave_reciente, (SELECT count(*) FROM usuarios_sesiones s WHERE s.usuario_id=usuarios.id AND s.revocado=false) AS sesiones_vivas FROM usuarios WHERE id=$TG;"
assert_eq "debe_cambiar_password" "$(campo debe_cambiar_password "$TG")" "t"
assert_eq "desbloqueada (bloqueado_hasta NULL)" "$(campo "bloqueado_hasta IS NULL" "$TG")" "t"
assert_eq "intentos_fallidos" "$(campo intentos_fallidos "$TG")" "0"
assert_eq "sesiones vivas" "$(sesiones_vivas "$TG")" "0"
assert_eq "historial de contraseñas tiene la anterior" "$(psql_q "SELECT count(*) FROM usuarios_historial_passwords WHERE usuario_id=$TG;")" "1"
echo "Auditoría RESET_PASSWORD_ADMIN (motivo y claves del jsonb, sin valores sensibles):"
psql_tab "SELECT motivo, usuario_nombre, jsonb_object_keys(datos_nuevos) AS clave FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$TG AND motivo LIKE 'RESET_PASSWORD_ADMIN%' ORDER BY id DESC LIMIT 6;"
assert_eq "auditoría RESET_PASSWORD_ADMIN dice que quedó temporal" "$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE tabla='usuarios' AND registro_id=$TG AND motivo LIKE 'RESET_PASSWORD_ADMIN%' AND motivo ILIKE '%temporal%' AND (datos_nuevos->>'temporal')='true';")" "1"
assert_eq "auditoría sin secretos (ni hash, ni JWT, ni la clave en claro)" "$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE registro_id=$TG AND tabla='usuarios' AND (datos_nuevos::text ~ '(\\\$2[aby]\\\$|eyJ)' OR motivo ~ '(\\\$2[aby]\\\$|eyJ)' OR datos_nuevos::text LIKE '%$TEMP%' OR motivo LIKE '%$TEMP%');")" "0"
call GET /auth/profile "$TG_OLD"; echo "sesión previa de TG => HTTP $HTTP :: $(print_safe)"
assert_eq "sesión previa de TG => HTTP|code|motivo" "$HTTP|$(code)|$(motivo)" "401|SESSION_REPLACED|CAMBIO_PASSWORD"

# ===========================================================================
seccion "P3 — cambio obligatorio TEMPORAL"
# ===========================================================================
login "$TGN" "$TEMP"; TG_TMP="$ACCESS"
echo "login con la temporal => HTTP $HTTP :: $(echo "$BODY_JSON" | jq -c '{success, debe: .data.user.debe_cambiar_password, motivo: .data.user.motivo_cambio_password}')"
assert_eq "login con la temporal => HTTP" "$HTTP" "200"
assert_eq "login devuelve debe_cambiar_password" "$(echo "$BODY_JSON" | jq -r '.data.user.debe_cambiar_password')" "true"
assert_eq "login devuelve motivo_cambio_password" "$(echo "$BODY_JSON" | jq -r '.data.user.motivo_cambio_password')" "TEMPORAL"
call GET /auth/profile "$TG_TMP"; echo "usar la app con la temporal => HTTP $HTTP :: $(print_safe)"
assert_eq "el backend bloquea la app hasta cambiar la clave => HTTP|code" "$HTTP|$(code)" "403|PASSWORD_CHANGE_REQUIRED"
REQ_BODY=$(P="$TEMP" jq -n '{newPassword:env.P}'); call POST /auth/set-initial-password "$TG_TMP"
echo "reutilizar la temporal => HTTP $HTTP :: $(print_safe)"
assert_eq "no puede reutilizar la temporal => HTTP" "$HTTP" "400"
assert_eq "no puede reutilizar la temporal => mensaje" "$(msg)" "No puedes reutilizar una de tus últimas 3 contraseñas"
assert_eq "tras el rechazo sigue obligado a cambiar" "$(campo debe_cambiar_password "$TG")" "t"
NUEVA=$(gen_valid_password); registrar_secreto "$NUEVA"
REQ_BODY=$(P="$NUEVA" jq -n '{newPassword:env.P}'); call POST /auth/set-initial-password "$TG_TMP"
echo "cambio obligatorio => HTTP $HTTP :: $(print_safe)"; assert_eq "cambio obligatorio => HTTP" "$HTTP" "200"
psql_tab "SELECT debe_cambiar_password, (ultimo_cambio_password > NOW() - INTERVAL '1 minute') AS clave_reciente FROM usuarios WHERE id=$TG;"
assert_eq "debe_cambiar_password=false" "$(campo debe_cambiar_password "$TG")" "f"
assert_eq "ultimo_cambio_password = ahora" "$(campo "ultimo_cambio_password > NOW() - INTERVAL '1 minute'" "$TG")" "t"
assert_eq "historial guarda la temporal (anterior)" "$(psql_q "SELECT count(*) FROM usuarios_historial_passwords WHERE usuario_id=$TG;")" "2"
assert_eq "auditoría CAMBIO_OBLIGATORIO_TEMPORAL" "$(audit_n "$TG" CAMBIO_OBLIGATORIO_TEMPORAL)" "1"
assert_eq "auditoría sin secretos" "$(psql_q "SELECT count(*) FROM auditoria_cambios WHERE registro_id=$TG AND tabla='usuarios' AND motivo LIKE 'CAMBIO_OBLIGATORIO%' AND (datos_nuevos::text ~ '(\\\$2[aby]\\\$|eyJ)' OR datos_nuevos::text LIKE '%$NUEVA%' OR motivo LIKE '%$NUEVA%');")" "0"
login "$TGN" "$TEMP"; assert_eq "la temporal ya no sirve para entrar => HTTP" "$HTTP" "400"
login "$TGN" "$NUEVA"; TG_OK="$ACCESS"; TG_REF="$REFRESH"
assert_eq "entra con la nueva => HTTP" "$HTTP" "200"
assert_eq "ya no se le obliga a cambiar (debe_cambiar_password en la respuesta)" "$(echo "$BODY_JSON" | jq -r '.data.user.debe_cambiar_password')" "false"
call GET /auth/profile "$TG_OK"; assert_eq "su sesión funciona al instante => HTTP" "$HTTP" "200"
sleep 2; call GET /auth/profile "$TG_OK"; assert_eq "y 2 s después sigue viva (no expulsada por el chequeo de iat) => HTTP" "$HTTP" "200"
REQ_BODY=$(R="$TG_REF" jq -n '{refreshToken:env.R}'); call POST /auth/refresh ""; assert_eq "su refresh funciona => HTTP" "$HTTP" "200"
assert_eq "una sola sesión viva" "$(sesiones_vivas "$TG")" "1"

# ===========================================================================
seccion "P4 — /auth/change-password solo ADMIN"
# ===========================================================================
for R in SUPERVISOR OPERARIO CALIDAD AUDITOR; do
  NP=$(gen_valid_password); registrar_secreto "$NP"
  REQ_BODY=$(C="x" N="$NP" jq -n '{currentPassword:env.C,newPassword:env.N}'); call POST /auth/change-password "${TOK[$R]}"
  echo "$R change-password => HTTP $HTTP :: $(print_safe)"
  assert_eq "$R change-password => HTTP" "$HTTP" "403"
done
login "$ADMN" "$PWADM"; ADM_TOKEN="$ACCESS"; ADM_REF="$REFRESH"
NPA=$(gen_valid_password); registrar_secreto "$NPA"
REQ_BODY=$(C="$PWADM" N="$NPA" R="$ADM_REF" jq -n '{currentPassword:env.C,newPassword:env.N,refreshToken:env.R}'); call POST /auth/change-password "$ADM_TOKEN"
echo "ADMIN change-password => HTTP $HTTP :: $(print_safe)"; assert_eq "ADMIN change-password => HTTP" "$HTTP" "200"
login "$ADMN" "$NPA"; assert_eq "ADMIN entra con la nueva => HTTP" "$HTTP" "200"

# ===========================================================================
seccion "P5 — VENCIMIENTO (>3 meses) de un usuario NO admin"
# ===========================================================================
PWV=$(gen_valid_password); registrar_secreto "$PWV"
crear_usuario OPERARIO "$PWV"; UV="$NEW_ID"; UVN="$NEW_NAME"
echo "SELECT previo:"; psql_tab "SELECT id, rol, debe_cambiar_password, ultimo_cambio_password FROM usuarios WHERE id=$UV;"
psql_q "UPDATE usuarios SET ultimo_cambio_password = NOW() - INTERVAL '4 months' WHERE id=$UV;" > /dev/null
login "$UVN" "$PWV"; UV_TOK="$ACCESS"
echo "login con clave vencida => HTTP $HTTP :: $(echo "$BODY_JSON" | jq -c '{debe: .data.user.debe_cambiar_password, motivo: .data.user.motivo_cambio_password}')"
assert_eq "login (vencida) => debe_cambiar_password" "$(echo "$BODY_JSON" | jq -r '.data.user.debe_cambiar_password')" "true"
assert_eq "login (vencida) => motivo" "$(echo "$BODY_JSON" | jq -r '.data.user.motivo_cambio_password')" "VENCIMIENTO"
call GET /auth/profile "$UV_TOK"; assert_eq "obligado: la app no se puede usar => HTTP|code" "$HTTP|$(code)" "403|PASSWORD_CHANGE_REQUIRED"
REQ_BODY=$(C="$PWV" N="$(gen_valid_password)" jq -n '{currentPassword:env.C,newPassword:env.N}'); call POST /auth/change-password "$UV_TOK"
assert_eq "/auth/change-password (solo admin) => 403 para el no admin" "$HTTP" "403"
NV=$(gen_valid_password); registrar_secreto "$NV"
REQ_BODY=$(P="$NV" jq -n '{newPassword:env.P}'); call POST /auth/set-initial-password "$UV_TOK"
echo "cambio obligatorio por vencimiento (no admin) => HTTP $HTTP :: $(print_safe)"; assert_eq "set-initial-password funciona para el no admin => HTTP" "$HTTP" "200"
psql_tab "SELECT debe_cambiar_password, (ultimo_cambio_password > NOW() - INTERVAL '1 minute') AS clave_reciente FROM usuarios WHERE id=$UV;"
assert_eq "debe_cambiar_password=false" "$(campo debe_cambiar_password "$UV")" "f"
assert_eq "ultimo_cambio_password = ahora (reinicia el conteo de 3 meses)" "$(campo "ultimo_cambio_password > NOW() - INTERVAL '1 minute'" "$UV")" "t"
assert_eq "auditoría CAMBIO_OBLIGATORIO_VENCIMIENTO" "$(audit_n "$UV" CAMBIO_OBLIGATORIO_VENCIMIENTO)" "1"
login "$UVN" "$NV"; UV_OK="$ACCESS"
assert_eq "entra normal después => debe_cambiar_password" "$(echo "$BODY_JSON" | jq -r '.data.user.debe_cambiar_password')" "false"
call GET /auth/profile "$UV_OK"; assert_eq "su sesión funciona => HTTP" "$HTTP" "200"
sleep 2; call GET /auth/profile "$UV_OK"; assert_eq "2 s después no se expulsa => HTTP" "$HTTP" "200"
echo "mismo usuario reingresa: (sin 'password_expirada' ahora)"; login "$UVN" "$NV"; assert_eq "segundo login normal => debe_cambiar_password" "$(echo "$BODY_JSON" | jq -r '.data.user.debe_cambiar_password')" "false"

# ===========================================================================
seccion "P6 — ALTA (usuario nuevo con debe_cambiar_password)"
# ===========================================================================
PWN=$(gen_valid_password); registrar_secreto "$PWN"
crear_usuario CALIDAD "$PWN" true; UN="$NEW_ID"; UNN="$NEW_NAME"
login "$UNN" "$PWN"; UN_TOK="$ACCESS"
assert_eq "login (alta) => motivo" "$(echo "$BODY_JSON" | jq -r '.data.user.motivo_cambio_password')" "ALTA"
NN=$(gen_valid_password); registrar_secreto "$NN"
REQ_BODY=$(P="$NN" jq -n '{newPassword:env.P}'); call POST /auth/set-initial-password "$UN_TOK"; assert_eq "alta: establecer contraseña => HTTP" "$HTTP" "200"
assert_eq "auditoría CAMBIO_OBLIGATORIO_ALTA" "$(audit_n "$UN" CAMBIO_OBLIGATORIO_ALTA)" "1"
login "$UNN" "$NN"; call GET /auth/profile "$ACCESS"; assert_eq "entra normal tras el alta => HTTP" "$HTTP" "200"

# ===========================================================================
seccion "RESUMEN"
# ===========================================================================
if [ "$FALLOS" -eq 0 ]; then echo "TODAS LAS ASERCIONES PASARON"; exit 0; else echo "FALLARON $FALLOS ASERCIONES"; exit 1; fi
