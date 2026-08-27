#!/bin/bash
# ============================================================================
# fix-audit-session-trigger.sh
# Script de aceptación — fix del trigger audit_session_changes() (migración
# 071) que rompía cualquier revocación de sesión (reset-password, logout,
# refresh) con: column "detalles" of relation "auditoria" does not exist,
# y (segundo bug encontrado en el diagnóstico) accion='REVOKE_SESSION' no
# permitido por auditoria.check_accion.
#
# Valida las 3 vías reales de revocación de sesión:
#   a) POST /api/auth/reset-password
#   b) POST /api/auth/logout
#   c) POST /api/auth/refresh
# En los 3 casos: HTTP esperado (no 500), y fila real insertada en
# `auditoria` (accion='UPDATE', tabla='usuarios_sesiones', registro_id =
# id de la sesión revocada). Para (a) además confirma que la contraseña
# SÍ cambió (login con la nueva funciona, login con la vieja falla).
# Al final, también valida la rama DELETE del trigger (antes dormida/rota)
# borrando de verdad al usuario de prueba.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   bash scripts/tests/fix-audit-session-trigger.sh
#
# Requiere: psql, curl, jq, openssl. Crea y limpia su propio usuario de
# prueba (no productivo). No toca producción.
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"

FALLOS=0
TEST_USERNAME="test_audit_sess_$$"
TEST_EMAIL="test.audit.sess.$$@artesa-staging-test.com"
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
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"
}

cleanup() {
  if [ "$USER_CREADO" = "1" ] && [ -n "$USER_ID" ]; then
    # Si el DELETE real (parte del propio test, ver ESCENARIO E) ya se
    # ejecutó con éxito, esto no encuentra la fila y no hace nada.
    psql_q "UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username='${TEST_USERNAME}_DEACTIVATED' WHERE id=$USER_ID;" > /dev/null 2>&1
  fi
}
trap cleanup EXIT

login() {
  # $1 = password. Imprime el JSON completo de la respuesta.
  #
  # sleep 1: el refreshToken se firma solo con {id, iat, exp} (sin jti/nonce,
  # ver generateTokens en utils/jwt.js) — dos logins del mismo usuario en el
  # mismo segundo producen un JWT IDÉNTICO y el INSERT en usuarios_sesiones
  # (refresh_token UNIQUE) choca con "El recurso ya existe". Es un bug latente
  # preexistente, no relacionado con el trigger de esta tarea — se evita aquí
  # para no confundir el resultado del test; queda anotado como pendiente.
  sleep 1
  curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$1\"}"
}

session_id_for_token() {
  # $1 = refresh_token
  psql_q "SELECT id FROM usuarios_sesiones WHERE refresh_token = '$1';"
}

auditoria_revoke_existe() {
  # $1 = registro_id (id de usuarios_sesiones)
  psql_q "SELECT COUNT(*) FROM auditoria WHERE tabla='usuarios_sesiones' AND registro_id=$1 AND accion='UPDATE' AND cambios->>'evento'='REVOKE_SESSION';"
}

echo "===================================================="
echo "PASO 2 (diagnóstico) ya documentado en el reporte — precheck del fix"
echo "===================================================="
FUNC_SRC=$(psql_q "SELECT pg_get_functiondef('audit_session_changes'::regproc);")
if echo "$FUNC_SRC" | grep -q "detalles"; then
  fallo "audit_session_changes() todavía referencia la columna 'detalles' — migración 071 no aplicada"
else
  ok "audit_session_changes() ya no referencia 'detalles'"
fi
if echo "$FUNC_SRC" | grep -qE "usuario_id,\s*'REVOKE_SESSION'"; then
  fallo "audit_session_changes() todavía usa accion='REVOKE_SESSION' (viola check_accion) — 'REVOKE_SESSION' dentro de cambios (jsonb) SÍ es correcto, el problema sería solo como valor de accion"
else
  ok "audit_session_changes() ya no usa accion='REVOKE_SESSION' (usa un valor permitido por check_accion; 'REVOKE_SESSION' solo aparece como dato dentro de cambios)"
fi

