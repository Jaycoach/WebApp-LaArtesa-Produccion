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
- `usuario_peso`: INTEGER (FK a users)
- `timestamp_peso`: TIMESTAMP

## Seguridad

- Todas las rutas requieren autenticación
- Solo usuarios autorizados pueden confirmar el pesaje
- Se registra trazabilidad de todas las acciones
