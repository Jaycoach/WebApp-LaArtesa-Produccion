#!/bin/bash
# ============================================================================
# test_rate_limit_diferenciado.sh
# Script de aceptación — C1 (límite diferenciado por token + IP real +
# exclusión de /version), C2 (authLimiter en login).
#
# Contexto: generalLimiter aplicaba un único cupo de 500/15min por IP.
# Cuentas compartidas de planta (pesaje, supervisor, Lider1/2) agotaban ese
# cupo entre varios dispositivos. Además la clave por IP usaba
# X-Forwarded-For crudo (evadible por el cliente) y /api/version (158k
# llamadas/14 días) consumía cupo sin necesidad. El login no tenía
# authLimiter aplicado.
#
# Qué valida este script:
#   1. GET /api/version no trae headers RateLimit-* (excluido).
#   2. Una petición sin token trae RateLimit-Limit = RATE_LIMIT_MAX_REQUESTS.
#   3. Una petición con JWT válido trae RateLimit-Limit = RATE_LIMIT_USER_MAX_REQUESTS.
#   4. Mismo X-Real-IP con X-Forwarded-For distinto en cada request cae en
#      la MISMA cubeta (RateLimit-Remaining baja de forma monótona).
#   5. POST /api/auth/login con usuario inexistente responde 429 tras
#      agotar el cupo de authLimiter (NO usa cuentas reales — evita tocar
#      intentos_fallidos/bloqueado_hasta de usuarios de producción).
#
# Manejo de credenciales (secrets-hygiene-in-tests): el JWT de prueba se
# firma en runtime con JWT_SECRET leído del .env real (nunca hardcodeado
# en este archivo), con un id de usuario inventado. El login de prueba usa
# un username inexistente generado con PID+random, nunca una cuenta real.
# La salida de curl se filtra con jq — nunca se vuelca el body crudo
# (podría reflejar el username/password enviado).
#
# Uso:
#   API_URL=http://localhost:3000/api bash scripts/tests/test_rate_limit_diferenciado.sh
#   (por defecto API_URL=http://localhost:3000/api — para correr EN
#   staging/producción, ejecutar este script vía SSH en esa máquina, igual
#   que el resto de scripts/tests/, apuntando a su propio localhost:3000)
#
# Requiere: curl, jq, node (para firmar el JWT de prueba con el secreto
# real del backend).
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
API_URL="${API_URL:-http://localhost:3000/api}"

FALLOS=0
fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }

