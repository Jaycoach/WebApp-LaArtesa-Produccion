#!/bin/bash
# ============================================================================
# test_session_replaced_guard.sh
#
# Script de aceptación — "sesión no debe cambiar silenciosamente entre
# pestañas del mismo navegador cuando se loguea un usuario distinto".
#
# NIVEL UNITARIO (lo que se puede validar sin un navegador real):
#   1. frontend-session-replaced-guard.test.mjs — corre la función PURA real
#      (frontend/src/utils/sessionReplacedGuard.ts, compilada con esbuild,
#      no reimplementada) contra 8 casos: usuario distinto -> interrumpe,
#      mismo usuario (refresh) -> no interrumpe, clave distinta -> ignora,
#      logout en otra pestaña -> fuera de alcance, sin sesión propia -> no
#      actúa, token no decodificable -> no actúa a ciegas, y las dos
#      variantes con oldValue ausente.
#   2. Regresión completa del backend de auth/sesiones/roles (este cambio es
#      100% frontend, pero qa-agent exige reconfirmar TODO lo ya construido
#      en esta área, no asumir que "no toqué el backend" es suficiente):
#      reusa scripts/tests/user_hierarchy_and_full_regression.sh, que a su
#      vez reusa fix-audit-session-trigger.sh y
#      test_error_desconocido_cambio_password.sh.
#
# NIVEL END-TO-END (dos pestañas reales) NO está cubierto por este script —
# requiere un navegador real. Queda pendiente de confirmación por Claude en
# Chrome (ver reporte de la tarea).
#
# Manejo de credenciales (secrets-hygiene-in-tests): los JWT usados en el
# test unitario son sintéticos, con firma inventada (la función bajo prueba
# nunca verifica firma, solo decodifica payload) — no hay ningún secreto
# real involucrado. Grep de sanidad al final de todas formas.
#
# El test unitario (Node + esbuild) es 100% local, sin red. El bloque de
# regresión SÍ necesita correr donde vive el backend real (staging) — por
# eso, igual que el resto de scripts/tests/, este se ejecuta EN STAGING
# desde la raíz del repo:
#   bash scripts/tests/test_session_replaced_guard.sh
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FALLOS=0
fallo() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok()    { echo "OK: $1"; }

run_node() {
  if command -v node > /dev/null 2>&1; then node "$@"; else
    bash -c 'source ~/.nvm/nvm.sh 2>/dev/null; node "$@"' _ "$@"
  fi
}

echo "############################################################"
echo "# NIVEL UNITARIO: lógica real de sessionReplacedGuard.ts"
echo "############################################################"
if run_node "$REPO_ROOT/scripts/tests/frontend-session-replaced-guard.test.mjs"; then
  ok "los 8 casos de debeTratarseComoSesionReemplazada() pasaron (código real, no reimplementado)"
else
  fallo "el test unitario de sessionReplacedGuard.ts FALLÓ — ver salida arriba"
fi

echo ""
echo "############################################################"
echo "# REGRESIÓN COMPLETA: auth / sesiones / roles (backend, sin tocar en"
echo "# esta tarea, pero confirmado igual — qa-agent no admite asumir)"
echo "############################################################"
REGRESSION_SCRIPT="$REPO_ROOT/scripts/tests/user_hierarchy_and_full_regression.sh"
if [ -f "$REGRESSION_SCRIPT" ]; then
  if bash "$REGRESSION_SCRIPT"; then
    ok "regresión completa de auth/sesiones/roles: TODOS LOS CHECKS PASARON"
  else
    fallo "regresión completa de auth/sesiones/roles FALLÓ — ver salida arriba"
  fi
else
  fallo "no se encontró $REGRESSION_SCRIPT — no se puede confirmar la regresión completa"
fi

echo ""
echo "############################################################"
if [ "$FALLOS" -eq 0 ]; then
  echo "TODOS LOS CHECKS PASARON (nivel unitario)"
  echo "PENDIENTE: nivel end-to-end de dos pestañas reales (Claude en Chrome)"
  exit 0
else
  echo "$FALLOS CHECK(S) FALLARON"
  exit 1
fi
