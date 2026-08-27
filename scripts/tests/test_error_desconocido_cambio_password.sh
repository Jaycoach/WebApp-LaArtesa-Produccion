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
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   bash scripts/tests/test_error_desconocido_cambio_password.sh
#
# Requiere: psql, curl, jq. Crea y limpia su propio usuario de prueba
# (no productivo). No toca producción.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"

FALLOS=0
TEST_USERNAME="test_diag_pwd_$$"
TEST_EMAIL="test.diag.pwd.$$@artesa-staging-test.com"
TEST_PASSWORD="TestOperario123!"
USER_CREADO=0
USER_ID=""

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

psql_q() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "$1"
}

cleanup() {
  if [ "$USER_CREADO" = "1" ] && [ -n "$USER_ID" ]; then
    # No se hace DELETE: hay un bug preexistente y NO RELACIONADO en el
    # trigger audit_session_changes() (referencia auditoria.detalles, columna
    # que no existe) que rompe el DELETE en cascada sobre usuarios_sesiones.
    # Deliberadamente NO se toca ese trigger aquí (fuera de alcance de esta
    # tarea) — el usuario de prueba solo se desactiva.
    psql_q "UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username='${TEST_USERNAME}_DEACTIVATED' WHERE id=$USER_ID;" > /dev/null
    echo "[cleanup] usuario de prueba $TEST_USERNAME desactivado (id=$USER_ID)."
  fi
}
trap cleanup EXIT

echo "===================================================="
echo "PRECHECK: errorHandler.js reconocido por Express (4 params)"
echo "===================================================="
ARITY=$(cd "$REPO_ROOT/backend" && node -e "console.log(require('./src/middleware/errorHandler').errorHandler.length)")
if [ "$ARITY" = "4" ]; then
  ok "errorHandler tiene aridad 4 — Express lo reconoce como middleware de errores"
else
  fallo "errorHandler tiene aridad $ARITY (se esperaba 4) — Express NO lo reconocerá como middleware de errores"
fi

echo ""
echo "===================================================="
echo "PREP: crear usuario de prueba no productivo"
echo "===================================================="
HASH=$(cd "$REPO_ROOT/backend" && node -e "require('bcrypt').hash('$TEST_PASSWORD', 12).then(h=>console.log(h))")
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
USER_ID=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -f "$TMP_SQL")
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
  fallo "no se pudo loguear el usuario de prueba antes de bloquearlo: $LOGIN_RESP"
  exit 1
fi
ok "token obtenido antes del bloqueo"

psql_q "UPDATE usuarios SET intentos_fallidos = 4, bloqueado_hasta = NOW() + INTERVAL '30 minutes' WHERE id = $USER_ID;" > /dev/null
ok "usuario bloqueado (intentos_fallidos=4, bloqueado_hasta=+30min)"

HTTP1=$(curl -s -o /tmp/esc1_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$TEST_PASSWORD\",\"newPassword\":\"NuevaClave456#\"}")
CONTENT_TYPE=$(curl -s -o /dev/null -w '%{content_type}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"currentPassword\":\"$TEST_PASSWORD\",\"newPassword\":\"NuevaClave456#\"}")
RESP1=$(cat /tmp/esc1_resp_$$.json)
rm -f /tmp/esc1_resp_$$.json
echo "HTTP $HTTP1 (content-type: $CONTENT_TYPE) :: $RESP1"

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
  fallo "el body no es el JSON esperado con message='Usuario bloqueado temporalmente.' (obtenido: '$RESP1')"
fi

echo ""
echo "===================================================="
echo "ESCENARIO 2: usuario NO bloqueado + clave actual incorrecta (regresión)"
echo "===================================================="
psql_q "UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $USER_ID;" > /dev/null
LOGIN_RESP2=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}")
TOKEN2=$(echo "$LOGIN_RESP2" | jq -r '.data.accessToken // empty')
HTTP2=$(curl -s -o /tmp/esc2_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d '{"currentPassword":"ClaveIncorrecta999!","newPassword":"NuevaClave456#"}')
RESP2=$(cat /tmp/esc2_resp_$$.json); rm -f /tmp/esc2_resp_$$.json
echo "HTTP $HTTP2 :: $RESP2"
MSG2=$(echo "$RESP2" | jq -r '.message // empty' 2>/dev/null)
if [ "$HTTP2" = "400" ] && [ "$MSG2" = "Contraseña actual incorrecta" ]; then
  ok "sin cambios: sigue devolviendo 400 con mensaje claro"
else
  fallo "regresión: esperaba HTTP 400 con 'Contraseña actual incorrecta', obtuvo HTTP $HTTP2 :: $RESP2"
fi

echo ""
echo "===================================================="
echo "ESCENARIO 3: usuario NO bloqueado + clave correcta + nueva 'Empaque123*' (regresión)"
echo "===================================================="
HTTP3=$(curl -s -o /tmp/esc3_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN2" -H 'Content-Type: application/json' \
  -d '{"currentPassword":"'"$TEST_PASSWORD"'","newPassword":"Empaque123*"}')
RESP3=$(cat /tmp/esc3_resp_$$.json); rm -f /tmp/esc3_resp_$$.json
echo "HTTP $HTTP3 :: $RESP3"
if [ "$HTTP3" = "200" ] && [ "$(echo "$RESP3" | jq -r '.success')" = "true" ]; then
  ok "sin cambios: 'Empaque123*' sigue siendo aceptada y cambia la contraseña"
else
  fallo "regresión: esperaba HTTP 200 success=true, obtuvo HTTP $HTTP3 :: $RESP3"
fi

echo ""
echo "===================================================="
echo "ESCENARIO 4: usuario NO bloqueado + clave correcta + nueva 'Empaque123' sin asterisco (regresión)"
echo "===================================================="
LOGIN_RESP4=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"Empaque123*\"}")
TOKEN4=$(echo "$LOGIN_RESP4" | jq -r '.data.accessToken // empty')
HTTP4=$(curl -s -o /tmp/esc4_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/change-password" \
  -H "Authorization: Bearer $TOKEN4" -H 'Content-Type: application/json' \
  -d '{"currentPassword":"Empaque123*","newPassword":"Empaque123"}')
RESP4=$(cat /tmp/esc4_resp_$$.json); rm -f /tmp/esc4_resp_$$.json
echo "HTTP $HTTP4 :: $RESP4"
FIELD4=$(echo "$RESP4" | jq -r '.errors[0].field // empty' 2>/dev/null)
if [ "$HTTP4" = "400" ] && [ "$FIELD4" = "newPassword" ]; then
  ok "sin cambios: sigue rechazando 'Empaque123' (sin especial) con mensaje de validación claro"
else
  fallo "regresión: esperaba HTTP 400 con error de campo newPassword, obtuvo HTTP $HTTP4 :: $RESP4"
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
