#!/bin/bash
# ============================================================================
# user_hierarchy_and_full_regression.sh
#
# Script de aceptación — superset que cubre TODA la línea de trabajo de
# auth/sesiones de esta sesión, no solo lo nuevo:
#
#   REGRESIÓN (reusando los scripts ya existentes, no reescritos):
#     - scripts/tests/fix-audit-session-trigger.sh
#       (reset-password / logout / refresh — trigger de auditoría de sesiones)
#     - scripts/tests/test_error_desconocido_cambio_password.sh
#       (4 escenarios de validación de contraseña / error handler)
#
#   NUEVO — jerarquía de roles (ADMIN > SUPERVISOR > OPERARIO/CALIDAD/AUDITOR):
#     - un supervisor NO puede editar/bloquear/desbloquear/resetear password/
#       cambiar rol de un admin (403)
#     - un supervisor NO puede auto-ascenderse a admin, ni ascender a nadie
#       a admin (403) — SÍ puede ascender a alguien inferior a supervisor
#       (mismo rango que él; decisión confirmada, no bloqueada)
#     - un supervisor SÍ puede modificar a un usuario de rango inferior (200)
#     - un admin SÍ puede hacer todas esas operaciones sobre cualquiera,
#       incluido otro admin (200)
#     - protección de "último admin activo": no se puede dejar el sistema
#       sin ningún admin activo (400) — probado de forma aislada y reversible
#
#   NUEVO — visibilidad y desbloqueo:
#     - GET /api/users y GET /api/users/:id devuelven bloqueado_hasta /
#       intentos_fallidos
#     - POST /api/users/:id/unlock limpia el bloqueo (200)
#
# Manejo de credenciales (CLAUDE.md): ninguna contraseña es un literal —
# todas se generan en runtime leyendo las reglas reales del validador.
# Las respuestas HTTP se filtran antes de mostrarse.
#
# Ejecutar EN STAGING, desde la raíz del repo (~/LaArtesa):
#   bash scripts/tests/user_hierarchy_and_full_regression.sh
#
# Requiere: psql, curl, jq, node, openssl/tr/fold/shuf. Crea y limpia sus
# propios usuarios de prueba (no productivos). No toca producción. Toca
# brevemente y de forma reversible el estado `activo` de los admins reales
# de staging (ver ESCENARIO "último admin") — se restaura inmediatamente,
# incluso si el script se interrumpe (trap).
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
VALIDATOR_FILE="$REPO_ROOT/backend/src/validators/auth.validator.js"
API_URL="${API_URL:-http://localhost:3000/api}"

FALLOS=0
fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }

print_safe() {
  echo "$1" | jq -c '{success, status, message}' 2>/dev/null \
    || echo "<respuesta no-JSON omitida por seguridad>"
}

if [ ! -f "$ENV_FILE" ] || [ ! -f "$VALIDATOR_FILE" ]; then
  echo "FALLO: no se encontró .env o auth.validator.js"
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
psql_file() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -f "$1"
}

