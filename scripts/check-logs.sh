#!/bin/bash
# check-logs.sh — Validador de logs del backend LaArtesa
# Uso: ./check-logs.sh [FECHA] [TIPO]
#   FECHA: 2026-03-04 (default: hoy)
#   TIPO:  combined | error | sap-sync | all (default: all)

LOGS_DIR="${LOGS_DIR:-./backend/logs}"
DATE="${1:-$(date +%Y-%m-%d)}"
TYPE="${2:-all}"

# Quitar ANSI color codes
strip_ansi() {
  sed 's/\x1B\[[0-9;]*[mK]//g'
}

# Parsear JSON y mostrar limpio
parse_log() {
  local file="$1"
  local label="$2"
  if [ ! -f "$file" ]; then
    echo "  [no existe] $file"
    return
  fi
  local count
  count=$(wc -l < "$file")
  echo "  [$label] $count líneas — $file"
}

# Mostrar errores de un archivo
show_errors() {
  local file="$1"
  if [ ! -f "$file" ]; then return; fi
  local errors
  errors=$(strip_ansi < "$file" | grep -c '"level":"error"' 2>/dev/null || echo 0)
  if [ "$errors" -gt 0 ]; then
    echo ""
    echo "  ⚠  $errors ERROR(s) encontrados en $(basename "$file"):"
    strip_ansi < "$file" | grep '"level":"error"' | while IFS= read -r line; do
      ts=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('timestamp','?'))" 2>/dev/null)
      msg=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message','?'))" 2>/dev/null)
      echo "     [$ts] $msg"
    done
  fi
}

# Mostrar warnings de un archivo
show_warnings() {
  local file="$1"
  if [ ! -f "$file" ]; then return; fi
  local warns
  warns=$(strip_ansi < "$file" | grep -c '"level":"warn"' 2>/dev/null || echo 0)
  if [ "$warns" -gt 0 ]; then
    echo ""
    echo "  ⚡ $warns WARN(s) en $(basename "$file"):"
    strip_ansi < "$file" | grep '"level":"warn"' | while IFS= read -r line; do
      ts=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('timestamp','?'))" 2>/dev/null)
      msg=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message','?'))" 2>/dev/null)
      echo "     [$ts] $msg"
    done
  fi
}

# Últimas N líneas de un archivo (sin ANSI)
tail_log() {
  local file="$1"
  local n="${2:-10}"
  if [ ! -f "$file" ]; then return; fi
  echo ""
  echo "  Últimas $n líneas de $(basename "$file"):"
  strip_ansi < "$file" | tail -n "$n" | while IFS= read -r line; do
    ts=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('timestamp','?'))" 2>/dev/null)
    lvl=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('level','info')[:4].upper())" 2>/dev/null)
    msg=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('message','?')[:120])" 2>/dev/null)
    echo "     [$ts][$lvl] $msg"
  done
}

# ─────────────────────────────────────────
echo "======================================================"
echo "  LaArtesa — Validación de Logs: $DATE"
echo "  Directorio: $LOGS_DIR"
echo "======================================================"
echo ""

COMBINED="$LOGS_DIR/combined-$DATE.log"
ERROR="$LOGS_DIR/error-$DATE.log"
SAP="$LOGS_DIR/sap-sync-$DATE.log"

echo "Archivos disponibles:"
parse_log "$COMBINED" "combined"
parse_log "$ERROR"    "error   "
parse_log "$SAP"      "sap-sync"
echo ""

# Resumen de errores
echo "------------------------------------------------------"
echo "ERRORES Y WARNINGS"
echo "------------------------------------------------------"

case "$TYPE" in
  combined)
    show_errors "$COMBINED"; show_warnings "$COMBINED"
    tail_log "$COMBINED" 15
    ;;
  error)
    show_errors "$ERROR"; show_warnings "$ERROR"
    tail_log "$ERROR" 15
    ;;
  sap-sync)
    show_errors "$SAP"; show_warnings "$SAP"
    tail_log "$SAP" 15
    ;;
  all|*)
    show_errors "$COMBINED"; show_warnings "$COMBINED"
    show_errors "$ERROR"
    show_errors "$SAP";    show_warnings "$SAP"
    ;;
esac

echo ""
echo "------------------------------------------------------"
echo "ÚLTIMAS ENTRADAS (combined)"
echo "------------------------------------------------------"
tail_log "$COMBINED" 10

echo ""
echo "======================================================"
echo "Uso avanzado:"
echo "  Ver solo errores de hoy:           $0"
echo "  Ver logs de fecha específica:      $0 2026-03-01"
echo "  Ver solo sap-sync de una fecha:    $0 2026-03-01 sap-sync"
echo "  Filtrar en vivo (follow):          tail -f $LOGS_DIR/combined-\$(date +%Y-%m-%d).log | sed 's/\x1B\[[0-9;]*[mK]//g'"
echo "======================================================"
