# Validación de Checklist de Pesaje

## Descripción

El sistema implementa una validación estricta del checklist de pesaje antes de permitir avanzar a la siguiente fase de producción. Esta validación garantiza que todos los ingredientes hayan sido verificados y pesados correctamente.

## Flujo de Validación

### 1. Revisión de Ingredientes

Cada ingrediente de la masa debe pasar por tres estados:

- **Disponible**: El ingrediente está físicamente disponible en el área de pesaje
- **Verificado**: Se ha verificado que es el ingrediente correcto (código SAP, lote, fecha de vencimiento)
- **Pesado**: El ingrediente ha sido pesado y se ha registrado el peso real

### 2. Endpoint de Confirmación

**Ruta**: `POST /api/pesaje/:masaId/confirmar`

**Validaciones**:
1. Verifica que TODOS los ingredientes tengan `disponible = true`
2. Verifica que TODOS los ingredientes tengan `verificado = true`
3. Verifica que TODOS los ingredientes tengan `pesado = true`

**Respuesta en caso de éxito**:
```json
{
  "success": true,
  "message": "Pesaje confirmado exitosamente",
  "data": {
    "fase_completada": "PESAJE",
    "fase_desbloqueada": "AMASADO"
  }
}
```

**Respuesta en caso de ingredientes faltantes**:
```json
{
  "success": false,
  "message": "No se puede confirmar el pesaje. Hay ingredientes pendientes.",
  "data": {
    "total": 10,
    "completados": 8,
    "faltantes": ["Sal", "Levadura"]
  }
}
```

### 3. Flujo de Trabajo

```
1. Usuario inicia fase de PESAJE
   ↓
2. Sistema muestra checklist de ingredientes
   ↓
3. Por cada ingrediente:
   - Marca como disponible
   - Verifica ingrediente (código, lote, fecha vencimiento)
   - Pesa ingrediente (registra peso real)
   ↓
4. Usuario intenta confirmar pesaje
   ↓
5. Sistema valida que TODOS los ingredientes estén completos
   ↓
6. Si validación pasa:
   - Marca fase PESAJE como COMPLETADA
   - Desbloquea fase AMASADO
   - Permite continuar con producción
   ↓
7. Si validación falla:
   - Muestra ingredientes faltantes
   - NO permite avanzar a siguiente fase
   - Usuario debe completar ingredientes pendientes
```

## Endpoints Relacionados

### Obtener Checklist
```
GET /api/pesaje/:masaId/checklist

Respuesta:
{
  "success": true,
  "data": {
    "masa_id": 1,
    "tipo_masa": "PAN_BLANCO",
    "ingredientes": [...],
    "todosDisponibles": false,
    "todosVerificados": false,
    "todosPesados": false,
    "completado": false,
    "progreso": 67
  }
}
```

### Actualizar Ingrediente
```
PATCH /api/pesaje/:masaId/ingredientes/:ingredienteId

Body:
{
  "disponible": true,
  "verificado": true,
  "pesado": true,
  "peso_real": 5250,
  "lote": "L2024001",
  "fecha_vencimiento": "2024-12-31"
}
```

## Reglas de Negocio

1. **No se puede avanzar sin pesaje completo**: El sistema NO permite avanzar a la fase de AMASADO si el checklist de pesaje no está 100% completo.

2. **Registro de diferencias**: El sistema calcula automáticamente la diferencia entre el peso teórico y el peso real.

3. **Trazabilidad**: Se registra qué usuario realizó el pesaje y en qué momento (`usuario_peso`, `timestamp_peso`).

4. **Notificación a empaque**: Una vez completado el pesaje, se puede enviar una notificación al área de empaque.

## Consumo Real en SAP (InventoryGenExits)

Completar el checklist (marcar todos los ingredientes `pesado = true`) es necesario pero **no es lo mismo** que transmitir el consumo a SAP. Eso ocurre al confirmar el pesaje (`POST /api/pesaje/:masaId/confirmar` → `enviarInventoryGenExits`, `pesaje.controller.js`), que arma un documento `InventoryGenExits` (Service Layer) con una línea por ingrediente.

