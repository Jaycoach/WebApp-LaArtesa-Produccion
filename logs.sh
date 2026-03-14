#!/bin/bash
# =============================================================
# logs.sh — Ver logs de LaArtesa en tiempo real (Ubuntu server)
# Uso: ./logs.sh [opciones]
#   -f combined|error|sap|all   archivo(s) a seguir (default: combined)
#   -n <número>                  últimas N líneas al iniciar (default: 50)
#   -l error|warn|info|http      filtrar por nivel
#   -g <texto>                   grep libre sobre el JSON
#   -h                           mostrar ayuda
# =============================================================

# Ruta de logs relativa al script (ajustar si es necesario)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/backend/logs"

# Colores ANSI
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Defaults
FILE_TYPE="combined"
LINES=50
LEVEL_FILTER=""
GREP_FILTER=""

usage() {
  echo -e "${BOLD}Uso:${NC} $0 [opciones]"
  echo ""
  echo "  -f <tipo>    Archivo: combined | error | sap | all  (default: combined)"
  echo "  -n <N>       Últimas N líneas al arrancar            (default: 50)"
  echo "  -l <nivel>   Filtrar nivel: error | warn | info | http"
  echo "  -g <texto>   Grep libre (ej: -g 'SAP' o -g 'userId')"
  echo "  -h           Esta ayuda"
  echo ""
  echo -e "${BOLD}Ejemplos:${NC}"
  echo "  $0                          # combined, últimas 50 líneas"
  echo "  $0 -f error                 # solo errores en tiempo real"
  echo "  $0 -f sap -n 100            # SAP sync, últimas 100 líneas"
  echo "  $0 -f all -l error          # todos los archivos, solo errores"
  echo "  $0 -g 'planificacion'       # filtrar por texto libre"
  exit 0
}

# Parsear argumentos
while getopts "f:n:l:g:h" opt; do
  case $opt in
    f) FILE_TYPE="$OPTARG" ;;
    n) LINES="$OPTARG" ;;
    l) LEVEL_FILTER="$OPTARG" ;;
    g) GREP_FILTER="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

# Verificar que jq está disponible (para pretty-print JSON)
HAS_JQ=false
if command -v jq &>/dev/null; then
  HAS_JQ=true
fi

# Colorear una línea de log JSON
colorize_line() {
  local line="$1"

  # Si la línea no parece JSON, mostrarla tal cual
  if [[ "$line" != {* ]]; then
    echo -e "${GRAY}$line${NC}"
    return
  fi

  local level message timestamp

  if $HAS_JQ; then
    level=$(echo "$line" | jq -r '.level // "info"' 2>/dev/null)
    message=$(echo "$line" | jq -r '.message // ""' 2>/dev/null)
    timestamp=$(echo "$line" | jq -r '.timestamp // ""' 2>/dev/null)
    # Campos extra (sin los básicos)
    extra=$(echo "$line" | jq -c 'del(.level, .message, .timestamp)' 2>/dev/null)
    [[ "$extra" == "{}" ]] && extra=""
  else
    # Fallback sin jq: extraer con sed
    level=$(echo "$line" | sed 's/.*"level":"\([^"]*\)".*/\1/')
    message=$(echo "$line" | sed 's/.*"message":"\([^"]*\)".*/\1/')
    timestamp=$(echo "$line" | sed 's/.*"timestamp":"\([^"]*\)".*/\1/')
    extra=""
  fi

  # Aplicar color según nivel
  local color="$NC"
  case "$level" in
    error)     color="$RED" ;;
    warn)      color="$YELLOW" ;;
    info)      color="$GREEN" ;;
    http)      color="$MAGENTA" ;;
    debug)     color="$CYAN" ;;
  esac

  local ts_short="${timestamp:0:19}"  # YYYY-MM-DDTHH:MM:SS
  printf "${GRAY}%s${NC} ${color}%-5s${NC} %s" "$ts_short" "$level" "$message"
  [[ -n "$extra" ]] && printf " ${GRAY}%s${NC}" "$extra"
  printf "\n"
}

# Obtener el archivo de hoy
today=$(date +%Y-%m-%d)

resolve_files() {
  local type="$1"
  case "$type" in
    combined) echo "$LOG_DIR/combined-${today}.log" ;;
    error)    echo "$LOG_DIR/error-${today}.log" ;;
    sap)      echo "$LOG_DIR/sap-sync-${today}.log" ;;
    all)      echo "$LOG_DIR/combined-${today}.log $LOG_DIR/error-${today}.log $LOG_DIR/sap-sync-${today}.log" ;;
    *)
      echo -e "${RED}Tipo de archivo desconocido: $type${NC}" >&2
      exit 1
      ;;
  esac
}

FILES=$(resolve_files "$FILE_TYPE")

# Verificar que al menos un archivo existe
found=false
for f in $FILES; do
  [[ -f "$f" ]] && found=true
done

if ! $found; then
  echo -e "${YELLOW}Advertencia: no se encontraron logs para hoy ($today) en $LOG_DIR${NC}"
  echo -e "Archivos esperados: ${GRAY}$FILES${NC}"
  # Mostrar el más reciente disponible
  latest=$(ls -t "$LOG_DIR"/combined-*.log 2>/dev/null | head -1)
  if [[ -n "$latest" ]]; then
    echo -e "Usando el más reciente: ${CYAN}$latest${NC}"
    FILES="$latest"
  else
    echo -e "${RED}No hay archivos de log en $LOG_DIR${NC}"
    exit 1
  fi
fi

# Header informativo
echo -e "${BOLD}======================================================${NC}"
echo -e "${BOLD} LaArtesa — Logs en tiempo real${NC}"
echo -e " Archivo(s): ${CYAN}$FILES${NC}"
[[ -n "$LEVEL_FILTER" ]] && echo -e " Nivel:      ${YELLOW}$LEVEL_FILTER${NC}"
[[ -n "$GREP_FILTER" ]]  && echo -e " Grep:       ${YELLOW}$GREP_FILTER${NC}"
echo -e "${BOLD}======================================================${NC}"
echo -e "${GRAY}(Ctrl+C para salir)${NC}"
echo ""

# Construir el pipeline de tail
# tail -f -n N para seguir en tiempo real + líneas iniciales
tail_cmd="tail -f -n $LINES $FILES"

# Ejecutar con pipeline opcional
process_stream() {
  while IFS= read -r line; do
    # Filtro por nivel
    if [[ -n "$LEVEL_FILTER" ]]; then
      echo "$line" | grep -qi "\"level\":\"$LEVEL_FILTER\"" || continue
    fi
    # Grep libre
    if [[ -n "$GREP_FILTER" ]]; then
      echo "$line" | grep -qi "$GREP_FILTER" || continue
    fi
    colorize_line "$line"
  done
}

# Lanzar
eval "$tail_cmd" | process_stream