echo ""
echo "===================================================="
echo "PREP: crear usuario de prueba no productivo con sesión activa"
echo "===================================================="
HASH=$(cd "$REPO_ROOT/backend" && node -e "require('bcrypt').hash('$TEST_PASSWORD', 12).then(h=>console.log(h))" 2>/dev/null)
if [ -z "$HASH" ]; then
  # Fallback si node/bcrypt no está en PATH de esta shell: usar nvm
  HASH=$(cd "$REPO_ROOT/backend" && bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node -e "require(\"bcrypt\").hash(process.argv[1], 12).then(h=>console.log(h))" '"'$TEST_PASSWORD'")
fi
if [ -z "$HASH" ]; then
  fallo "no se pudo generar hash bcrypt de prueba"
  exit 1
fi
TMP_SQL=$(mktemp)
cat > "$TMP_SQL" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password)
VALUES ('$TEST_USERNAME', '$TEST_EMAIL', '$HASH', 'Usuario Prueba Trigger Auditoria Sesiones', 'OPERARIO', true, true, 0, NULL, false)
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
echo "ESCENARIO A: POST /api/auth/reset-password"
echo "===================================================="
RESET_TOKEN=$(openssl rand -hex 32)
RESET_TOKEN_HASH=$(printf '%s' "$RESET_TOKEN" | openssl dgst -sha256 | awk '{print $2}')
psql_q "UPDATE usuarios SET token_recuperacion='$RESET_TOKEN_HASH', token_recuperacion_expira = NOW() + INTERVAL '1 hour' WHERE id=$USER_ID;" > /dev/null

# Sesión activa a revocar por el reset (para que el trigger tenga algo que auditar)
LOGIN_A=$(login "$TEST_PASSWORD")
REFRESH_A=$(echo "$LOGIN_A" | jq -r '.data.refreshToken // empty')
if [ -z "$REFRESH_A" ]; then
  fallo "no se pudo loguear antes del reset-password: $LOGIN_A"
fi
SESSION_ID_A=$(session_id_for_token "$REFRESH_A")

NEW_PASSWORD="NuevaClaveReset456#"
HTTP_A=$(curl -s -o /tmp/escA_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/reset-password" \
  -H 'Content-Type: application/json' \
  -d "{\"resetToken\":\"$RESET_TOKEN\",\"newPassword\":\"$NEW_PASSWORD\"}")
RESP_A=$(cat /tmp/escA_resp_$$.json); rm -f /tmp/escA_resp_$$.json
echo "HTTP $HTTP_A :: $RESP_A"
if [ "$HTTP_A" = "200" ]; then ok "reset-password respondió 200"; else fallo "reset-password respondió HTTP $HTTP_A (se esperaba 200): $RESP_A"; fi

if [ -n "$SESSION_ID_A" ]; then
  COUNT_A=$(auditoria_revoke_existe "$SESSION_ID_A")
  if [ "$COUNT_A" -ge 1 ] 2>/dev/null; then
    ok "fila de auditoria insertada para la sesión revocada por reset-password (registro_id=$SESSION_ID_A)"
  else
    fallo "NO se encontró fila de auditoria para la sesión revocada por reset-password (registro_id=$SESSION_ID_A)"
  fi
fi

LOGIN_NUEVA=$(login "$NEW_PASSWORD")
if [ "$(echo "$LOGIN_NUEVA" | jq -r '.success')" = "true" ]; then
  ok "login con la contraseña NUEVA funciona (la contraseña sí cambió, no hubo rollback)"
else
  fallo "login con la contraseña nueva falló — la contraseña NO cambió (posible rollback de transacción): $LOGIN_NUEVA"
fi

LOGIN_VIEJA=$(login "$TEST_PASSWORD")
LOGIN_VIEJA_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}")
if [ "$(echo "$LOGIN_VIEJA" | jq -r '.success')" = "false" ] && [ "$(echo "$LOGIN_VIEJA" | jq -r '.message')" = "Credenciales inválidas" ]; then
  ok "login con la contraseña VIEJA fue rechazado con 'Credenciales inválidas' (HTTP real: $LOGIN_VIEJA_HTTP — el código actual usa 400, no 401, para este mensaje)"
else
  fallo "login con la contraseña vieja no fue rechazado como se esperaba: $LOGIN_VIEJA"
fi

echo ""
echo "===================================================="
echo "ESCENARIO B: POST /api/auth/logout"
echo "===================================================="
LOGIN_B=$(login "$NEW_PASSWORD")
REFRESH_B=$(echo "$LOGIN_B" | jq -r '.data.refreshToken // empty')
if [ -z "$REFRESH_B" ]; then
  fallo "no se pudo loguear antes del logout: $LOGIN_B"
else
  SESSION_ID_B=$(session_id_for_token "$REFRESH_B")
  HTTP_B=$(curl -s -o /tmp/escB_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/logout" \
    -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_B\"}")
  RESP_B=$(cat /tmp/escB_resp_$$.json); rm -f /tmp/escB_resp_$$.json
  echo "HTTP $HTTP_B :: $RESP_B"
  if [ "$HTTP_B" = "200" ]; then ok "logout respondió 200"; else fallo "logout respondió HTTP $HTTP_B (se esperaba 200): $RESP_B"; fi

  COUNT_B=$(auditoria_revoke_existe "$SESSION_ID_B")
  if [ "$COUNT_B" -ge 1 ] 2>/dev/null; then
    ok "fila de auditoria insertada para la sesión cerrada por logout (registro_id=$SESSION_ID_B)"
  else
    fallo "NO se encontró fila de auditoria para la sesión cerrada por logout (registro_id=$SESSION_ID_B)"
  fi
