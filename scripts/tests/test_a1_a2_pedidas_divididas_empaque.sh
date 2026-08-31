#!/bin/bash
# Validacion A1 (Pedidas 0) + A2 (Divididas obsoleto) contra TODAS las masas
# en fase EMPAQUE de staging. Corre GET /api/empaque/:masaId por cada una y
# reporta si "Pedidas" (unidades_ajustadas||unidades_programadas) y
# "Divididas" (unidades_producidas) llegan pobladas, no en 0/undefined.
#
# Requiere: psql, curl, jq, node, bcrypt instalado en backend. Crea y limpia
# su propio usuario de prueba (password generada en runtime, nunca literal).
set -euo pipefail

DB_HOST="${DB_HOST:-}"; DB_PORT="${DB_PORT:-5432}"; DB_NAME="${DB_NAME:-}"
DB_USER="${DB_USER:-}"; DB_PASSWORD="${DB_PASSWORD:-}"
if [ -z "$DB_HOST" ]; then
  set -a; source "$(dirname "$0")/../../backend/.env" >/dev/null 2>&1 || true; set +a
fi
API_URL="${API_URL:-http://localhost:3000/api}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

TEST_USERNAME="test_a1a2_$$"
TEST_EMAIL="test.a1a2.$$@artesa-staging-test.com"
TEST_PASSWORD=$(openssl rand -base64 18)
USER_CREADO=0

psql_q() {
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -t -A -F'|' -c "$1"
}

cleanup() {
  if [ "$USER_CREADO" = "1" ]; then
    psql_q "DELETE FROM usuarios WHERE username='$TEST_USERNAME';" > /dev/null 2>&1 || true
    echo "[cleanup] usuario de prueba $TEST_USERNAME eliminado."
  fi
}
trap cleanup EXIT

echo "==== PREP: usuario de prueba no productivo ===="
HASH=$(cd "$REPO_ROOT/backend" && printf '%s' "$TEST_PASSWORD" | node -e "
let pw = '';
process.stdin.on('data', d => pw += d);
process.stdin.on('end', () => {
  require('bcrypt').hash(pw, 12).then(h => console.log(h));
});
")
[ -z "$HASH" ] && { echo "FALLO: no se pudo generar hash bcrypt"; exit 1; }

USER_ID=$(psql_q "INSERT INTO usuarios (username, email, password_hash, nombre_completo, rol, activo, email_verificado, intentos_fallidos, bloqueado_hasta, debe_cambiar_password, ultimo_cambio_password) VALUES ('$TEST_USERNAME', '$TEST_EMAIL', '$HASH', 'Usuario Prueba A1 A2', 'OPERARIO', true, true, 0, NULL, false, NOW() - INTERVAL '1 hour') RETURNING id;")
[ -z "$USER_ID" ] && { echo "FALLO: no se pudo crear usuario de prueba"; exit 1; }
USER_CREADO=1
echo "OK usuario de prueba creado: $TEST_USERNAME (id=$USER_ID)"

echo "==== LOGIN ===="
LOGIN_RESP=$(curl -s -X POST "$API_URL/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}")
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.data.token // .data.accessToken // .token // .accessToken // empty')
if [ -z "$TOKEN" ]; then
  echo "FALLO login. Respuesta (status/success/message solamente, sin body crudo):"
  echo "$LOGIN_RESP" | jq '{success, message}'
  exit 1
fi
echo "OK login."

echo "==== Masas en fase EMPAQUE (no canceladas) en staging ===="
MASA_IDS=$(psql_q "SELECT id FROM masas_produccion WHERE fase_actual='EMPAQUE' AND estado != 'CANCELADA' ORDER BY id;")
TOTAL=$(echo "$MASA_IDS" | grep -c . || true)
echo "Total masas a validar: $TOTAL"

PEDIDAS_CERO_ANTES=0
DIVIDIDAS_INCONSISTENTE=0
i=0
echo ""
printf "%-8s %-24s %-12s %-14s %-14s\n" "masa_id" "producto" "pedidas(A1)" "cant_div" "uds_prod(A2)"
for MID in $MASA_IDS; do
  i=$((i+1))
  RESP=$(curl -s "$API_URL/empaque/$MID" -H "Authorization: Bearer $TOKEN")
  OK=$(echo "$RESP" | jq -r '.success')
  if [ "$OK" != "true" ]; then
    echo "$MID: ERROR respuesta -> $(echo "$RESP" | jq -c '{success,message}')"
    continue
  fi
  # ojo: en jq "//" NO cae al fallback cuando el lado izquierdo es 0 (0 es "truthy"
  # en jq, a diferencia de JS) -- por eso se usa "if > 0" explicito, igual que la
  # logica real en EmpaqueMasa.tsx (ajustadas>0 ? ajustadas : programadas).
  echo "$RESP" | jq -r '.data.productos[] | [.producto_codigo, (if (.unidades_ajustadas // 0) > 0 then .unidades_ajustadas else (.unidades_programadas // 0) end), (.cantidad_divisiones // 0), (.unidades_producidas // 0)] | @tsv' | \
  while IFS=$'\t' read -r COD PEDIDAS CANTDIV UPROD; do
    printf "%-8s %-24s %-12s %-14s %-14s\n" "$MID" "$COD" "$PEDIDAS" "$CANTDIV" "$UPROD"
  done
done

echo ""
echo "==== $i / $TOTAL masas consultadas ===="
