#!/bin/bash
# ============================================================================
# test_error_desconocido_cambio_password.sh
# Script de aceptación — fix del "error desconocido" al cambiar contraseña
# con la cuenta bloqueada.
#
# Causa raíz (ver diagnóstico): backend/src/middleware/errorHandler.js
# declaraba `(err, req, res)` — 3 parámetros. Express solo reconoce
# middleware de errores con exactamente 4 (err, req, res, next); con 3,
# cualquier next(error) en la app cae en la página HTML por defecto de
# Express en vez de nuestro JSON. Esto se reproduce en POST
# /api/auth/change-password cuando el usuario está bloqueado
# (verifyToken lanza AppError vía next(error)).
#
# Este script valida que, tras el fix, la respuesta sea JSON con el
# mensaje correcto — NO HTML — para el usuario bloqueado, y que los otros
# 3 escenarios de change-password sigan funcionando exactamente igual
# (sin tocar lógica de bloqueo/validación).
#
# Manejo de credenciales (ver CLAUDE.md, sección "Manejo de credenciales
# y contraseñas en scripts"): ninguna contraseña es un literal en este
# archivo. Todas se generan en runtime con gen_*_password(), leyendo las
# reglas reales desde backend/src/validators/auth.validator.js (longitud
# mínima y conjunto de caracteres especiales permitidos) en vez de asumir
# valores. Las respuestas HTTP se filtran con jq antes de mostrarse — solo
# se imprimen los campos necesarios para el assert (success/message/
# errors), nunca el body crudo.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   bash scripts/tests/test_error_desconocido_cambio_password.sh
#
# Requiere: psql, curl, jq, node, openssl/tr/fold/shuf. Crea y limpia su
# propio usuario de prueba (no productivo). No toca producción.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
VALIDATOR_FILE="$REPO_ROOT/backend/src/validators/auth.validator.js"
API_URL="${API_URL:-http://localhost:3000/api}"

FALLOS=0
TEST_USERNAME="test_diag_pwd_$$"
TEST_EMAIL="test.diag.pwd.$$@artesa-staging-test.com"
USER_CREADO=0
USER_ID=""

fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }

