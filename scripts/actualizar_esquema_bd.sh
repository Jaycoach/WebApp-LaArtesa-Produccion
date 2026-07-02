#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: actualizar_esquema_bd.sh
# Proyecto: ARTESA / La Artesa Producción
#
# Propósito:
#   Generar/actualizar la documentación completa del esquema de la base de
#   datos PostgreSQL (tablas, columnas, llaves primarias, llaves foráneas,
#   índices, restricciones UNIQUE/CHECK, secuencias y conteo de filas),
#   leyendo la configuración de conexión directamente desde el archivo .env
#   del backend. Pensado para correr después de cada migración, y así
#   mantener sincronizada la documentación de esquema con la base real.
#
# Uso:
#   bash scripts/actualizar_esquema_bd.sh [ruta_al_env] [directorio_salida]
#
# Ejemplos:
#   bash scripts/actualizar_esquema_bd.sh
#   bash scripts/actualizar_esquema_bd.sh backend/.env docs/schema
#   bash scripts/actualizar_esquema_bd.sh /home/ubuntu/LaArtesa/backend/.env /home/ubuntu/LaArtesa/docs/schema
#
# Notas:
#   - No hace falta exportar variables de entorno manualmente: el script lee
#     el .env directamente con grep/sed, así que passwords con caracteres
#     especiales (ej. "$$") no rompen el comando (aprendizaje de SAP).
#   - Requiere que "psql" esté instalado y en el PATH del servidor.
#   - No modifica la base de datos: solo hace SELECT sobre catálogos del
#     sistema (information_schema / pg_catalog). Es 100% seguro de correr
#     en producción.
# ==============================================================================

ENV_FILE="${1:-backend/.env}"
OUT_DIR="${2:-docs/schema}"

# ---------------------------------------------------------------------------
# Validaciones iniciales
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No se encontró el archivo .env en: $ENV_FILE"
  echo "   Uso: bash $0 [ruta_al_env] [directorio_salida]"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql no está instalado o no está en el PATH del sistema."
  exit 1
fi

# ---------------------------------------------------------------------------
# Lector seguro de variables del .env (evita el `source` directo del archivo,
# que puede romperse con passwords que contengan $, $$, comillas, etc.)
# ---------------------------------------------------------------------------
get_var() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" \
    | tail -n1 \
    | cut -d '=' -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

DB_HOST="$(get_var DB_HOST)"
DB_PORT="$(get_var DB_PORT)"
DB_NAME="$(get_var DB_NAME)"
DB_USER="$(get_var DB_USER)"
DB_PASSWORD="$(get_var DB_PASSWORD)"
DB_SSL="$(get_var DB_SSL)"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ]; then
  echo "❌ No se pudieron leer DB_NAME / DB_USER desde $ENV_FILE"
  echo "   Verifica que el archivo tenga las variables DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD."
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"
if [ "$DB_SSL" = "true" ]; then
  export PGSSLMODE="require"
fi

PSQL_OPTS=(-h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1)

# ---------------------------------------------------------------------------
# Preparación de salida
# ---------------------------------------------------------------------------
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/schema_columnas_artesa_${TIMESTAMP}.txt"
LATEST_FILE="${OUT_DIR}/schema_columnas_artesa_LATEST.txt"

echo "🔎 Conectando a ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME} ..."
psql "${PSQL_OPTS[@]}" -c "SELECT 1" > /dev/null

echo "📄 Generando documentación de esquema en: $OUT_FILE"

{
  echo "=============================================================================="
  echo " ESQUEMA DE BASE DE DATOS - ARTESA PRODUCCION"
  echo " Base de datos : ${DB_NAME}"
  echo " Host          : ${DB_HOST}:${DB_PORT}"
  echo " Generado      : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "=============================================================================="
} > "$OUT_FILE"

# ---------------------------------------------------------------------------
# 1. Tablas y columnas (mismo formato que el archivo histórico del proyecto)
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 1. TABLAS Y COLUMNAS"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT table_name,
       column_name,
       data_type,
       character_maximum_length,
       numeric_precision,
       numeric_scale,
       is_nullable,
       column_default,
       ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# 2. Llaves primarias
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 2. LLAVES PRIMARIAS"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT tc.table_name,
       kcu.column_name,
       tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.ordinal_position;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# 3. Llaves foráneas
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 3. LLAVES FORANEAS (FOREIGN KEYS)"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT tc.table_name        AS tabla_origen,
       kcu.column_name      AS columna_origen,
       ccu.table_name       AS tabla_referenciada,
       ccu.column_name      AS columna_referenciada,
       tc.constraint_name,
       rc.update_rule,
       rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
 AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
 AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# 4. Índices
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 4. INDICES"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# 5. Restricciones UNIQUE / CHECK
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 5. RESTRICCIONES UNIQUE / CHECK"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT tc.table_name, tc.constraint_type, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc
  ON tc.constraint_name = cc.constraint_name
 AND tc.table_schema = cc.constraint_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type IN ('UNIQUE','CHECK')
ORDER BY tc.table_name, tc.constraint_type;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# 6. Secuencias
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 6. SECUENCIAS"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT sequence_name, data_type, start_value, increment
FROM information_schema.sequences
WHERE sequence_schema = 'public'
ORDER BY sequence_name;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# 7. Listado de tablas con conteo aproximado de filas
# ---------------------------------------------------------------------------
{
  echo
  echo "------------------------------------------------------------------------------"
  echo " 7. LISTADO DE TABLAS Y CONTEO APROXIMADO DE REGISTROS"
  echo "------------------------------------------------------------------------------"
} >> "$OUT_FILE"

psql "${PSQL_OPTS[@]}" -c "
SELECT relname AS tabla, n_live_tup AS filas_aprox
FROM pg_stat_user_tables
ORDER BY relname;
" >> "$OUT_FILE"

# ---------------------------------------------------------------------------
# Cierre
# ---------------------------------------------------------------------------
cp "$OUT_FILE" "$LATEST_FILE"
unset PGPASSWORD
unset PGSSLMODE || true

echo "✅ Esquema generado correctamente:"
echo "   - Versión con timestamp : $OUT_FILE"
echo "   - Última copia (fija)   : $LATEST_FILE"
echo
echo "Sugerencia: sube '$LATEST_FILE' (o la versión con timestamp) al proyecto de Claude"
echo "para reemplazar el schema_columnas_artesa_*.txt desactualizado."