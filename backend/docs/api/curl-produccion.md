# Ejemplos de Prueba de Endpoints - Flujo de Producción ARTESA API

Guía con ejemplos de cURL para las 8 fases de producción (Masas, Pesaje, Fases genérico, Formado, Fermentación, Horneado, Empaque). Mismo formato que `backend/CURL_EXAMPLES.md` (Auth+Usuarios) — se mantiene separado por tamaño, no por criterio distinto.

## 🔧 Requisitos

- `curl` instalado
- Servidor backend corriendo en `http://localhost:3000`
- Token de acceso obtenido vía `POST /api/auth/login` (ver `backend/CURL_EXAMPLES.md`)

## 📋 Tabla de Contenidos

1. [Masas](#masas) (10 endpoints)
2. [Pesaje](#pesaje) (6 endpoints)
3. [Fases (genérico)](#fases-genérico) (3 endpoints)
4. [Formado](#formado) (4 endpoints)
5. [Fermentación](#fermentación) (4 endpoints)
6. [Horneado](#horneado) (8 endpoints)
7. [Empaque](#empaque) (8 endpoints)

Todos requieren `Authorization: Bearer $TOKEN`. `:masaId`/`:id` es el id numérico de `masas_produccion`.

---

## Masas

### 1. Listar Masas por Fecha

```bash
TOKEN="your_token_here"

curl -X GET "http://localhost:3000/api/masas?fecha=2026-08-18" \
  -H "Authorization: Bearer $TOKEN"

# Filtrado además por fase (opcional)
curl -X GET "http://localhost:3000/api/masas?fecha=2026-08-18&fase=PESAJE" \
  -H "Authorization: Bearer $TOKEN"
```
`fecha` es requerida (400 si falta). `fase` es opcional, valores válidos: `PLANIFICACION|PESAJE|AMASADO|DIVISION|FORMADO|FERMENTACION|HORNEADO` (nota: no incluye `EMPAQUE` en el filtro, confirmado en el propio controller).

### 2. Obtener Detalle de una Masa

```bash
MASA_ID=1937

curl -X GET http://localhost:3000/api/masas/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Obtener Productos de una Masa

```bash
curl -X GET http://localhost:3000/api/masas/$MASA_ID/productos \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Obtener Composición/Ingredientes de una Masa

```bash
curl -X GET http://localhost:3000/api/masas/$MASA_ID/composicion \
  -H "Authorization: Bearer $TOKEN"
```

### 5. Actualizar Unidades Programadas de un Producto

```bash
curl -X PATCH http://localhost:3000/api/masas/$MASA_ID/productos/4821 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "delta_paquetes": 5, "motivo": "Ajuste manual por pedido adicional" }'
```
`delta_paquetes` es requerido (entero, puede ser `0` para quitar un ajuste previo). Solo funciona con la masa en `PLANIFICACION` y sin ningún ingrediente ya pesado (409 si no).

### 6. Aprobar una Masa

```bash
curl -X PATCH http://localhost:3000/api/masas/$MASA_ID/aprobar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fecha_vencimiento_sugerida": null,
    "prioridad": "ALTA",
    "hora_entrega": "14:00"
  }'
```
Los 3 campos son opcionales. Si `fecha_vencimiento_sugerida` se omite, se calcula sola desde `U_JZ_DiasExp` (SAP) de los productos de la masa (el más conservador si hay varios). Dispara correo individual a Empaque.

### 7. Aprobar Múltiples Masas (bulk)

```bash
curl -X PATCH http://localhost:3000/api/masas/aprobar-bulk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ids": [1937, 1938, 1939],
    "prioridad": "NORMAL"
  }'
```
`ids` es requerido (array no vacío). Misma lógica que aprobar individual, pero dispara UN solo correo resumen a Empaque en vez de uno por masa. `fallidas` en la respuesta lista cuáles no se pudieron aprobar sin tumbar las demás.

### 8. Marcar una Masa como Pendiente

```bash
curl -X PATCH http://localhost:3000/api/masas/$MASA_ID/pendiente \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "motivo": "Falta confirmar disponibilidad de insumo" }'
```
`motivo` es opcional. Solo funciona en estado `PLANIFICACION` o `APROBADA`, y bloquea si ya hay ingredientes con `timestamp_peso` registrado (pesaje físico real ya hecho).

### 9. Info Previa a Cancelación

```bash
curl -X GET http://localhost:3000/api/masas/$MASA_ID/cancelacion-info \
  -H "Authorization: Bearer $TOKEN"
```
Devuelve qué sub-masas (si hubo subdivisión) están bloqueadas por pesaje ya confirmado en SAP — para decidir si hace falta `confirmar_parcial` al cancelar.

### 10. Cancelar una Masa

```bash
curl -X PATCH http://localhost:3000/api/masas/$MASA_ID/cancelar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "motivo": "OV cancelada por el cliente",
    "confirmar_parcial": false
  }'
```
`motivo` es **requerido** (400 si vacío). Solo permitido en estado `PLANIFICACION`, `APROBADA` o `SUBDIVIDIDA`, y nunca si el pesaje ya fue confirmado en SAP (403). Si la masa tiene sub-masas y alguna ya está bloqueada por SAP, responde 409 pidiendo `confirmar_parcial: true` para cancelar solo las cancelables.

---

## Pesaje

### 1. Obtener Checklist de Pesaje

```bash
curl -X GET http://localhost:3000/api/pesaje/$MASA_ID/checklist \
  -H "Authorization: Bearer $TOKEN"
```

### 2. Actualizar un Ingrediente (disponible/verificado/pesado)

Editable solo mientras la masa está en `PLANIFICACION`, `PESAJE` o `AMASADO` — bloqueado a partir de `DIVISION`.

```bash
curl -X PATCH http://localhost:3000/api/pesaje/$MASA_ID/ingredientes/22580 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "disponible": true,
    "verificado": true,
    "pesado": true,
    "peso_real": 2370.74,
    "lote": null
  }'
```

Ingrediente con reserva multi-lote (`manage_batch_numbers = true`, split entre varios lotes — ver `backend/VALIDACION_CHECKLIST_PESAJE.md`):
```bash
curl -X PATCH http://localhost:3000/api/pesaje/$MASA_ID/ingredientes/22570 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pesado": true,
    "peso_real": 4741.00,
    "lotes_consumo": [
      { "batch": "110426B", "cantidad_kg": 3.5 },
      { "batch": "110426C", "cantidad_kg": 1.241 }
    ]
  }'
```

### 3. Confirmar Pesaje (transmite consumo real a SAP)

```bash
curl -X POST http://localhost:3000/api/pesaje/$MASA_ID/confirmar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fecha_local": "2026-08-18" }'
```
`fecha_local` es opcional (default: fecha del servidor). Dispara `enviarInventoryGenExits` — ver `backend/VALIDACION_CHECKLIST_PESAJE.md` para el detalle de cómo se arma el documento (con lote vs. sin lote, agua incluida desde el 18-ago-2026).

### 4. Enviar Correo a Empaque

```bash
curl -X POST http://localhost:3000/api/pesaje/$MASA_ID/enviar-correo \
  -H "Authorization: Bearer $TOKEN"
```
Sin body — requiere que PESAJE ya esté `COMPLETADA`.

### 5. Listar Ajustes Pendientes de SAP

```bash
curl -X GET http://localhost:3000/api/pesaje/$MASA_ID/ajustes-pendientes \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Confirmar (transmitir) Ajustes Pendientes

```bash
curl -X POST http://localhost:3000/api/pesaje/$MASA_ID/ajustes-pendientes/confirmar \
  -H "Authorization: Bearer $TOKEN"
```
Sin body — falla con 422 si el pesaje original aún no se transmitió a SAP, o si algún ajuste no tiene lote registrado.

---

## Fases (genérico)

Endpoints de progreso general — aplican a las 8 fases por igual para consulta/inicio, pero **el body de "completar" varía por fase** (ver nota al final de esta sección).

### 1. Obtener Progreso de Fases de una Masa

```bash
curl -X GET http://localhost:3000/api/fases/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 2. Actualizar Progreso de una Fase (iniciar/actualizar)

```bash
curl -X PUT http://localhost:3000/api/fases/$MASA_ID/progreso \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fase": "AMASADO",
    "accion": "iniciar",
    "datos": {}
  }'
```
`fase` ∈ `PLANIFICACION|PESAJE|AMASADO|DIVISION|FORMADO|FERMENTACION|HORNEADO|EMPAQUE`. `accion` ∈ `iniciar|actualizar|completar`. Para `accion: "actualizar"`, `datos.porcentaje` es opcional (default 50 si se omite).

### 3. Completar una Fase Específica

```
PUT /api/fases/:masaId/:fase/completar
```

**Ejemplo real validado — DIVISION** (cantidades divididas por producto; valida contra `multiplo_divisor` y bloquea si algún producto queda en 0 o no es múltiplo correcto):
```bash
curl -X PUT http://localhost:3000/api/fases/$MASA_ID/DIVISION/completar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cantidades_divididas": { "4821": 120, "4822": 80 },
    "observaciones": "División completada sin novedad"
  }'
```

**No pude confirmar con certeza el body real de las otras 7 fases en esta pasada** — `completarFase` (`fases.controller.js`) tiene un `switch`/bloque `if` por fase con lógica propia para cada una (PLANIFICACION en particular tiene validaciones de aprobación bastante más complejas que las demás, con sus propias guardas de subdivisión). En vez de inventar el body, la recomendación es: para AMASADO, FORMADO, FERMENTACION, HORNEADO y EMPAQUE, **usar los endpoints dedicados de cada módulo** (ver secciones de abajo — `POST /api/formado/:masaId/completar`, etc.), que son los que realmente usa el frontend; este endpoint genérico de `fases` existe pero PLANIFICACION y DIVISION son los únicos casos que confirmé a fondo hoy.

---

## Formado

### 1. Obtener Información de Formado

```bash
curl -X GET http://localhost:3000/api/formado/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```
Si ningún producto de la masa requiere formado (`productos_por_masa.requiere_formado = false` en todos), responde `data.no_requiere_formado: true` con la fase siguiente sugerida, no un error.

### 2. Iniciar Formado

```bash
curl -X POST http://localhost:3000/api/formado/$MASA_ID/iniciar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "observaciones": "Inicio de formado" }'
```
`observaciones` es opcional. **No lleva `maquina_formado_id`** — la máquina se asigna por producto individual (ver siguiente endpoint), no a nivel de toda la masa.

### 3. Actualizar Máquina/Unidades de un Producto (Fase 5, por SKU)

```bash
curl -X PATCH http://localhost:3000/api/formado/$MASA_ID/detalle/4821 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "maquina_formado_id": 1, "unidades_formadas": 120 }'
```
Ambos campos opcionales de forma independiente (se puede actualizar solo la máquina o solo las unidades). `maquina_formado_id` debe existir en `maquinas_formado` (404 si no).

### 4. Completar Formado

```bash
curl -X POST http://localhost:3000/api/formado/$MASA_ID/completar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "observaciones": "Formado completado con medidas correctas" }'
```
Bloquea (400) si algún producto que requiere formado quedó con `unidades_formadas <= 0`, y (409) si hay ajustes de pesaje pendientes de transmitir a SAP.

---

## Fermentación

### 1. Obtener Información de Fermentación

```bash
curl -X GET http://localhost:3000/api/fermentacion/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```
Incluye `camaras_disponibles` (catálogo `camaras_fermentacion`, incluida la cámara fría como una opción más, no un flujo aparte) y `detalles` (líneas ya registradas, si existe una sesión en curso).

### 2. Registrar Entrada a Cámara (por producto/línea)

```bash
curl -X POST http://localhost:3000/api/fermentacion/$MASA_ID/camara/entrada/4821 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "camara_id": 2,
    "temperatura_camara": 28.5,
    "humedad_camara": 75,
    "hora_entrada_real": null
  }'
```
Todos los campos opcionales excepto que si se omite `hora_entrada_real`, se usa `NOW()`. La primera línea que entra crea automáticamente el header de sesión (`registros_fermentacion`) si no existe — requiere que FORMADO o DIVISION ya esté `COMPLETADA`.

### 3. Registrar Salida de Cámara (por producto/línea)

```bash
curl -X POST http://localhost:3000/api/fermentacion/$MASA_ID/camara/salida/4821 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "hora_salida_real": null }'
```
`hora_salida_real` opcional (default `NOW()`). Falla con 400 si esa línea no tiene entrada registrada todavía.

### 4. Completar Fermentación

```bash
curl -X POST http://localhost:3000/api/fermentacion/$MASA_ID/completar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "observaciones": "Todas las líneas completaron fermentación" }'
```
Exige que **todos** los productos de la masa tengan salida de cámara registrada (400 con la lista de líneas faltantes si no). Desbloquea HORNEADO.

---

## Horneado

### 1. Catálogo de Hornos

```bash
curl -X GET http://localhost:3000/api/horneado/hornos \
  -H "Authorization: Bearer $TOKEN"
```

### 2. Catálogo de Programas de Horneo

```bash
curl -X GET http://localhost:3000/api/horneado/programas \
  -H "Authorization: Bearer $TOKEN"

# Filtrado por tipo de masa (opcional)
curl -X GET "http://localhost:3000/api/horneado/programas?tipo_masa=GOLD" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Obtener Información de Horneado

```bash
curl -X GET http://localhost:3000/api/horneado/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Iniciar Horneado

```bash
curl -X POST http://localhost:3000/api/horneado/$MASA_ID/iniciar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tipo_horno_id": 1,
    "programa_horneo_id": 3,
    "temperatura_inicial_real": 180,
    "uso_damper_real": false,
    "observaciones": null
  }'
```
`tipo_horno_id` requerido (404 si no existe). Si el horno es tipo `PISO`, solo admite `numero_programa = 1` (400 si no). `uso_damper_real: true` falla (400) si el horno no tiene damper.

### 5. Actualizar Temperaturas Durante Horneado

```bash
curl -X PATCH http://localhost:3000/api/horneado/$MASA_ID/temperaturas \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "temperatura_media_real": 200, "temperatura_final_real": 220 }'
```
Ambos opcionales de forma independiente (`COALESCE` contra el valor anterior).

### 6. Actualizar Damper Durante Horneado

```bash
curl -X PATCH http://localhost:3000/api/horneado/$MASA_ID/damper \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "tiempo_inicio_damper_real": "2026-08-18T14:10:00", "tiempo_fin_damper_real": null }'
```

### 7. Completar Horneado

```bash
curl -X POST http://localhost:3000/api/horneado/$MASA_ID/completar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "calidad_color": "BUENO",
    "calidad_coccion": "COMPLETA",
    "observaciones": null,
    "unidades_por_producto": { "4821": 118, "4822": 79 }
  }'
```
`unidades_por_producto` es el desglose por SKU (recomendado); alternativamente se puede mandar solo `unidades_terminadas` (total) y el sistema prorratea proporcional a `cantidad_divisiones` de cada producto. Bloquea (400) si algún producto activo queda en 0 unidades — SAP no permite crear una OV sin cantidad. Avanza la masa a EMPAQUE.

### 8. Editar Unidades por Producto (retroactivo, solo admin/supervisor)

```bash
curl -X PATCH http://localhost:3000/api/horneado/$MASA_ID/unidades-por-producto \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "unidades_por_producto": { "4821": 120, "4822": 80 },
    "motivo": "Corrección tras reconteo físico en bodega"
  }'
```
`motivo` requerido, mínimo 5 caracteres (400 si no). Requiere rol `admin` o `supervisor` (403 si no). Queda auditado campo a campo en `auditoria_modificaciones`.

---

## Empaque

### 1. Masas con Horneado Completo y Empaque Pendiente

```bash
curl -X GET "http://localhost:3000/api/empaque/pendientes?fecha=2026-08-18" \
  -H "Authorization: Bearer $TOKEN"
```
`fecha` opcional (default: hoy).

### 2. Resumen Consolidado por SKU/Variedad (para bodega)

```bash
curl -X GET "http://localhost:3000/api/empaque/resumen-variedad?fecha=2026-08-18" \
  -H "Authorization: Bearer $TOKEN"
```
`fecha` opcional (default: hoy).

### 3. Vista Consolidada por Orden de Venta

```bash
curl -X GET http://localhost:3000/api/empaque/ov/12345 \
  -H "Authorization: Bearer $TOKEN"
```
`:docNum` es el número de documento de la OV en SAP.

### 4. Obtener Información de Empaque de una Masa

```bash
curl -X GET http://localhost:3000/api/empaque/$MASA_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 5. Iniciar Empaque

```bash
curl -X POST http://localhost:3000/api/empaque/$MASA_ID/iniciar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fecha_vencimiento": "2026-08-25", "observaciones": null }'
```
`fecha_vencimiento` **requerida** (400 si falta). Requiere HORNEADO ya `COMPLETADA` (400 si no) y que no exista ya un registro de empaque para la masa (400 si ya existe — no duplica).

### 6. Actualizar Detalle de Empaque de un Producto

```bash
curl -X PATCH http://localhost:3000/api/empaque/$MASA_ID/detalle/4821 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "unidades_empacadas": 30, "unidades_merma": 1 }'
```
`unidades_empacadas` llega en **paquetes** (lo que teclea el operario), se convierte internamente a panes (`× unidades_por_paquete`) antes de reflejarse en `productos_por_masa.unidades_producidas` — no mandar ya convertido.

### 7. Completar Empaque

```bash
curl -X POST http://localhost:3000/api/empaque/$MASA_ID/completar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "observaciones": null, "fecha_local": "2026-08-18" }'
```
`fecha_local` opcional (default: fecha del servidor). Esta es la fase que cierra el ciclo completo de la masa — transmite documentos SAP propios de empaque (`sap_doc_entry_entrada`/`sap_doc_entry_salida` en `registros_empaque`), no reutiliza el `InventoryGenExits` de Pesaje.

### 8. Obtener Etiqueta de un Producto

```bash
curl -X GET http://localhost:3000/api/empaque/$MASA_ID/etiqueta/4821 \
  -H "Authorization: Bearer $TOKEN"
```