# Extrae solo los campos relevantes para el assert de una respuesta HTTP —
# nunca se vuelca el body crudo (podría incluir, en un error inesperado,
# el valor de currentPassword/newPassword enviado o tokens de sesión).
print_safe() {
  echo "$1" | jq -c '{success, status, message, errors: (.errors // empty | map({field, message}))}' 2>/dev/null \
    || echo "<respuesta no-JSON omitida por seguridad — ver content-type/status en el assert>"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "FALLO: no se encontró $ENV_FILE"
  exit 1
fi
if [ ! -f "$VALIDATOR_FILE" ]; then
  echo "FALLO: no se encontró $VALIDATOR_FILE"
  exit 1
fi

DB_HOST=$(grep -E '^DB_HOST='     "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep -E '^DB_PORT='     "$ENV_FILE" | cut -d= -f2-)
DB_NAME=$(grep -E '^DB_NAME='     "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep -E '^DB_USER='     "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

psql_q() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"
}

run_node() {
  # Ejecuta node aunque la shell no tenga nvm cargado en PATH.
  if command -v node > /dev/null 2>&1; then
    node "$@"
  else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

cleanup() {
  if [ "$USER_CREADO" = "1" ] && [ -n "$USER_ID" ]; then
    # No se hace DELETE: hay un bug preexistente y NO RELACIONADO en el
    # trigger audit_session_changes() (ver migración 071 — ya corregido,
    # pero un usuario con historial de auditoría igual queda protegido por
    # auditoria_usuario_id_fkey). El usuario de prueba solo se desactiva.
    psql_q "UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username='${TEST_USERNAME}_DEACTIVATED' WHERE id=$USER_ID;" > /dev/null
    echo "[cleanup] usuario de prueba $TEST_USERNAME desactivado (id=$USER_ID)."
  fi
}
trap cleanup EXIT

echo "===================================================="
echo "PRECHECK: errorHandler.js reconocido por Express (4 params)"
echo "===================================================="
ARITY=$(cd "$REPO_ROOT/backend" && run_node -e "console.log(require('./src/middleware/errorHandler').errorHandler.length)")
if [ "$ARITY" = "4" ]; then
  ok "errorHandler tiene aridad 4 — Express lo reconoce como middleware de errores"
else
  fallo "errorHandler tiene aridad $ARITY (se esperaba 4) — Express NO lo reconocerá como middleware de errores"
fi

echo ""
echo "===================================================="
echo "PREP: leer las reglas REALES del validador de contraseña"
echo "(backend/src/validators/auth.validator.js — no se asume nada)"
echo "===================================================="
RULES=$(run_node -e "
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const idx = src.indexOf('changePasswordValidation');
if (idx === -1) { console.error('NO_CHANGE_PASSWORD_VALIDATION'); process.exit(1); }
const block = src.slice(idx, idx + 800);
const minM = block.match(/isLength\(\{\s*min:\s*(\d+)/);
const specM = block.match(/\(\?=\.\*\[([^\]]+)\]\)\[A-Za-z/);
if (!minM || !specM) { console.error('NO_MATCH'); process.exit(1); }
console.log(minM[1] + '|' + specM[1]);
" "$VALIDATOR_FILE")
if [ -z "$RULES" ]; then
  fallo "no se pudieron extraer las reglas reales del validador — abortando (no se puede generar casos válidos a ciegas)"
  exit 1
fi
IFS='|' read -r MIN_LEN SPECIAL_CHARS <<< "$RULES"
ok "reglas leídas del validador real: longitud mínima=$MIN_LEN, especiales permitidos='$SPECIAL_CHARS'"

# --- Generadores de contraseña (ninguna es un literal — todas se arman en runtime) ---
rand_chars() { # $1=cantidad, $2=charset (rango para tr -dc)
  tr -dc "$2" < /dev/urandom | head -c "$1"
}

gen_valid_password() {
  # Cumple TODAS las reglas reales: mayúscula + minúscula + dígito + un
  # especial cualquiera del conjunto permitido (elegido al azar en cada
  # llamada, no fijo). Longitud siempre >= MIN_LEN.
  local upper lower digit special n idx combined
  upper=$(rand_chars 3 'A-Z')
  lower=$(rand_chars 4 'a-z')
  digit=$(rand_chars 3 '0-9')
  n=${#SPECIAL_CHARS}
  idx=$((RANDOM % n))
  special="${SPECIAL_CHARS:$idx:1}"
  combined="${upper}${lower}${digit}${special}"
  echo "$combined" | fold -w1 | shuf | tr -d '\n'
}

gen_password_sin_especial() {
  # Incumple UNA regla puntual (falta el carácter especial), cumpliendo
  # el resto (mayúscula+minúscula+dígito+longitud) — caso de rechazo
  # genérico, no atado a ningún string reportado por un usuario.
  local upper lower digit combined
  upper=$(rand_chars 3 'A-Z')
  lower=$(rand_chars 5 'a-z')
  digit=$(rand_chars 3 '0-9')
  combined="${upper}${lower}${digit}"
  echo "$combined" | fold -w1 | shuf | tr -d '\n'
}

gen_password_generica() {
  # Para usos que no requieren cumplir el validador (ej. "clave actual
  # incorrecta" a propósito) — random puro, sin relación con ninguna regla.
  rand_chars 16 'A-Za-z0-9'
}

TEST_PASSWORD=$(gen_valid_password)
if [ -z "$TEST_PASSWORD" ] || [ "${#TEST_PASSWORD}" -lt "$MIN_LEN" ]; then
  fallo "gen_valid_password produjo un valor inválido (longitud ${#TEST_PASSWORD}, mínimo $MIN_LEN)"
  exit 1
fi
ok "contraseña inicial de prueba generada en runtime (no se imprime su valor)"

echo ""
echo "===================================================="
echo "PREP: crear usuario de prueba no productivo"
echo "===================================================="
# La contraseña se pasa por stdin al proceso de node (no como argumento de
# línea de comandos) para no dejarla visible en `ps` durante el hasheo.
HASH=$(printf '%s' "$TEST_PASSWORD" | run_node -e "
let pw = '';
process.stdin.on('data', d => pw += d);
process.stdin.on('end', () => {
  require('bcrypt').hash(pw, 12).then(h => console.log(h));
});
")
if [ -z "$HASH" ]; then
  fallo "no se pudo generar hash bcrypt de prueba"
  exit 1
fi
TMP_SQL=$(mktemp)
cat > "$TMP_SQL" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password)
VALUES ('$TEST_USERNAME', '$TEST_EMAIL', '$HASH', 'Usuario Prueba Diagnostico Error Desconocido', 'OPERARIO', true, true, 0, NULL, false)
RETURNING id;
EOF
USER_ID=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -f "$TMP_SQL")
rm -f "$TMP_SQL"
if [ -z "$USER_ID" ]; then
  fallo "no se pudo crear el usuario de prueba"
  exit 1
fi
USER_CREADO=1
ok "usuario de prueba creado: $TEST_USERNAME (id=$USER_ID)"

echo ""
echo "===================================================="
echo "ESCENARIO 1: usuario bloqueado + clave actual correcta"
echo "(este es el que reproducía el 'error desconocido')"
echo "===================================================="
LOGIN_RESP=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}")
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.accessToken // empty')
if [ -z "$TOKEN" ]; then
  fallo "no se pudo loguear el usuario de prueba antes de bloquearlo: $(print_safe "$LOGIN_RESP")"
  exit 1
fi
ok "token obtenido antes del bloqueo"

psql_q "UPDATE usuarios SET intentos_fallidos = 4, bloqueado_hasta = NOW() + INTERVAL '30 minutes' WHERE id = $USER_ID;" > /dev/null
ok "usuario bloqueado (intentos_fallidos=4, bloqueado_hasta=+30min)"

NEWPASS_1=$(gen_valid_password)
HTTP1=$(curl -s -o /tmp/esc1_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$TEST_PASSWORD\",\"newPassword\":\"$NEWPASS_1\"}")
CONTENT_TYPE=$(curl -s -o /dev/null -w '%{content_type}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$TEST_PASSWORD\",\"newPassword\":\"$NEWPASS_1\"}")
RESP1=$(cat /tmp/esc1_resp_$$.json)
rm -f /tmp/esc1_resp_$$.json
echo "HTTP $HTTP1 (content-type: $CONTENT_TYPE) :: $(print_safe "$RESP1")"

if [ "$HTTP1" = "403" ]; then ok "status 403 (correcto, coherente con verifyToken)"; else fallo "status $HTTP1 (se esperaba 403)"; fi
if echo "$CONTENT_TYPE" | grep -q 'application/json'; then
  ok "content-type es application/json (antes del fix era text/html)"
else
  fallo "content-type NO es JSON: '$CONTENT_TYPE' — sigue devolviendo HTML"
fi
MSG=$(echo "$RESP1" | jq -r '.message // empty' 2>/dev/null)
if [ "$MSG" = "Usuario bloqueado temporalmente." ]; then
  ok "el body es JSON parseable con el mensaje correcto: '$MSG'"
else
  fallo "el body no es el JSON esperado con message='Usuario bloqueado temporalmente.' (obtenido: $(print_safe "$RESP1"))"
fi

echo ""
echo "===================================================="
echo "ESCENARIO 2: usuario NO bloqueado + clave actual incorrecta (regresión)"
echo "===================================================="
psql_q "UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $USER_ID;" > /dev/null
sleep 1  # evita colisión de refreshToken JWT (mismo {id,iat}) con logins muy seguidos
LOGIN_RESP2=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}")
TOKEN2=$(echo "$LOGIN_RESP2" | jq -r '.data.accessToken // empty')
if [ -z "$TOKEN2" ]; then
  fallo "no se pudo loguear para escenario 2: $(print_safe "$LOGIN_RESP2")"
fi
CLAVE_INCORRECTA=$(gen_password_generica)
NEWPASS_2=$(gen_valid_password)
HTTP2=$(curl -s -o /tmp/esc2_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$CLAVE_INCORRECTA\",\"newPassword\":\"$NEWPASS_2\"}")
RESP2=$(cat /tmp/esc2_resp_$$.json); rm -f /tmp/esc2_resp_$$.json
echo "HTTP $HTTP2 :: $(print_safe "$RESP2")"
MSG2=$(echo "$RESP2" | jq -r '.message // empty' 2>/dev/null)
if [ "$HTTP2" = "400" ] && [ "$MSG2" = "Contraseña actual incorrecta" ]; then
  ok "sin cambios: sigue devolviendo 400 con mensaje claro"
else
  fallo "regresión: esperaba HTTP 400 con 'Contraseña actual incorrecta', obtuvo HTTP $HTTP2 :: $(print_safe "$RESP2")"
fi

echo ""
echo "===================================================="
echo "ESCENARIO 3: usuario NO bloqueado + clave correcta + nueva contraseña"
echo "genérica que SÍ cumple la regla real (mayúscula+minúscula+dígito+"
echo "un especial cualquiera de '$SPECIAL_CHARS') — caso de aceptación"
echo "===================================================="
NEWPASS_3=$(gen_valid_password)
HTTP3=$(curl -s -o /tmp/esc3_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$TEST_PASSWORD\",\"newPassword\":\"$NEWPASS_3\"}")
RESP3=$(cat /tmp/esc3_resp_$$.json); rm -f /tmp/esc3_resp_$$.json
echo "HTTP $HTTP3 :: $(print_safe "$RESP3")"
if [ "$HTTP3" = "200" ] && [ "$(echo "$RESP3" | jq -r '.success')" = "true" ]; then
  ok "sin cambios: una contraseña genérica que cumple la regla real es aceptada"
else
  fallo "regresión: esperaba HTTP 200 success=true, obtuvo HTTP $HTTP3 :: $(print_safe "$RESP3")"
fi

echo ""
echo "===================================================="
echo "ESCENARIO 4: usuario NO bloqueado + clave correcta + nueva contraseña"
echo "genérica SIN carácter especial — incumple esa regla puntual,"
echo "caso de rechazo"
echo "===================================================="
sleep 1
LOGIN_RESP4=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$NEWPASS_3\"}")
TOKEN4=$(echo "$LOGIN_RESP4" | jq -r '.data.accessToken // empty')
if [ -z "$TOKEN4" ]; then
  fallo "no se pudo loguear para escenario 4: $(print_safe "$LOGIN_RESP4")"
fi
NEWPASS_4=$(gen_password_sin_especial)
HTTP4=$(curl -s -o /tmp/esc4_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN4" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$NEWPASS_3\",\"newPassword\":\"$NEWPASS_4\"}")
RESP4=$(cat /tmp/esc4_resp_$$.json); rm -f /tmp/esc4_resp_$$.json
echo "HTTP $HTTP4 :: $(print_safe "$RESP4")"
FIELD4=$(echo "$RESP4" | jq -r '.errors[0].field // empty' 2>/dev/null)
if [ "$HTTP4" = "400" ] && [ "$FIELD4" = "newPassword" ]; then
  ok "sin cambios: sigue rechazando una contraseña sin especial, con mensaje de validación claro"
else
  fallo "regresión: esperaba HTTP 400 con error de campo newPassword, obtuvo HTTP $HTTP4 :: $(print_safe "$RESP4")"
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
