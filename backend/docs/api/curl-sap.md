# Ejemplos de Prueba de Endpoints - Sincronización SAP ARTESA API

Guía con ejemplos de cURL para los 13 endpoints de integración SAP (`backend/src/routes/sap.routes.js`). Separado de `curl-produccion.md` porque es integración/infraestructura, no flujo de producción día a día — ver también `backend/CURL_EXAMPLES.md` (Auth+Usuarios).

## 🔧 Requisitos

- `curl` instalado
- Servidor backend corriendo en `http://localhost:3000`
- Token de acceso con rol `admin` o `supervisor` (la mayoría de estos endpoints lo exigen — se indica endpoint por endpoint)
- `SAP_READ_MODE` en `.env` decide si las lecturas van por HANA directo o Service Layer — no cambia el contrato HTTP de estos endpoints, solo la ruta interna de lectura.

## ⚠️ Antes de probar en staging/producción

**3 de estos 13 endpoints crean filas reales en `masas_produccion`** — no son de solo lectura ni de solo caché. Probarlos "a la ligera" contra una base con datos reales puede generar masas de producción falsas o duplicadas:

| Endpoint | Efecto |
|---|---|
| `POST /api/sap/sincronizar` | Crea `masas_produccion` reales (flujo legacy, por tipo de masa completo) |
| `POST /api/sap/sincronizar-ov` | Crea `masas_produccion` reales (flujo actual, por Orden de Venta) — **es el que usa producción de verdad** |
| `POST /api/sap/sincronizar-demo` | Crea `masas_produccion` con datos **simulados/hardcodeados** (no viene de SAP real) — igual de real la fila en la BD, aunque el contenido sea falso |

El resto (10 endpoints) son de solo lectura o solo actualizan tablas de caché (`sap_articulos`, `sap_bom_componentes`, `sap_inventario_mp`, `sap_lotes_mp`) — no tocan `masas_produccion` ni tienen efecto que requiera deshacer nada.

## 📋 Tabla de Contenidos