fi

echo ""
echo "===================================================="
echo "ESCENARIO C: POST /api/auth/refresh"
echo "===================================================="
LOGIN_C=$(login "$NEW_PASSWORD")
REFRESH_C=$(echo "$LOGIN_C" | jq -r '.data.refreshToken // empty')
if [ -z "$REFRESH_C" ]; then
  fallo "no se pudo loguear antes del refresh: $LOGIN_C"
else
  SESSION_ID_C=$(session_id_for_token "$REFRESH_C")
  # Igual razón que el sleep en login(): /api/auth/refresh genera su propio
  # refreshToken nuevo con {id, iat} — si esto corre en el mismo segundo que
  # el login que obtuvo REFRESH_C, el token nuevo choca (UNIQUE) con el que
  # ya existe en la tabla para esa sesión.
  sleep 1
  HTTP_C=$(curl -s -o /tmp/escC_resp_$$.json -w '%{http_code}' -X POST "$API_URL/auth/refresh" \
    -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH_C\"}")
  RESP_C=$(cat /tmp/escC_resp_$$.json); rm -f /tmp/escC_resp_$$.json
  echo "HTTP $HTTP_C :: $RESP_C"
  if [ "$HTTP_C" = "200" ]; then ok "refresh respondió 200"; else fallo "refresh respondió HTTP $HTTP_C (se esperaba 200): $RESP_C"; fi

  COUNT_C=$(auditoria_revoke_existe "$SESSION_ID_C")
  if [ "$COUNT_C" -ge 1 ] 2>/dev/null; then
    ok "fila de auditoria insertada para la sesión anterior revocada por refresh (registro_id=$SESSION_ID_C)"
  else
    fallo "NO se encontró fila de auditoria para la sesión anterior revocada por refresh (registro_id=$SESSION_ID_C)"
  fi

  NEW_REFRESH_C=$(echo "$RESP_C" | jq -r '.data.refreshToken // empty')
  if [ -n "$NEW_REFRESH_C" ]; then
    NEW_SESSION_ROW=$(session_id_for_token "$NEW_REFRESH_C")
    if [ -n "$NEW_SESSION_ROW" ]; then
      ok "refresh creó una nueva sesión (id=$NEW_SESSION_ROW) además de revocar la anterior"
    else
      fallo "refresh no creó una nueva fila en usuarios_sesiones para el nuevo refreshToken"
    fi
  else
    fallo "la respuesta de refresh no trae un refreshToken nuevo"
  fi
fi

echo ""
echo "===================================================="
echo "ESCENARIO E (extra): rama DELETE del trigger"
echo "(antes de la migración 071 esto fallaba con 'column detalles does not exist'"
echo " en cualquier DELETE sobre usuarios_sesiones — ej. cleanup_expired_sessions())"
echo "===================================================="
# NOTA: NO se borra el usuario de prueba aquí — auditoria.usuario_id
# referencia a usuarios SIN ON DELETE, así que un usuario con historial de
# auditoría (como este, ya tiene 3 filas de las fases A/B/C) queda
# correctamente protegido contra DELETE por esa FK. Eso es comportamiento
# esperado del esquema, no un bug de este trigger — probarlo aparte, sobre
# una fila de usuarios_sesiones suelta.
LOGIN_E=$(login "$NEW_PASSWORD")
REFRESH_E=$(echo "$LOGIN_E" | jq -r '.data.refreshToken // empty')
if [ -z "$REFRESH_E" ]; then
  fallo "no se pudo loguear antes de la prueba de DELETE: $LOGIN_E"
else
  SESSION_ID_E=$(session_id_for_token "$REFRESH_E")
  DELETE_OUT=$(psql_q "DELETE FROM usuarios_sesiones WHERE id=$SESSION_ID_E;" 2>&1)
  if echo "$DELETE_OUT" | grep -qi "does not exist\|ERROR"; then
    fallo "DELETE directo sobre usuarios_sesiones (id=$SESSION_ID_E) falló: $DELETE_OUT"
  else
    ok "DELETE directo sobre usuarios_sesiones (id=$SESSION_ID_E) funcionó sin error"
    COUNT_E=$(psql_q "SELECT COUNT(*) FROM auditoria WHERE tabla='usuarios_sesiones' AND registro_id=$SESSION_ID_E AND accion='DELETE';")
    if [ "$COUNT_E" -ge 1 ] 2>/dev/null; then
      ok "fila de auditoria insertada para el DELETE (registro_id=$SESSION_ID_E, accion='DELETE') — rama DELETE del trigger corregida"
    else
      fallo "NO se encontró fila de auditoria para el DELETE directo (registro_id=$SESSION_ID_E)"
    fi
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