run_node() {
  if command -v node > /dev/null 2>&1; then node "$@"; else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  echo "FALLO: no se encontró $ENV_FILE — no se puede firmar un JWT de prueba con el secreto real."
  exit 1
fi
JWT_SECRET=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$JWT_SECRET" ]; then
  echo "FALLO: JWT_SECRET no encontrado en $ENV_FILE"
  exit 1
fi

TEST_JWT=$(cd "$REPO_ROOT/backend" && run_node -e "
const jwt = require('jsonwebtoken');
console.log(jwt.sign({ id: 999999 }, process.argv[1], { expiresIn: '5m' }));
" "$JWT_SECRET")

if [ -z "$TEST_JWT" ]; then
  fallo "no se pudo firmar el JWT de prueba"
  exit 1
fi
ok "JWT de prueba firmado con el JWT_SECRET real del .env (id inventado, no corresponde a un usuario real)"

echo ""
echo "===================================================="
echo "1) GET /api/version no debe traer headers RateLimit-*"
echo "===================================================="
HEADERS=$(curl -s -D - -o /dev/null "$API_URL/version")
if echo "$HEADERS" | grep -qi '^ratelimit-limit:'; then
  fallo "/api/version trae headers RateLimit-* — no está excluido del limiter"
else
  ok "/api/version no trae headers RateLimit-*"
fi

echo ""
echo "===================================================="
echo "2) Sin token: RateLimit-Limit = límite anónimo (RATE_LIMIT_MAX_REQUESTS)"
echo "===================================================="
ANON_HEADERS=$(curl -s -D - -o /dev/null "$API_URL/masas" -H "x-real-ip: 203.0.113.10")
ANON_LIMIT=$(echo "$ANON_HEADERS" | grep -i '^ratelimit-limit:' | tr -d '\r' | cut -d' ' -f2)
if [ -n "$ANON_LIMIT" ]; then
  ok "límite anónimo detectado: $ANON_LIMIT"
else
  fallo "no se pudo leer RateLimit-Limit en la petición sin token"
fi

echo ""
echo "===================================================="
echo "3) Con token válido: RateLimit-Limit = límite de usuario (RATE_LIMIT_USER_MAX_REQUESTS)"
echo "===================================================="
AUTH_HEADERS=$(curl -s -D - -o /dev/null "$API_URL/masas" -H "x-real-ip: 203.0.113.11" -H "Authorization: Bearer $TEST_JWT")
AUTH_LIMIT=$(echo "$AUTH_HEADERS" | grep -i '^ratelimit-limit:' | tr -d '\r' | cut -d' ' -f2)
if [ -n "$AUTH_LIMIT" ] && [ "$AUTH_LIMIT" != "$ANON_LIMIT" ]; then
  ok "límite con token ($AUTH_LIMIT) distinto del límite anónimo ($ANON_LIMIT)"
else
  fallo "límite con token ($AUTH_LIMIT) NO es distinto del límite anónimo ($ANON_LIMIT)"
fi

echo ""
echo "===================================================="
echo "4) Mismo X-Real-IP, X-Forwarded-For distinto en cada request -> misma cubeta"
echo "===================================================="
FIXED_IP="203.0.113.99"
R1=$(curl -s -D - -o /dev/null "$API_URL/masas" -H "x-real-ip: $FIXED_IP" -H "x-forwarded-for: 1.1.1.1")
R2=$(curl -s -D - -o /dev/null "$API_URL/masas" -H "x-real-ip: $FIXED_IP" -H "x-forwarded-for: 2.2.2.2")
REM1=$(echo "$R1" | grep -i '^ratelimit-remaining:' | tr -d '\r' | cut -d' ' -f2)
REM2=$(echo "$R2" | grep -i '^ratelimit-remaining:' | tr -d '\r' | cut -d' ' -f2)
if [ -n "$REM1" ] && [ -n "$REM2" ] && [ "$REM2" -eq "$((REM1 - 1))" ]; then
  ok "remaining bajó de $REM1 a $REM2 pese al X-Forwarded-For distinto — la clave usa X-Real-IP"
else
  fallo "remaining no bajó de forma consistente ($REM1 -> $REM2) — revisar si la clave sigue usando X-Forwarded-For"
fi

echo ""
echo "===================================================="
echo "5) Login con usuario inexistente: authLimiter responde 429 tras agotar el cupo"
echo "===================================================="
FAKE_USER="test_ratelimit_login_$$_$RANDOM"
LAST_STATUS=""
for i in $(seq 1 25); do
  RESP=$(curl -s -o /tmp/rl_login_body.json -w "%{http_code}" -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -H "x-real-ip: 203.0.113.50" \
    -d "{\"username\":\"$FAKE_USER\",\"password\":\"no-existe-$RANDOM\"}")
  LAST_STATUS="$RESP"
  if [ "$RESP" = "429" ]; then
    break
  fi
done
rm -f /tmp/rl_login_body.json
if [ "$LAST_STATUS" = "429" ]; then
  ok "authLimiter bloqueó el login con usuario inexistente tras $i intentos (status 429)"
else
  fallo "no se alcanzó 429 en 25 intentos de login con usuario inexistente (último status: $LAST_STATUS) — authLimiter no parece estar aplicado"
fi

echo ""
echo "===================================================="
echo "Grep de sanidad: sin contraseñas/credenciales literales en los archivos tocados"
echo "===================================================="
if grep -nE "password.*=.*['\"][A-Za-z0-9]{6,}['\"]" \
  "$REPO_ROOT/backend/src/middleware/rateLimiter.js" \
  "$REPO_ROOT/backend/src/config/index.js" \
  "$REPO_ROOT/backend/src/routes/auth.routes.js" \
  "$REPO_ROOT/backend/src/middleware/__tests__/rateLimiter.test.js" \
  "$REPO_ROOT/frontend/src/hooks/useChecklist.ts" \
  "$0" 2>/dev/null | grep -vE "newPassword: 'test'|password: 'wrong'|password: 'correct'|password === 'correct'|no-existe-"; then
  fallo "grep de sanidad encontró un posible literal de contraseña — revisar arriba"
else
  ok "grep de sanidad: sin contraseñas/credenciales literales sospechosas"
fi

echo ""
echo "===================================================="
if [ "$FALLOS" -eq 0 ]; then
  echo "RESULTADO: OK — 0 fallos"
  exit 0
else
  echo "RESULTADO: $FALLOS fallo(s)"
  exit 1
fi