run_node() {
  if command -v node > /dev/null 2>&1; then node "$@"; else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

# ---- reglas reales del validador (sin hardcodear nada) ----
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
if [ -z "$RULES" ]; then echo "FALLO: no se pudieron extraer las reglas del validador"; exit 1; fi
IFS='|' read -r MIN_LEN SPECIAL_CHARS <<< "$RULES"

rand_chars() { tr -dc "$2" < /dev/urandom | head -c "$1"; }
gen_valid_password() {
  local upper lower digit special n idx
  upper=$(rand_chars 3 'A-Z'); lower=$(rand_chars 4 'a-z'); digit=$(rand_chars 3 '0-9')
  n=${#SPECIAL_CHARS}; idx=$((RANDOM % n)); special="${SPECIAL_CHARS:$idx:1}"
  echo "${upper}${lower}${digit}${special}" | fold -w1 | shuf | tr -d '\n'
}

hash_password() {
  # $1 = password. Por stdin, no como argumento (no queda en `ps`).
  (cd "$REPO_ROOT/backend" && printf '%s' "$1" | run_node -e "
let pw = '';
process.stdin.on('data', d => pw += d);
process.stdin.on('end', () => { require('bcrypt').hash(pw, 12).then(h => console.log(h)); });
")
}

# ---- estado a limpiar / restaurar ----
TEST_USER_IDS=()          # usuarios de prueba a desactivar al final
OTHER_ADMIN_IDS_SNAPSHOT="" # admins reales que se desactivaron temporalmente (último-admin test)

cleanup() {
  if [ -n "$OTHER_ADMIN_IDS_SNAPSHOT" ]; then
    psql_q "UPDATE usuarios SET activo=true WHERE id IN ($OTHER_ADMIN_IDS_SNAPSHOT);" > /dev/null 2>&1
    echo "[cleanup] admins reales restaurados a activo=true: $OTHER_ADMIN_IDS_SNAPSHOT"
  fi
  for id in "${TEST_USER_IDS[@]:-}"; do
    [ -z "$id" ] && continue
    psql_q "UPDATE usuarios SET activo=false, intentos_fallidos=0, bloqueado_hasta=NULL, username=username || '_DEACTIVATED' WHERE id=$id AND username NOT LIKE '%_DEACTIVATED';" > /dev/null 2>&1
  done
  echo "[cleanup] usuarios de prueba desactivados: ${TEST_USER_IDS[*]:-ninguno}"
  rm -f "$CALL_RESP_FILE"
}
trap cleanup EXIT

create_user() {
  # $1=username_prefix $2=rol(ADMIN|SUPERVISOR|OPERARIO) $3=password
  local prefix="$2_$$_${RANDOM}"
  local hash
  hash=$(hash_password "$3")
  local tmp; tmp=$(mktemp)
  cat > "$tmp" <<EOF
INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password)
VALUES ('test_h_${prefix}', 'test.h.${prefix}@artesa-staging-test.com', '$hash', 'Usuario Prueba Jerarquia', '$2', true, true, 0, NULL, false)
RETURNING id;
EOF
  local id; id=$(psql_file "$tmp"); rm -f "$tmp"
  echo "$id"
}

login_token() {
  # $1=username $2=password
  curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r '.data.accessToken // empty'
}

CALL_RESP_FILE="/tmp/hierarchy_test_resp_$$.json"

call() {
  # $1=METHOD $2=PATH $3=TOKEN $4=JSON_BODY(o "") -> imprime "HTTP_CODE"
  #
  # NOTA: esta función casi siempre se invoca como HTTP=$(call ...), es
  # decir, corre en una SUBSHELL — cualquier variable asignada aquí adentro
  # (ej. un LAST_BODY local) se pierde al volver al shell padre. Por eso el
  # body se escribe a un archivo de ruta fija ($CALL_RESP_FILE), no a una
  # variable — leerlo después con `cat "$CALL_RESP_FILE"` sí funciona.
  local method="$1" path="$2" token="$3" body="${4:-}"
  local http
  if [ -n "$body" ]; then
    http=$(curl -s -o "$CALL_RESP_FILE" -w '%{http_code}' -X "$method" "$API_URL$path" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$body")
  else
    http=$(curl -s -o "$CALL_RESP_FILE" -w '%{http_code}' -X "$method" "$API_URL$path" \
      -H "Authorization: Bearer $token")
  fi
  echo "$http"
}

expect() {
  # $1=descripcion $2=http_esperado $3=http_real
  if [ "$2" = "$3" ]; then
    ok "$1 (HTTP $3)"
  else
    fallo "$1 — esperaba HTTP $2, obtuvo HTTP $3 :: $(print_safe "$(cat "$CALL_RESP_FILE" 2>/dev/null)")"
  fi
}

echo "############################################################"
echo "# BLOQUE 1/3 — REGRESIÓN: trigger de auditoría de sesiones"
echo "#   (reset-password / logout / refresh)"
echo "############################################################"
if bash "$REPO_ROOT/scripts/tests/fix-audit-session-trigger.sh"; then
  ok "regresión trigger de auditoría de sesiones: TODOS LOS CHECKS PASARON"
else
  fallo "regresión trigger de auditoría de sesiones FALLÓ — ver salida arriba"
fi

echo ""
echo "############################################################"
echo "# BLOQUE 2/3 — REGRESIÓN: error handler / 4 escenarios de contraseña"
echo "############################################################"
if bash "$REPO_ROOT/scripts/tests/test_error_desconocido_cambio_password.sh"; then
  ok "regresión error handler / validación de contraseña: TODOS LOS CHECKS PASARON"
else
  fallo "regresión error handler / validación de contraseña FALLÓ — ver salida arriba"
fi

echo ""
echo "############################################################"
echo "# BLOQUE 3/3 — NUEVO: jerarquía de roles + visibilidad/desbloqueo"
echo "############################################################"

echo "--- PRECHECK: el frontend sigue trayendo la UI de bloqueo/desbloqueo ---"
# Chequeo liviano sobre el CÓDIGO FUENTE (no el bundle — el hash del build
# cambia en cada deploy). No reemplaza la verificación visual real (ver
# reporte de la tarea con capturas admin/supervisor) — solo evita que un
# refactor futuro borre esta UI sin que ningún test lo note.
FRONTEND_FILE="$REPO_ROOT/frontend/src/pages/Configuracion/GestionUsuarios.tsx"
if [ -f "$FRONTEND_FILE" ] && grep -q "estaBloqueado" "$FRONTEND_FILE" && grep -q "Desbloquear" "$FRONTEND_FILE" && grep -q "rolesParaSelect" "$FRONTEND_FILE"; then
  ok "GestionUsuarios.tsx conserva el indicador de bloqueo, el botón Desbloquear y el filtro de roles del selector"
else
  fallo "GestionUsuarios.tsx ya NO tiene la UI de bloqueo/desbloqueo o el filtro de rol — verificar si se perdió en un refactor"
fi

echo "--- PREP: crear usuarios de prueba (admin/supervisor/operario) ---"
PASS_ADMIN_TARGET=$(gen_valid_password)
PASS_SUP=$(gen_valid_password)
PASS_OPERARIO=$(gen_valid_password)
PASS_ADMIN_ACTOR=$(gen_valid_password)

ID_ADMIN_TARGET=$(create_user "admintgt" "ADMIN" "$PASS_ADMIN_TARGET")
ID_SUP=$(create_user "sup" "SUPERVISOR" "$PASS_SUP")
ID_OPERARIO=$(create_user "op" "OPERARIO" "$PASS_OPERARIO")
ID_ADMIN_ACTOR=$(create_user "adminactor" "ADMIN" "$PASS_ADMIN_ACTOR")

for id in "$ID_ADMIN_TARGET" "$ID_SUP" "$ID_OPERARIO" "$ID_ADMIN_ACTOR"; do
  if [ -z "$id" ]; then fallo "no se pudo crear uno de los usuarios de prueba"; exit 1; fi
  TEST_USER_IDS+=("$id")
done
ok "usuarios de prueba creados: admin_target=$ID_ADMIN_TARGET, supervisor=$ID_SUP, operario=$ID_OPERARIO, admin_actor=$ID_ADMIN_ACTOR"

# El username real incluye $$/$RANDOM — releer de BD en vez de reconstruirlo.
USERNAME_SUP=$(psql_q "SELECT username FROM usuarios WHERE id=$ID_SUP;")
USERNAME_ADMIN_TARGET=$(psql_q "SELECT username FROM usuarios WHERE id=$ID_ADMIN_TARGET;")
USERNAME_OPERARIO=$(psql_q "SELECT username FROM usuarios WHERE id=$ID_OPERARIO;")
USERNAME_ADMIN_ACTOR=$(psql_q "SELECT username FROM usuarios WHERE id=$ID_ADMIN_ACTOR;")

TOKEN_SUP=$(login_token "$USERNAME_SUP" "$PASS_SUP")
TOKEN_ADMIN_ACTOR=$(login_token "$USERNAME_ADMIN_ACTOR" "$PASS_ADMIN_ACTOR")
if [ -z "$TOKEN_SUP" ] || [ -z "$TOKEN_ADMIN_ACTOR" ]; then
  fallo "no se pudo loguear supervisor o admin_actor de prueba"
  exit 1
fi
ok "tokens obtenidos para supervisor y admin_actor de prueba"

echo ""
echo "=== Supervisor NO puede modificar a un admin (403 esperado en cada uno) ==="
HTTP=$(call PUT "/users/$ID_ADMIN_TARGET" "$TOKEN_SUP" '{"nombre_completo":"Intento Supervisor"}')
expect "supervisor PUT sobre admin (editar datos)" "403" "$HTTP"

HTTP=$(call POST "/users/$ID_ADMIN_TARGET/unlock" "$TOKEN_SUP" "")
expect "supervisor POST unlock sobre admin" "403" "$HTTP"

HTTP=$(call POST "/users/$ID_ADMIN_TARGET/reset-password" "$TOKEN_SUP" "{\"newPassword\":\"$(gen_valid_password)\"}")
expect "supervisor POST reset-password sobre admin" "403" "$HTTP"

HTTP=$(call PUT "/users/$ID_ADMIN_TARGET" "$TOKEN_SUP" '{"rol":"operario"}')
expect "supervisor PUT rol sobre admin (degradar)" "403" "$HTTP"

echo ""
echo "=== Supervisor NO puede auto-ascenderse ni ascender a nadie a admin (403) ==="
HTTP=$(call PUT "/users/$ID_SUP" "$TOKEN_SUP" '{"rol":"admin"}')
expect "supervisor se auto-asciende a admin" "403" "$HTTP"

HTTP=$(call PUT "/users/$ID_OPERARIO" "$TOKEN_SUP" '{"rol":"admin"}')
expect "supervisor asciende a un operario a admin" "403" "$HTTP"

echo ""
echo "=== Supervisor SÍ puede modificar a un usuario de rango inferior (200) ==="
HTTP=$(call PUT "/users/$ID_OPERARIO" "$TOKEN_SUP" '{"nombre_completo":"Operario Editado Por Supervisor"}')
expect "supervisor PUT sobre operario (editar datos)" "200" "$HTTP"

echo ""
echo "=== Supervisor SÍ puede ascender a un inferior a su propio rango (supervisor) — decisión confirmada, no bloqueada ==="
HTTP=$(call PUT "/users/$ID_OPERARIO" "$TOKEN_SUP" '{"rol":"supervisor"}')
expect "supervisor asciende a operario a supervisor (mismo rango, permitido)" "200" "$HTTP"
psql_q "UPDATE usuarios SET rol='OPERARIO' WHERE id=$ID_OPERARIO;" > /dev/null  # revertir para los checks de abajo

echo ""
echo "=== Admin SÍ puede modificar a otro admin, desbloquearlo, resetear su password (200) ==="
HTTP=$(call PUT "/users/$ID_ADMIN_TARGET" "$TOKEN_ADMIN_ACTOR" '{"nombre_completo":"Admin Editado Por Admin"}')
expect "admin PUT sobre otro admin (editar datos)" "200" "$HTTP"

HTTP=$(call POST "/users/$ID_ADMIN_TARGET/unlock" "$TOKEN_ADMIN_ACTOR" "")
expect "admin POST unlock sobre otro admin" "200" "$HTTP"

HTTP=$(call POST "/users/$ID_ADMIN_TARGET/reset-password" "$TOKEN_ADMIN_ACTOR" "{\"newPassword\":\"$(gen_valid_password)\"}")
expect "admin POST reset-password sobre otro admin" "200" "$HTTP"

HTTP=$(call PUT "/users/$ID_SUP" "$TOKEN_ADMIN_ACTOR" '{"rol":"admin"}')
expect "admin asciende a un supervisor a admin" "200" "$HTTP"
psql_q "UPDATE usuarios SET rol='SUPERVISOR' WHERE id=$ID_SUP;" > /dev/null  # revertir

echo ""
echo "=== Protección de último admin activo (aislada y reversible) ==="
OTHER_ADMIN_IDS_SNAPSHOT=$(psql_q "SELECT string_agg(id::text, ',') FROM usuarios WHERE rol='ADMIN' AND activo=true AND id != $ID_ADMIN_ACTOR;")
if [ -z "$OTHER_ADMIN_IDS_SNAPSHOT" ]; then
  fallo "no se pudo obtener la lista de otros admins activos — se omite la prueba de último admin por seguridad"
else
  psql_q "UPDATE usuarios SET activo=false WHERE id IN ($OTHER_ADMIN_IDS_SNAPSHOT);" > /dev/null
  RESTANTES=$(psql_q "SELECT COUNT(*) FROM usuarios WHERE rol='ADMIN' AND activo=true;")
  if [ "$RESTANTES" != "1" ]; then
    fallo "tras desactivar temporalmente a los demás admins, quedaron $RESTANTES activos (se esperaba 1) — abortando esta sub-prueba"
  else
    ok "todos los demás admins desactivados temporalmente ($OTHER_ADMIN_IDS_SNAPSHOT) — queda 1 solo admin activo (el de prueba)"
    HTTP=$(call PUT "/users/$ID_ADMIN_ACTOR" "$TOKEN_ADMIN_ACTOR" '{"rol":"operario"}')
    expect "el único admin activo intenta auto-degradarse (debe bloquearse)" "400" "$HTTP"
  fi
  psql_q "UPDATE usuarios SET activo=true WHERE id IN ($OTHER_ADMIN_IDS_SNAPSHOT);" > /dev/null
  RESTAURADOS=$(psql_q "SELECT COUNT(*) FROM usuarios WHERE rol='ADMIN' AND activo=true;")
  ok "admins reales restaurados — activos ahora: $RESTAURADOS"
  OTHER_ADMIN_IDS_SNAPSHOT=""  # ya restaurado, el trap de cleanup no necesita repetirlo
fi

echo ""
echo "=== Visibilidad: bloqueado_hasta / intentos_fallidos expuestos por la API ==="
psql_q "UPDATE usuarios SET intentos_fallidos=4, bloqueado_hasta=NOW() + INTERVAL '30 minutes' WHERE id=$ID_OPERARIO;" > /dev/null
HTTP=$(call GET "/users/$ID_OPERARIO" "$TOKEN_ADMIN_ACTOR" "")
BLOQUEADO_HASTA=$(cat "$CALL_RESP_FILE" | jq -r '.data.bloqueado_hasta // empty')
if [ "$HTTP" = "200" ] && [ -n "$BLOQUEADO_HASTA" ]; then
  ok "GET /users/:id expone bloqueado_hasta (usuario bloqueado detectable)"
else
  fallo "GET /users/:id NO expone bloqueado_hasta para un usuario bloqueado (HTTP $HTTP)"
fi

HTTP=$(call GET "/users?search=$USERNAME_OPERARIO" "$TOKEN_ADMIN_ACTOR" "")
BLOQUEADO_EN_LISTA=$(cat "$CALL_RESP_FILE" | jq -r --arg id "$ID_OPERARIO" '.data.users[] | select((.id|tostring)==$id) | .bloqueado_hasta // empty')
if [ "$HTTP" = "200" ] && [ -n "$BLOQUEADO_EN_LISTA" ]; then
  ok "GET /users (listado) expone bloqueado_hasta para el usuario bloqueado"
else
  fallo "GET /users (listado) NO expone bloqueado_hasta para el usuario bloqueado (HTTP $HTTP)"
fi

echo ""
echo "=== Desbloqueo: supervisor SÍ puede desbloquear a un inferior (200) ==="
HTTP=$(call POST "/users/$ID_OPERARIO/unlock" "$TOKEN_SUP" "")
expect "supervisor desbloquea a un operario" "200" "$HTTP"
BLOQUEADO_POST=$(psql_q "SELECT bloqueado_hasta FROM usuarios WHERE id=$ID_OPERARIO;")
if [ -z "$BLOQUEADO_POST" ]; then
  ok "bloqueado_hasta quedó NULL tras el desbloqueo"
else
  fallo "bloqueado_hasta sigue con valor tras el desbloqueo: $BLOQUEADO_POST"
fi

echo ""
echo "############################################################"
if [ "$FALLOS" -eq 0 ]; then
  echo "TODOS LOS CHECKS PASARON"
  exit 0
else
  echo "$FALLOS CHECK(S) FALLARON"
  exit 1
fi