### Reserva de lotes (`pesaje_lotes_consumo`)

Para ingredientes con `manage_batch_numbers = true` en `sap_inventario_mp`, el operario puede repartir la cantidad pesada entre uno o varios lotes (split multi-lote, cuando un solo lote no alcanza). Esto se guarda en `pesaje_lotes_consumo` (`fases.model.js`, función `updateIngredienteChecklist`, líneas 305-363): por cada lote del array `lotes_consumo` recibido en el `PATCH` de ingrediente, valida contra `sap_lotes_mp.cantidad_disponible` (con `SELECT ... FOR UPDATE` para evitar condiciones de carrera) e inserta una fila `(ingrediente_id, masa_id, item_code, batch, cantidad_kg, usuario_id)`. La reserva es informativa — **no descuenta** `sap_lotes_mp.cantidad_disponible` (ese es el stock real reportado por SAP; no se toca hasta que SAP confirma el consumo).

Los ingredientes de decoración (`es_decoracion = true`) no requieren que el operario elija lote manualmente: `autoCompletarDecoracion` (`fases.model.js`, líneas 443-499) hace el split FEFO automático (ordena por `expiration_date ASC NULLS LAST, admission_date ASC NULLS LAST`) y reserva en `pesaje_lotes_consumo` de la misma forma.

### Armado del `DocumentLines` — con lote vs. sin lote

`enviarInventoryGenExits` combina dos queries en un solo mapa por `item_code`:

- **Con lote**: ingredientes con filas en `pesaje_lotes_consumo` — se agrupan por `item_code` sumando `cantidad_kg` de todos sus lotes reservados.
- **Sin lote**: ingredientes pesados sin fila en `pesaje_lotes_consumo` — típicamente porque `manage_batch_numbers = false` (agua) o porque no se usó el flujo de reserva — usan `peso_real / 1000` directo.

Al construir cada línea del documento, solo se agrega `BatchNumbers` si el ítem maneja lote:
```js
if (data.manage_batch_numbers && data.batches.length > 0) {
  line.BatchNumbers = data.batches.map(b => ({ BatchNumber: b.batch, Quantity: b.cantidad_kg }));
}
```
Un ingrediente sin manejo de lote (agua, `manage_batch_numbers = false`) **nunca** lleva `BatchNumbers` en su línea — es el formato correcto que SAP espera para ese tipo de ítem.

### Corrección 18-ago-2026: el agua SÍ se transmite como consumo real

Hasta el 10-ago-2026, una exclusión (`configuracion_sistema.ingredientes_excluir_stock_validacion` = `MP0007,MP0008`) se aplicaba también dentro de `enviarInventoryGenExits`, así que el agua se pesaba en el checklist pero **nunca llegaba a SAP** como consumo real — quedaba fuera del `DocumentLines` sin error ni aviso visible. Confirmado en staging con masa 1937 (`sap_sync_log` id 800): el documento enviado tuvo 12 de 13 líneas, sin `MP0007`.

La corrección del 18-ago-2026 quitó esa exclusión **solo dentro de `enviarInventoryGenExits`**. Es importante no confundir los dos usos de esa misma lista de configuración — son dos cosas distintas:

| Dónde | Qué hace la exclusión | ¿Se tocó el 18-ago? |
|---|---|---|
| `confirmarPesaje` / `getChecklist` (validación de stock en pantalla) | Un ingrediente excluido nunca bloquea el pesaje por falta de stock/lote en SAP — sigue siendo correcto, el agua no tiene lote que validar. | **No**, sigue igual. |
| `enviarInventoryGenExits` (envío real a SAP) | Antes sacaba al ingrediente excluido del documento completo. Ahora **ya no excluye nada** — todo ingrediente pesado con `peso_real > 0` se envía, con o sin lote según corresponda. | **Sí**, se quitó el filtro. |