1. [Sincronización que crea masas — usar con cuidado](#sincronización-que-crea-masas--usar-con-cuidado)
2. [Solo lectura](#solo-lectura)
3. [Solo caché (BOM / inventario / lotes)](#solo-caché-bom--inventario--lotes)

---

## Sincronización que crea masas — usar con cuidado

### 1. Sincronizar Órdenes desde SAP (legacy, por tipo de masa completo)

```bash
TOKEN="your_admin_token_here"

curl -X POST http://localhost:3000/api/sap/sincronizar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fecha": "2026-08-18", "forzar": false }'
```
`fecha` opcional (default: hoy). `forzar=true` sobrescribe masas ya existentes para esa fecha — con reglas de preservación si ya avanzaron de fase (no las borra, crea una `ADICIONAL` aparte). Rol `admin`/`supervisor`.

### 2. Sincronizar desde Órdenes de Venta (flujo real, agrupa por `U_JZ_Tipos_Masa`)

```bash
curl -X POST http://localhost:3000/api/sap/sincronizar-ov \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fecha": "2026-08-18", "forzar": false }'
```
**Este es el que usa producción real** — crea las masas que después pasan por Pesaje/Amasado/.../Empaque. Sigue siendo 100% manual/con confirmación de usuario; no está automatizado en ningún cron. Rol `admin`/`supervisor`.

### 3. Sincronizar en Modo DEMO

```bash
curl -X POST http://localhost:3000/api/sap/sincronizar-demo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fecha": "2026-08-18" }'
```
`fecha` opcional. Genera masas a partir de **datos de órdenes simulados hardcodeados en el propio controller** (no consulta SAP real) — pensado para demo/desarrollo local. En una base con datos reales de staging/producción, sigue creando filas reales en `masas_produccion` con contenido falso — no correr ahí sin necesidad real. Rol `admin`/`supervisor`.

---

## Solo lectura

Ninguno de estos escribe en la base de datos.

### 4. Preview de OV sin Sincronizar

```bash
curl -X GET "http://localhost:3000/api/sap/ordenes-ov?fecha=2026-08-18" \
  -H "Authorization: Bearer $TOKEN"
```
Consulta SAP en vivo pero no escribe nada en Postgres — es la vista previa antes de decidir si correr `sincronizar-ov`. Requiere solo autenticación (no rol admin/supervisor).

### 5. Listar Órdenes ya Sincronizadas

```bash
curl -X GET "http://localhost:3000/api/sap/ordenes?fecha=2026-08-18&estado=PENDIENTE" \
  -H "Authorization: Bearer $TOKEN"
```
`fecha` y `estado` opcionales. Requiere solo autenticación.

### 6. Verificar Stock para una Masa

```bash
MASA_ID=1937

curl -X GET http://localhost:3000/api/sap/stock/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```
Consulta SAP en vivo (`sapService.verificarStock`), ítem por ítem, contra la bodega **`MP01`** hardcodeada en este endpoint específico — distinta de `ALMP`, que es la bodega que usan `sincronizar-inventario-mp` y el resto del flujo de pesaje. No confirmé si `MP01` es una bodega real vigente en el SAP actual o un valor heredado de una versión anterior del sistema — lo documento tal cual está en el código, sin asumir que es un bug. Requiere solo autenticación.

### 7. Historial de Sincronizaciones

```bash
curl -X GET "http://localhost:3000/api/sap/historial?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```
`limit` opcional (default 50). Lee `sap_sync_log`. Requiere solo autenticación.

### 8. Test de Conexión SAP

```bash
curl -X GET http://localhost:3000/api/sap/test \
  -H "Authorization: Bearer $TOKEN"
```
Solo intenta `sapService.login()` contra Service Layer y responde éxito/error — no consulta ni escribe datos de negocio. Rol `admin`/`supervisor`.

### 9. Obtener Inventario de Materia Prima (cacheado)

```bash
curl -X GET http://localhost:3000/api/sap/inventario-mp \
  -H "Authorization: Bearer $TOKEN"
```
Lee directo de `sap_inventario_mp` (Postgres) — no llama a SAP en vivo. Requiere solo autenticación.

---

## Solo caché (BOM / inventario / lotes)

Escriben en Postgres (`sap_articulos`, `sap_bom_componentes`, `sap_inventario_mp`, `sap_lotes_mp`), nunca en `masas_produccion` ni hacia SAP. Seguros de correr repetidamente — todos usan upserts idempotentes.

### 10. Sincronizar Tipos de Masa

```bash
curl -X POST http://localhost:3000/api/sap/sincronizar-tipos-masa \
  -H "Authorization: Bearer $TOKEN"
```
Sin body. Escribe en `catalogo_tipos_masa`. También corre automáticamente como sub-paso no crítico de `sincronizar-bom` (corrida completa). Rol `admin`/`supervisor`.

### 11. Sincronizar BOM (Listas de Materiales)

```bash
# Corrida completa (puede tardar varios minutos — la ruta tiene timeout de 11 min)
curl -X POST http://localhost:3000/api/sap/sincronizar-bom \
  -H "Authorization: Bearer $TOKEN"

# Sync puntual, solo estos ítems
curl -X POST http://localhost:3000/api/sap/sincronizar-bom \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "items": "MP0029,MP0080" }'
```
`items` opcional (string separado por comas o array) — si se omite, sincroniza todo. Escribe `sap_articulos` + `sap_bom_componentes`; en corrida completa también marca inactivos los artículos que ya no vienen de SAP, y propaga `es_decoracion` a `ingredientes_masa` de masas activas en PESAJE aún sin pesar (no toca histórico ya confirmado). Automatizado también por cron 2x/día (6:00 y 21:00, America/Bogota — agregado 18-ago-2026, ver `backend/src/server.js`), además de disponible manual aquí. Rol `admin`/`supervisor`.

### 12. Sincronizar Inventario de Materia Prima (stock + lotes + atributos PT)

```bash
curl -X POST http://localhost:3000/api/sap/sincronizar-inventario-mp \
  -H "Authorization: Bearer $TOKEN"
```
Sin body. Escribe `sap_inventario_mp` (stock/costo de bodega `ALMP`) + `sap_lotes_mp` (solo ítems con `manage_batch_numbers = true`) + actualiza atributos de artículos PT en `sap_articulos` como sub-paso no crítico. Mismo cron 2x/día que BOM. Usa advisory lock (`pg_try_advisory_xact_lock`, key `990001`, compartido con el endpoint #13) — si ya hay una corrida en curso (manual o del cron), responde 409 en vez de solaparse. Rol `admin`/`supervisor`.

### 13. Sincronizar Lotes de Ítems Específicos (corrección puntual)

```bash
curl -X POST http://localhost:3000/api/sap/sincronizar-lotes-item \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "items": "MP0029,MP0080" }'
```
`items` **requerido** (400 si falta) — no tiene modo "sincronizar todos", a diferencia de `sincronizar-inventario-mp`. Pensado para corregir puntualmente uno o pocos ítems sin correr la sincronización completa. Comparte el mismo advisory lock que el endpoint #12. Rol `admin`/`supervisor`.