El costo del agua en el documento y en `costos_masa` se toma de `sap_inventario_mp.costo_promedio` (mismo criterio que cualquier otro ingrediente desde el fix de B7, ago-2026) — nunca de una configuración manual.

### Manejo de error de SAP — stock insuficiente sin lote

Si SAP rechaza el `InventoryGenExits` por falta de stock real en un ítem sin lote (como el agua), el mensaje de SAP es del tipo `Quantity falls into negative inventory [DocumentLines.ItemCode][line: N]` — no trae el `ItemCode` directamente, solo el número de línea. Desde el 18-ago-2026, `enviarInventoryGenExits` detecta este patrón, ubica el ítem por el número de línea dentro del `requestPayload` ya armado, y devuelve un mensaje explícito: *"Stock insuficiente en SAP para {itemCode} ({itemName}) — no hay inventario suficiente para completar la salida. Verificar con Diana/SAP antes de reintentar."*, en vez de un 502 genérico. El mensaje técnico crudo de SAP se sigue guardando sin modificar en `sap_sync_log.error_message` — el mensaje amigable solo reemplaza lo que ve el usuario final.

**No se agregó ninguna exclusión nueva para este caso** — si el stock real de SAP es insuficiente, el documento debe fallar visiblemente, igual que con cualquier otro ingrediente sin stock. No hay reintentos automáticos.

## Frontend - Componentes Relacionados

- `checklistService.ts`: Servicio para interactuar con el checklist
- `PesajeMasa.tsx`: Componente principal de pesaje
- `ConfirmarPesaje.tsx`: Componente para confirmar el pesaje

## Base de Datos

Tabla: `ingredientes_masa`

Campos relevantes para el checklist:
- `disponible`: BOOLEAN
- `verificado`: BOOLEAN
- `pesado`: BOOLEAN
- `peso_real`: DECIMAL
- `diferencia_gramos`: DECIMAL (calculado automáticamente)
- `lote`: VARCHAR
- `fecha_vencimiento`: DATE
- `observaciones`: TEXT
- `usuario_peso`: INTEGER (FK a `usuarios.id`)
- `timestamp_peso`: TIMESTAMP

Campos relevantes para el consumo SAP y costeo (no estaban documentados antes):
- `es_agua`: BOOLEAN — identifica el/los ingredientes de agua de la masa.
- `es_empaque`: BOOLEAN — excluye el ingrediente del flujo de pesaje/consumo de MP (va por el flujo de empaque aparte).
- `es_decoracion`: BOOLEAN — habilita el auto-completado FEFO (`autoCompletarDecoracion`), no requiere pesaje manual.
- `peso_confirmado_sap`: DECIMAL — snapshot del peso que efectivamente quedó transmitido a SAP (para detectar ajustes pendientes si se edita el peso después).
- `costo_unitario_sap` / `costo_total_mp`: DECIMAL — tomados de `sap_inventario_mp.costo_promedio` al confirmar el pesaje, se guardan por ingrediente.

### Tablas relacionadas al consumo SAP

- `pesaje_lotes_consumo`: reserva de lote(s) por ingrediente pesado — `(ingrediente_id, masa_id, item_code, batch, cantidad_kg, usuario_id, confirmado_sap, liberado_en)`. Puede haber varias filas por ingrediente si se repartió entre varios lotes.
- `sap_inventario_mp`: caché de stock/costo/`manage_batch_numbers` por `item_code`, sincronizada desde SAP (no se escribe manualmente).
- `sap_lotes_mp`: caché de lotes disponibles por `item_code`, usada para armar sugerencias FEFO y validar disponibilidad al reservar.
- `costos_masa`: totales de costo de materia prima por masa, calculados al confirmar el pesaje (`costo_total_mp` agregado / kilos reales).

## Seguridad

- Todas las rutas requieren autenticación
- Solo usuarios autorizados pueden confirmar el pesaje
- Se registra trazabilidad de todas las acciones
