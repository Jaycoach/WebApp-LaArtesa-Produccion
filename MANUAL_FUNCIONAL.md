# MANUAL FUNCIONAL - SISTEMA DE GESTIÓN DE PRODUCCIÓN LA ARTESA

**Versión:** 2.0.0
**Fecha:** 23 de Enero de 2026
**Desarrollado para:** Artesa SAS
**Basado en:** Reuniones del 11/12/2025 y 23/01/2026

---

## ÍNDICE

1. [Introducción](#1-introducción)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Flujo General de Producción](#3-flujo-general-de-producción)
4. [Módulos del Sistema](#4-módulos-del-sistema)
5. [Procesos Detallados por Fase](#5-procesos-detallados-por-fase)
6. [Integración con SAP Business One](#6-integración-con-sap-business-one)
7. [Sistema de Auditoría](#7-sistema-de-auditoría)
8. [Configuración del Sistema](#8-configuración-del-sistema)
9. [Endpoints API](#9-endpoints-api)
10. [Casos de Uso](#10-casos-de-uso)
11. [Glosario](#11-glosario)

---

## 1. INTRODUCCIÓN

### 1.1 Objetivo del Sistema

El Sistema de Gestión de Producción de La Artesa es una solución integral diseñada para gestionar y controlar el proceso completo de producción de panadería, desde la sincronización de órdenes de fabricación en SAP Business One hasta el producto final horneado.

### 1.2 Alcance

El sistema cubre **7 fases del proceso productivo:**

1. **PLANIFICACION** - Sincronización y agrupación de órdenes
2. **PESAJE** - Checklist y pesaje de ingredientes
3. **AMASADO** - Preparación de masas
4. **DIVISION** - Corte y división de masas
5. **FORMADO** - Formación de piezas individuales
6. **FERMENTACION** - Reposo en cámaras controladas
7. **HORNEADO** - Cocción final

### 1.3 Usuarios del Sistema

- **Administradores:** Configuración, sincronización SAP, gestión de usuarios
- **Supervisores:** Monitoreo de producción, ajustes operativos
- **Operarios:** Ejecución de procesos en cada fase
- **Personal de Calidad:** Verificación y control de calidad
- **Auditores:** Revisión de registros y trazabilidad

### 1.4 Fecha Límite Crítica

**28 de Febrero de 2026** - Fecha en que se retira el sistema AyM Soft actual.

**MVP Prioritario:** Llegar hasta fase de **DIVISION** como mínimo funcional.

---

## 2. ARQUITECTURA DEL SISTEMA

### 2.1 Tecnologías

**Backend:**
- Node.js + Express.js
- PostgreSQL 14+
- JWT para autenticación
- Axios para comunicación con SAP

**Frontend:**
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Zustand (State Management)
- React Query (Server State)

**Integración:**
- SAP Business One Service Layer API
- SMTP para notificaciones por email

### 2.2 Base de Datos Principal

**Tablas Core de Producción:**

```
masas_produccion
├── productos_por_masa
├── ingredientes_masa
├── progreso_fases
├── registros_amasado
├── registros_division
├── registros_formado
├── registros_fermentacion
└── registros_horneado
```

**Tablas de Configuración:**

```
catalogo_tipos_masa        # Mapeo SAP → Tipo de Masa
catalogo_productos         # Catálogo de productos
amasadoras                 # Máquinas amasadoras
maquinas_corte             # Máquinas de división
maquinas_formado           # Máquinas formadoras
tipos_horno                # Catálogo de hornos
programas_horneo           # Programas de horneado (1-40)
especificaciones_formado   # Medidas esperadas por producto
configuracion_sistema      # Configuración global
```

**Tablas de Auditoría:**

```
auditoria_cambios          # Auditoría automática de cambios
auditoria                  # Auditoría general heredada
sap_sync_log               # Log de sincronizaciones SAP
notificaciones_empaque     # Registro de correos enviados
```

---

## 3. FLUJO GENERAL DE PRODUCCIÓN

### 3.1 Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────────────┐
│  SAP BUSINESS ONE                                               │
│  Órdenes de Fabricación (OWOR)                                  │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Sincronización Automática/Manual
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. PLANIFICACION                                               │
│  - Agrupación por tipo de masa                                  │
│  - Cálculo de ingredientes                                      │
│  - Aplicación de factor de absorción                            │
│  - Cálculo de mermas                                            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Usuario modifica unidades programadas
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. PESAJE                                                       │
│  - Checklist de ingredientes (disponible → verificado → pesado) │
│  - Registro de pesos reales vs teóricos                         │
│  - Registro de lotes y vencimientos                             │
│  - Integración opcional con balanzas                            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Todos los ingredientes pesados
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. AMASADO                                                      │
│  - Selección de amasadora                                       │
│  - Registro de velocidades (V1, V2)                             │
│  - Control de temperaturas (masa final, agua)                   │
│  - Tiempo de reposo opcional                                    │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Masa lista
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. DIVISION                                                     │
│  - Reposo pre-división (condicional según tipo de masa)         │
│  - División en Conic u otras máquinas                           │
│  - Registro de cantidades divididas por producto/tamaño         │
│  - Control de temperatura de entrada                            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Masas con/sin formado
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. FORMADO (Condicional)                                        │
│  - Solo aplica a ciertos tipos de masa                          │
│  - Formación manual o automática                                │
│  - Verificación de medidas (largo, ancho, alto, diámetro)       │
│  - Registro de cantidades formadas                              │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Piezas formadas
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. FERMENTACION                                                 │
│  - Entrada a cámara de fermentación                             │
│  - Hora sugerida de salida (auto-calculada)                     │
│  - Hora real de salida (ingresada por operario)                 │
│  - Cámara de frío (condicional según tipo de masa)              │
│  - Control de temperatura y humedad                             │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Fermentación completada
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. HORNEADO                                                     │
│  - Selección de horno (Rotativo 1/2/3 o Piso)                  │
│  - Selección de programa (1-40)                                 │
│  - Registro de temperaturas (inicial, media, final)             │
│  - Control de damper (apertura/cierre de vapor)                 │
│  - Registro de calidad (color, cocción)                         │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Producción completada
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRODUCTO TERMINADO                                             │
│  - Registro de unidades producidas vs programadas                │
│  - Actualización de inventarios en SAP (futuro)                 │
│  - Disponible para empaque y distribución                       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Estados de una Masa de Producción

```
PLANIFICACION → EN_PROCESO → COMPLETADA
                     ↓
                CANCELADA (excepcional)
```

### 3.3 Estados de una Fase

```
BLOQUEADA → EN_PROGRESO → COMPLETADA
                ↓
         REQUIERE_ATENCION (excepcional)
```

---

## 4. MÓDULOS DEL SISTEMA

### 4.1 Módulo de Autenticación y Usuarios

**Características:**
- Login con JWT (Access Token + Refresh Token)
- Roles: ADMIN, SUPERVISOR, OPERARIO, CALIDAD, AUDITOR
- Bloqueo automático tras 5 intentos fallidos (30 minutos)
- Cambio de contraseña y recuperación
- Perfil de usuario

**Endpoints principales:**
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
POST   /api/auth/change-password
GET    /api/auth/profile
```

### 4.2 Módulo de Sincronización SAP

**Características:**
- Conexión con SAP Business One Service Layer
- Sincronización manual o automática (cron)
- Agrupación de órdenes por tipo de masa
- Mapeo de códigos SAP a tipos de masa
- Verificación de stock en SAP

**Endpoints principales:**
```
POST   /api/sap/sincronizar
GET    /api/sap/ordenes
GET    /api/sap/stock/:masaId
GET    /api/sap/historial
```

**Configuración SAP requerida:**
```env
SAP_URL=https://sap-server:50000/b1s/v1
SAP_COMPANY=ARTESA_SAS
SAP_USER=api_user
SAP_PASSWORD=***
```

### 4.3 Módulo de Gestión de Masas

**Características:**
- Visualización de masas por fecha
- Detalle de masa con productos e ingredientes
- Actualización de unidades programadas
- Cálculo automático de mermas (5% por defecto)

**Endpoints principales:**
```
GET    /api/masas?fecha=YYYY-MM-DD
GET    /api/masas/:id
GET    /api/masas/:id/productos
GET    /api/masas/:id/composicion
PATCH  /api/masas/:masaId/productos/:productoId
```

### 4.4 Módulo de Pesaje (Checklist)

**Características:**
- Checklist de 3 pasos por ingrediente:
  1. **Disponible:** ¿Está disponible el ingrediente?
  2. **Verificado:** ¿Se verificó visualmente?
  3. **Pesado:** ¿Se pesó y registró el peso real?
- Registro de lotes y fechas de vencimiento
- Cálculo de diferencias (peso real vs teórico)
- Integración futura con balanzas digitales
- Notificación automática a empaque vía email

**Endpoints principales:**
```
GET    /api/pesaje/:masaId/checklist
PATCH  /api/pesaje/:masaId/ingredientes/:ingredienteId
POST   /api/pesaje/:masaId/confirmar
POST   /api/pesaje/:masaId/enviar-correo
```

**Estructura del checklist:**
```json
{
  "disponible": true,
  "verificado": true,
  "pesado": true,
  "peso_real": 1050.5,
  "diferencia_gramos": 0.5,
  "lote": "L2026-001",
  "fecha_vencimiento": "2026-06-30"
}
```

### 4.5 Módulo de Amasado

**Características:**
- Selección de amasadora (4 disponibles)
- Registro de tiempos de velocidad 1 y 2
- Control de temperatura de masa final y agua
- Tiempo de reposo opcional
- Desbloqueo automático de fase DIVISION

**Endpoints (integrados en fases):**
```
GET    /api/fases/:masaId
PUT    /api/fases/:masaId/progreso
```

**Datos registrados:**
```
- Amasadora utilizada
- Velocidad 1 (minutos)
- Velocidad 2 (minutos)
- Temperatura masa final (°C)
- Temperatura agua (°C)
- Usuario responsable
- Observaciones
```

### 4.6 Módulo de División

**Características:**
- Reposo pre-división condicional (según tipo de masa)
- División en Conic o máquinas manuales
- Registro de cantidades divididas por producto/tamaño
- Control de temperatura de entrada
- Actualización de cantidades en `productos_por_masa`

**Endpoints (integrados en fases):**
```
GET    /api/fases/:masaId
PUT    /api/fases/:masaId/progreso
```

**Datos registrados:**
```
- Máquina de corte utilizada
- Requiere reposo (sí/no)
- Hora inicio/fin de reposo
- Tiempo de reposo (minutos)
- Temperatura de entrada (°C)
- Cantidades divididas por producto
```

### 4.7 Módulo de Formado

**Características:**
- Solo aplica a tipos de masa configurados
- Formadoras automáticas (3) o manual
- Verificación de medidas (largo, ancho, alto, diámetro)
- Especificaciones por tipo de masa
- Registro de duraciones

**Endpoints principales:**
```
GET    /api/formado/:masaId
POST   /api/formado/:masaId/iniciar
POST   /api/formado/:masaId/completar
```

**Datos registrados:**
```
- Máquina formadora utilizada
- Fecha/hora inicio
- Fecha/hora fin
- Duración (minutos)
- Usuario responsable
- Observaciones
```

**Especificaciones de medidas:**
| Tipo Masa | Largo (cm) | Ancho (cm) | Alto (cm) | Diámetro (cm) |
|-----------|------------|------------|-----------|---------------|
| Toscano   | 30         | 19         | -         | -             |
| Gold      | -          | -          | 3         | 10            |
| Croissant | 15         | 8          | 5         | -             |

### 4.8 Módulo de Fermentación

**Características:**
- Cámara de fermentación (obligatoria)
- Hora de salida sugerida (auto-calculada)
- Hora de salida real (ingresada por operario)
- Cámara de frío condicional (según tipo de masa)
- Control de temperatura y humedad
- Tiempos estándar configurables por tipo de masa

**Endpoints principales:**
```
GET    /api/fermentacion/:masaId
POST   /api/fermentacion/:masaId/camara/entrada
POST   /api/fermentacion/:masaId/camara/salida
POST   /api/fermentacion/:masaId/frio/entrada
POST   /api/fermentacion/:masaId/frio/salida
```

**Flujo de fermentación:**

```
Entrada Cámara → Fermentación → Salida Cámara
                                     ↓
                            ¿Requiere Frío? ───No──→ COMPLETADO
                                     │
                                    Sí
                                     │
                            Entrada Frío → Salida Frío → COMPLETADO
```

**Tiempos estándar por tipo de masa:**
- Pan Árabe: 40 minutos
- Hamburguesa Gold: 45 minutos
- Brioche: 50 minutos
- Ciabatta: 60 minutos
- Croissant: 120 minutos (+ frío)

### 4.9 Módulo de Horneado

**Características:**
- 4 hornos: Rotativo 1, 2, 3 y Piso
- 40 programas de horneado configurables
- Control de temperaturas (inicial, media, final)
- Damper (extracción de vapor) condicional
- Registro de calidad (color, cocción)
- Horno de Piso: NO tiene damper (ideal para baguettes)

**Endpoints principales:**
```
GET    /api/horneado/hornos
GET    /api/horneado/programas?tipo_masa=GOLD
GET    /api/horneado/:masaId
POST   /api/horneado/:masaId/iniciar
PATCH  /api/horneado/:masaId/temperaturas
PATCH  /api/horneado/:masaId/damper
POST   /api/horneado/:masaId/completar
```

**Programas de horneado configurados:**

| Programa | Nombre                | T. Inicial | T. Media | T. Final | Tiempo | Damper | Tipo Masa Sugerido |
|----------|----------------------|------------|----------|----------|--------|--------|--------------------|
| 1        | Hamburguesas Estándar| 180°C      | 200°C    | 190°C    | 15 min | Sí     | GOLD               |
| 2        | Hamburguesas Brioche | 170°C      | 185°C    | 180°C    | 18 min | Sí     | BRIOCHE            |
| 4        | Croissant            | 180°C      | 200°C    | 190°C    | 22 min | Sí     | CROISSANT          |
| 7        | Baguette Tradicional | 240°C      | 230°C    | 220°C    | 25 min | No     | BAGUETTE           |
| 8        | Pan Árabe            | 230°C      | 240°C    | 230°C    | 8 min  | Sí     | ARABE              |

**Datos registrados:**
```
- Horno utilizado
- Programa de horneado
- Hora entrada/salida
- Tiempo total (minutos)
- Temperaturas reales (inicial, media, final)
- Uso de damper (sí/no)
- Tiempos damper (inicio, fin en minutos)
- Calidad color (PERFECTO, CLARO, OSCURO)
- Calidad cocción (PERFECTO, CRUDO, SOBRE_COCIDO)
```

### 4.10 Módulo de Configuración

**Características:**
- Factor de absorción de harina (global)
- Correos de notificación de empaque
- Configuraciones por tipo de masa
- Gestión de catálogos (hornos, amasadoras, etc.)

**Endpoints principales:**
```
GET    /api/config/factor-absorcion
PUT    /api/config/factor-absorcion
GET    /api/config/correos
PUT    /api/config/correos
```

**Configuraciones clave:**
```
factor_absorcion_harina: 60% (por defecto)
correos_empaque: empaque@artesa.com, bodega@artesa.com
```

### 4.11 Módulo de Auditoría

**Características:**
- Auditoría automática con triggers PostgreSQL
- Registro de INSERT, UPDATE, DELETE
- Captura de datos anteriores y nuevos (JSONB)
- Cálculo automático de campos modificados
- Trazabilidad completa por masa y usuario
- Vistas pre-configuradas para consultas

**Tablas y vistas:**
```
auditoria_cambios              # Tabla principal
v_auditoria_por_masa           # Vista por masa
v_auditoria_por_usuario        # Vista por usuario
v_auditoria_reciente           # Últimas 24 horas
```

**Funciones útiles:**
```sql
-- Obtener historial de un registro
SELECT * FROM obtener_historial_registro('masas_produccion', 123);

-- Purgar auditoría antigua (>90 días)
SELECT purgar_auditoria_antigua(90);
```

**Triggers automáticos en:**
- masas_produccion
- productos_por_masa
- ingredientes_masa
- progreso_fases
- registros_amasado
- registros_division
- registros_formado
- registros_fermentacion
- registros_horneado
- configuracion_sistema
- catalogo_tipos_masa
- programas_horneo

---

## 5. PROCESOS DETALLADOS POR FASE

### 5.1 FASE 1: PLANIFICACION

**Objetivo:** Sincronizar órdenes de SAP y agrupar por tipo de masa.

**Proceso:**

1. **Sincronización Manual/Automática**
   ```
   POST /api/sap/sincronizar
   Body: {
     "fecha": "2026-01-23",
     "forzar": false
   }
   ```

2. **Sistema realiza:**
   - Conecta con SAP Business One
   - Obtiene órdenes de fabricación liberadas (Status = 'R')
   - Busca tipo de masa en `catalogo_tipos_masa` por `codigo_sap`
   - Agrupa órdenes con mismo `tipo_masa`
   - Calcula total de kilos base
   - Aplica merma por defecto (5%)
   - Aplica factor de absorción actual
   - Crea masa en `masas_produccion`
   - Inserta productos en `productos_por_masa`
   - Escala ingredientes de la receta SAP
   - Inserta ingredientes en `ingredientes_masa`
   - Crea registros de progreso para todas las fases

3. **Resultado:**
   - Una o más masas creadas (agrupadas por tipo)
   - Estado: PLANIFICACION
   - Fase actual: PLANIFICACION

**Reglas de negocio:**
- Si no existe mapeo SAP → Tipo de Masa, la orden no se procesa (advertencia)
- Merma por defecto: 5%
- Factor de absorción: Se toma de `configuracion_sistema`
- Todas las fases inician en estado BLOQUEADA

### 5.2 FASE 2: PESAJE

**Objetivo:** Verificar disponibilidad y pesar todos los ingredientes.

**Proceso:**

1. **Acceder a checklist**
   ```
   GET /api/pesaje/:masaId/checklist
   ```

2. **Operario marca checklist (por cada ingrediente):**
   ```
   PATCH /api/pesaje/:masaId/ingredientes/:ingredienteId
   Body: {
     "disponible": true,
     "verificado": true,
     "pesado": true,
     "peso_real": 1050.5,
     "lote": "L2026-001",
     "fecha_vencimiento": "2026-06-30"
   }
   ```

3. **Confirmar pesaje completado**
   ```
   POST /api/pesaje/:masaId/confirmar
   ```

4. **Sistema valida:**
   - Todos los ingredientes tienen `disponible = TRUE`
   - Todos los ingredientes tienen `verificado = TRUE`
   - Todos los ingredientes tienen `pesado = TRUE`

5. **Si validación OK:**
   - Marca fase PESAJE como COMPLETADA
   - Desbloquea fase AMASADO
   - Actualiza `fase_actual` de la masa

**Reglas de negocio:**
- No se puede completar si falta algún ingrediente
- Se calculan diferencias: `peso_real - cantidad_gramos`
- Registro de usuario responsable
- Opcional: Envío de correo a empaque

**Integración futura con balanzas:**
- Campo `peso_real` se llenará automáticamente desde balanza
- Requiere configuración de puerto USB/Serial
- Validación de peso mínimo/máximo

### 5.3 FASE 3: AMASADO

**Objetivo:** Preparar la masa con velocidades y temperaturas controladas.

**Proceso:**

1. **Acceder a información de amasado**
   ```
   GET /api/fases/:masaId
   ```

2. **Iniciar amasado (actualizar progreso)**
   ```
   PUT /api/fases/:masaId/progreso
   Body: {
     "fase": "AMASADO",
     "porcentaje": 50,
     "datos_fase": {
       "amasadora_id": 1,
       "velocidad_1_minutos": 8,
       "velocidad_2_minutos": 12,
       "temperatura_agua": 18.0
     }
   }
   ```

3. **Completar amasado**
   ```
   PUT /api/fases/:masaId/AMASADO/completar
   Body: {
     "temperatura_masa_final": 26.5,
     "observaciones": "Amasado correcto"
   }
   ```

4. **Sistema registra:**
   - Crea registro en `registros_amasado`
   - Marca fase AMASADO como COMPLETADA
   - Desbloquea fase DIVISION

**Datos requeridos:**
- Amasadora utilizada (1, 2, 3 o 4)
- Velocidad 1 (minutos)
- Velocidad 2 (minutos)
- Temperatura masa final (°C)
- Temperatura agua (°C)

**Amasadoras disponibles:**
1. Amasadora Industrial 1 (100 kg)
2. Amasadora Industrial 2 (100 kg)
3. Amasadora Grande (150 kg)
4. Amasadora Pastelería (50 kg)

### 5.4 FASE 4: DIVISION

**Objetivo:** Dividir la masa en porciones según productos y tamaños.

**Proceso:**

1. **Verificar si requiere reposo pre-división**
   - Consultado desde `catalogo_tipos_masa.requiere_reposo_pre_division`
   - Si requiere: Registrar hora inicio y fin de reposo

2. **Iniciar división**
   ```
   PUT /api/fases/:masaId/progreso
   Body: {
     "fase": "DIVISION",
     "datos_fase": {
       "maquina_corte_id": 1,
       "temperatura_entrada": 25.0,
       "requiere_reposo": true,
       "hora_inicio_reposo": "2026-01-23T10:00:00Z",
       "hora_fin_reposo": "2026-01-23T10:10:00Z"
     }
   }
   ```

3. **Registrar cantidades divididas**
   - Actualizar `cantidad_divisiones` en `productos_por_masa`
   ```
   PATCH /api/masas/:masaId/productos/:productoId
   Body: {
     "cantidad_divisiones": 105
   }
   ```

4. **Completar división**
   ```
   PUT /api/fases/:masaId/DIVISION/completar
   ```

5. **Sistema verifica:**
   - Suma de `cantidad_divisiones` debe ser <= total de masa
   - Marca `division_completada = TRUE` en productos
   - Desbloquea FORMADO (si aplica) o FERMENTACION

**Máquinas de división:**
1. Conic (automática, 100 kg)
2. Divisora Manual (50 kg)

**Reglas de negocio:**
- El reposo es obligatorio para algunas masas (Gold, Brioche, Croissant)
- Tiempo de reposo estándar: 10-20 minutos según tipo de masa

### 5.5 FASE 5: FORMADO (Condicional)

**Objetivo:** Dar forma final a las piezas individuales.

**Aplica solo si:** `catalogo_tipos_masa.requiere_formado = TRUE`

**Proceso:**

1. **Obtener información de formado**
   ```
   GET /api/formado/:masaId
   ```
   Retorna:
   - Productos a formar con cantidades
   - Especificaciones de medidas esperadas
   - Máquinas formadoras disponibles

2. **Iniciar formado**
   ```
   POST /api/formado/:masaId/iniciar
   Body: {
     "maquina_formado_id": 1,
     "observaciones": "Inicio de formado"
   }
   ```

3. **Operario forma las piezas:**
   - Verifica medidas con reglas/plantillas
   - Cumple especificaciones de largo/ancho/alto/diámetro

4. **Completar formado**
   ```
   POST /api/formado/:masaId/completar
   Body: {
     "observaciones": "Formado completado con medidas correctas"
   }
   ```

5. **Sistema:**
   - Calcula duración automáticamente
   - Marca FORMADO como COMPLETADA
   - Desbloquea FERMENTACION

**Máquinas formadoras:**
1. Formadora 1 (automática, 100 kg)
2. Formadora 2 (automática, 100 kg)
3. Formadora 3 (automática, 100 kg)
4. Formado Manual (50 kg)

**Tipos de masa que requieren formado:**
- Hamburguesa Gold
- Hamburguesa Brioche
- Ciabatta
- Croissant
- Toscano
- Pan de Perro
- Baguette

**Tipos que NO requieren formado:**
- Pan Árabe (se hornea directo)

### 5.6 FASE 6: FERMENTACION

**Objetivo:** Reposar las piezas en cámaras controladas para desarrollo de volumen y sabor.

**Proceso:**

1. **Entrada a cámara de fermentación**
   ```
   POST /api/fermentacion/:masaId/camara/entrada
   Body: {
     "temperatura_camara": 32.0,
     "humedad_camara": 75.0,
     "observaciones": "Entrada a fermentación"
   }
   ```

2. **Sistema calcula:**
   - Hora entrada: NOW()
   - Hora salida sugerida: NOW() + tiempo_fermentacion_estandar_minutos
   - Ejemplo: Entrada 10:00, Estándar 45 min → Sugerida 10:45

3. **Operario monitorea fermentación:**
   - Revisa tamaño/volumen de las piezas
   - Decide cuándo sacar (puede diferir de hora sugerida)

4. **Salida de cámara de fermentación**
   ```
   POST /api/fermentacion/:masaId/camara/salida
   Body: {
     "observaciones": "Fermentación correcta"
   }
   ```

5. **Sistema verifica:** ¿Requiere cámara de frío?
   - **SI NO:** Marca FERMENTACION como COMPLETADA → Desbloquea HORNEADO
   - **SI SÍ:** Continúa con cámara de frío

6. **Entrada a cámara de frío (si aplica)**
   ```
   POST /api/fermentacion/:masaId/frio/entrada
   Body: {
     "temperatura_frio": 4.0
   }
   ```

7. **Salida de cámara de frío**
   ```
   POST /api/fermentacion/:masaId/frio/salida
   ```

8. **Sistema:**
   - Calcula tiempo en frío
   - Marca FERMENTACION como COMPLETADA
   - Desbloquea HORNEADO

**Tipos de masa que requieren frío:**
- Croissant (desarrollo de capas)
- Masas laminadas especiales

**Tiempos estándar de fermentación:**
| Tipo Masa | Tiempo Estándar |
|-----------|-----------------|
| Árabe     | 40 minutos      |
| Gold      | 45 minutos      |
| Brioche   | 50 minutos      |
| Ciabatta  | 60 minutos      |
| Croissant | 120 minutos     |

### 5.7 FASE 7: HORNEADO

**Objetivo:** Cocción final del producto.

**Proceso:**

1. **Obtener información de horneado**
   ```
   GET /api/horneado/:masaId
   ```
   Retorna:
   - Hornos disponibles
   - Programas sugeridos para el tipo de masa
   - Todos los programas (1-40)

2. **Iniciar horneado**
   ```
   POST /api/horneado/:masaId/iniciar
   Body: {
     "tipo_horno_id": 1,
     "programa_horneo_id": 1,
     "temperatura_inicial_real": 180.0,
     "uso_damper_real": true,
     "observaciones": "Inicio de horneado"
   }
   ```

3. **Durante horneado - Actualizar temperaturas**
   ```
   PATCH /api/horneado/:masaId/temperaturas
   Body: {
     "temperatura_media_real": 200.0,
     "hora_cambio_temperatura": "2026-01-23T11:05:00Z"
   }
   ```

4. **Durante horneado - Actualizar damper**
   ```
   PATCH /api/horneado/:masaId/damper
   Body: {
     "tiempo_inicio_damper_real": 10,
     "tiempo_fin_damper_real": 15
   }
   ```

5. **Completar horneado**
   ```
   POST /api/horneado/:masaId/completar
   Body: {
     "calidad_color": "PERFECTO",
     "calidad_coccion": "PERFECTO",
     "observaciones": "Horneado exitoso"
   }
   ```

6. **Sistema:**
   - Calcula tiempo total de horneado
   - Marca HORNEADO como COMPLETADA
   - Actualiza estado de masa a COMPLETADA
   - **Producción finalizada**

**Hornos disponibles:**
| ID | Nombre     | Tipo     | Damper | Control Auto | Capacidad |
|----|------------|----------|--------|--------------|-----------|
| 1  | Rotativo 1 | ROTATIVO | Sí     | Sí           | 16 band.  |
| 2  | Rotativo 2 | ROTATIVO | Sí     | Sí           | 16 band.  |
| 3  | Rotativo 3 | ROTATIVO | Sí     | Sí           | 16 band.  |
| 4  | Piso       | PISO     | No     | No           | 8 band.   |

**Importante:** El horno de Piso NO tiene damper. Es ideal para baguettes y laminados que necesitan humedad durante la cocción.

**Calidad del producto:**
- **Color:** PERFECTO, CLARO, OSCURO
- **Cocción:** PERFECTO, CRUDO, SOBRE_COCIDO

---

## 6. INTEGRACIÓN CON SAP BUSINESS ONE

### 6.1 Arquitectura de Integración

```
┌──────────────────────┐
│  SAP Business One    │
│  (HANA/SQL Server)   │
└──────────┬───────────┘
           │
           │ Service Layer (HTTPS)
           │
┌──────────▼───────────┐
│  SAP Service Layer   │
│  Port 50000          │
│  /b1s/v1             │
└──────────┬───────────┘
           │
           │ REST API (JSON)
           │
┌──────────▼───────────┐
│  Backend Node.js     │
│  sap.service.js      │
└──────────────────────┘
```

### 6.2 Configuración Requerida

**Variables de entorno (.env):**
```env
SAP_URL=https://192.168.1.100:50000/b1s/v1
SAP_COMPANY=ARTESA_SAS
SAP_USER=manager
SAP_PASSWORD=***
SAP_SESSION_TIMEOUT=30
```

**Configuración de red:**
- Puerto 50000 debe estar accesible
- Certificado SSL (puede ser auto-firmado en desarrollo)
- Usuario con permisos de lectura en OWOR (Production Orders)

### 6.3 Tablas SAP Utilizadas

**OWOR - Production Orders (Órdenes de Fabricación):**
- DocEntry: ID único
- DocNum: Número de documento
- ItemCode: Código del producto
- ProductDescription: Descripción
- PlannedQuantity: Cantidad planificada
- PostingDate: Fecha de producción
- Status: Estado (P=Planned, R=Released, C=Closed, L=Canceled)
- U_TipoMasa: Campo de usuario opcional

**WOR1 - Production Order Lines (Componentes):**
- ItemCode: Código del componente
- ItemName: Nombre del componente
- PlannedQuantity: Cantidad planificada
- BaseQty: Cantidad base
- WarehouseCode: Bodega

### 6.4 Flujo de Sincronización

1. **Login a SAP**
   ```javascript
   POST /b1s/v1/Login
   Body: {
     "CompanyDB": "ARTESA_SAS",
     "UserName": "manager",
     "Password": "***"
   }
   ```
   Retorna: `SessionId` (válido por 30 minutos)

2. **Consultar órdenes de fabricación**
   ```javascript
   GET /b1s/v1/ProductionOrders?$filter=(PostingDate eq '2026-01-23' and (Status eq 'P' or Status eq 'R'))&$select=DocEntry,DocNum,ItemCode,ProductDescription,PlannedQuantity,PostingDate,Status
   ```

3. **Obtener componentes de una orden**
   ```javascript
   GET /b1s/v1/ProductionOrders(123)?$select=ProductionOrderLines
   ```

4. **Cerrar sesión**
   ```javascript
   POST /b1s/v1/Logout
   ```

### 6.5 Mapeo de Códigos SAP

**Tabla crítica:** `catalogo_tipos_masa`

```sql
INSERT INTO catalogo_tipos_masa (codigo_sap, tipo_masa, nombre_masa) VALUES
('HAMBURGUESA_GOLD_6', 'GOLD', 'Hamburguesa Gold x6'),
('HAMBURGUESA_GOLD_12', 'GOLD', 'Hamburguesa Gold x12'),
('PAN_ARABE_OREGANO_6', 'ARABE', 'Pan Árabe Orégano x6'),
('CROISSANT_TRADICIONAL', 'CROISSANT', 'Croissant Tradicional');
```

**Si no existe mapeo:**
- La orden se reporta en `ordenes_sin_mapeo`
- No se procesa
- Se registra advertencia en log

### 6.6 Operaciones Futuras en SAP

**Consumo de materiales:**
```javascript
POST /b1s/v1/InventoryGenExits
Body: {
  "DocDate": "2026-01-23",
  "Comments": "Consumo producción - Orden 123",
  "DocumentLines": [{
    "ItemCode": "MP-HARINA-001",
    "Quantity": 50.0,
    "WarehouseCode": "MP01",
    "BaseEntry": 123,
    "BaseType": 202
  }]
}
```

**Recepción de producción:**
```javascript
POST /b1s/v1/InventoryGenEntries
Body: {
  "DocDate": "2026-01-23",
  "Comments": "Recepción producción - Orden 123",
  "DocumentLines": [{
    "BaseEntry": 123,
    "BaseType": 202,
    "Quantity": 100,
    "WarehouseCode": "PT01"
  }]
}
```

---

## 7. SISTEMA DE AUDITORÍA

### 7.1 Auditoría Automática

**Trigger Function:** `auditoria_automatica()`

Se ejecuta automáticamente en INSERT, UPDATE, DELETE de las siguientes tablas:
- masas_produccion
- productos_por_masa
- ingredientes_masa
- progreso_fases
- registros_amasado
- registros_division
- registros_formado
- registros_fermentacion
- registros_horneado
- configuracion_sistema
- catalogo_tipos_masa
- programas_horneo

**Datos capturados:**
```
- Tabla afectada
- ID del registro
- Masa ID (si aplica)
- Operación (INSERT/UPDATE/DELETE)
- Datos anteriores (JSONB)
- Datos nuevos (JSONB)
- Campos modificados (array)
- Usuario ID y nombre
- IP address (futuro)
- User agent (futuro)
- Fecha/hora del cambio
- Motivo (opcional)
```

### 7.2 Consultas de Auditoría

**Ver cambios de una masa:**
```sql
SELECT *
FROM v_auditoria_por_masa
WHERE masa_id = 123
ORDER BY fecha_cambio DESC;
```

**Ver cambios de un usuario:**
```sql
SELECT *
FROM v_auditoria_por_usuario
WHERE usuario_nombre = 'Admin Demo';
```

**Ver cambios recientes (24 horas):**
```sql
SELECT * FROM v_auditoria_reciente;
```

**Historial completo de un registro:**
```sql
SELECT *
FROM obtener_historial_registro('masas_produccion', 123);
```

### 7.3 Retención de Datos

**Purgar auditoría antigua:**
```sql
-- Purgar registros de más de 90 días
SELECT purgar_auditoria_antigua(90);

-- Purgar registros de más de 180 días
SELECT purgar_auditoria_antigua(180);
```

**Recomendación:**
- Retener auditoría de producción: 180 días (6 meses)
- Retener cambios de configuración: Permanente
- Ejecutar purga mensual vía cron job

---

## 8. CONFIGURACIÓN DEL SISTEMA

### 8.1 Factor de Absorción de Harina

**Concepto:** El factor de absorción es el porcentaje de agua que puede absorber una harina. Varía según el lote y afecta la cantidad de agua en todas las recetas.

**Configuración actual:**
```sql
SELECT valor FROM configuracion_sistema WHERE clave = 'factor_absorcion_harina';
-- Valor por defecto: 60
```

**Actualizar factor:**
```
PUT /api/config/factor-absorcion
Body: {
  "factor": 63.0
}
```

**Impacto:**
- Todas las nuevas masas usarán el nuevo factor
- Las masas existentes conservan el factor con el que fueron creadas
- El agua se recalcula automáticamente según la fórmula:
  ```
  agua = (suma_harinas * porcentaje_agua_receta) * (factor_nuevo / factor_base)
  ```

**Ejemplo:**
- Harina: 100 kg
- % Agua receta: 45%
- Factor base: 60%
- Agua calculada: 100 * 0.45 = 45 kg

Si el factor cambia a 63%:
- Agua recalculada: 45 * (63/60) = 47.25 kg

**Usuarios con permiso:** ADMIN, SUPERVISOR

### 8.2 Correos de Notificación

**Configurar destinatarios:**
```
PUT /api/config/correos
Body: {
  "correos": [
    "empaque@artesa.com",
    "bodega@artesa.com",
    "supervisor@artesa.com"
  ]
}
```

**Cuándo se envían:**
- Al completar fase de PESAJE
- Manualmente desde interfaz de pesaje

**Contenido del correo:**
```
Asunto: Pesaje Completado - Masa [CODIGO_MASA]
Cuerpo:
  Se ha completado el pesaje de la masa:
  - Código: DEMO-20260123-001
  - Tipo: Hamburguesa Gold
  - Fecha: 2026-01-23
  - Total Kilos: 52.5 kg
  - Productos:
    * Hamburguesa Gold x6: 105 unidades programadas
    * Hamburguesa Gold x12: 210 unidades programadas

  Favor preparar área de empaque.
```

### 8.3 Configuraciones por Tipo de Masa

**Tabla:** `catalogo_tipos_masa`

**Campos configurables:**
- `requiere_reposo_pre_division`: Boolean
- `tiempo_reposo_division_minutos`: Integer
- `requiere_formado`: Boolean
- `requiere_camara_frio`: Boolean
- `tiempo_fermentacion_estandar_minutos`: Integer

**Ejemplo:**
```sql
UPDATE catalogo_tipos_masa
SET
  requiere_reposo_pre_division = TRUE,
  tiempo_reposo_division_minutos = 15,
  requiere_formado = TRUE,
  requiere_camara_frio = FALSE,
  tiempo_fermentacion_estandar_minutos = 45
WHERE tipo_masa = 'GOLD';
```

### 8.4 Programas de Horneado

**Tabla:** `programas_horneo`

**Crear nuevo programa:**
```sql
INSERT INTO programas_horneo (
  numero_programa,
  nombre,
  descripcion,
  temperatura_inicial,
  temperatura_media,
  temperatura_final,
  tiempo_temperatura_media,
  tiempo_total_minutos,
  usa_damper,
  tiempo_inicio_damper,
  tiempo_fin_damper,
  tipo_masa_sugerido
) VALUES (
  21,
  'Pan Dulce Especial',
  'Programa para pan dulce con mayor tiempo',
  170, 180, 175,
  10,
  25,
  TRUE,
  18, 25,
  'PAN_DULCE'
);
```

---

## 9. ENDPOINTS API

### 9.1 Autenticación

```
POST   /api/auth/register          - Registrar usuario
POST   /api/auth/login             - Iniciar sesión
POST   /api/auth/refresh           - Refrescar token
POST   /api/auth/logout            - Cerrar sesión
POST   /api/auth/forgot-password   - Solicitar recuperación de contraseña
POST   /api/auth/reset-password    - Resetear contraseña con token
POST   /api/auth/change-password   - Cambiar contraseña (autenticado)
GET    /api/auth/profile           - Obtener perfil
PUT    /api/auth/profile           - Actualizar perfil
GET    /api/auth/verify            - Verificar token
```

### 9.2 SAP

```
POST   /api/sap/sincronizar        - Sincronizar órdenes desde SAP
GET    /api/sap/ordenes            - Obtener órdenes sin sincronizar
GET    /api/sap/stock/:masaId      - Verificar stock para una masa
GET    /api/sap/historial          - Histórico de sincronizaciones
```

### 9.3 Masas

```
GET    /api/masas?fecha=YYYY-MM-DD              - Obtener masas por fecha
GET    /api/masas/:id                           - Detalle de masa
GET    /api/masas/:id/productos                 - Productos de una masa
GET    /api/masas/:id/composicion               - Ingredientes de una masa
PATCH  /api/masas/:masaId/productos/:productoId - Actualizar unidades programadas
```

### 9.4 Pesaje

```
GET    /api/pesaje/:masaId/checklist                          - Obtener checklist
PATCH  /api/pesaje/:masaId/ingredientes/:ingredienteId        - Actualizar ingrediente
POST   /api/pesaje/:masaId/confirmar                          - Confirmar pesaje
POST   /api/pesaje/:masaId/enviar-correo                      - Enviar correo a empaque
```

### 9.5 Fases (Progreso General)

```
GET    /api/fases/:masaId                      - Obtener progreso de todas las fases
PUT    /api/fases/:masaId/progreso             - Actualizar progreso de una fase
PUT    /api/fases/:masaId/:fase/completar      - Completar una fase
```

### 9.6 Formado

```
GET    /api/formado/:masaId                    - Información de formado
POST   /api/formado/:masaId/iniciar            - Iniciar formado
POST   /api/formado/:masaId/completar          - Completar formado
```

### 9.7 Fermentación

```
GET    /api/fermentacion/:masaId               - Información de fermentación
POST   /api/fermentacion/:masaId/camara/entrada - Entrada a cámara de fermentación
POST   /api/fermentacion/:masaId/camara/salida  - Salida de cámara de fermentación
POST   /api/fermentacion/:masaId/frio/entrada   - Entrada a cámara de frío
POST   /api/fermentacion/:masaId/frio/salida    - Salida de cámara de frío
```

### 9.8 Horneado

```
GET    /api/horneado/hornos                    - Catálogo de hornos
GET    /api/horneado/programas?tipo_masa=GOLD  - Programas de horneado
GET    /api/horneado/:masaId                   - Información de horneado
POST   /api/horneado/:masaId/iniciar           - Iniciar horneado
PATCH  /api/horneado/:masaId/temperaturas      - Actualizar temperaturas
PATCH  /api/horneado/:masaId/damper            - Actualizar damper
POST   /api/horneado/:masaId/completar         - Completar horneado
```

### 9.9 Configuración

```
GET    /api/config/factor-absorcion            - Obtener factor de absorción
PUT    /api/config/factor-absorcion            - Actualizar factor (admin)
GET    /api/config/correos                     - Obtener correos de empaque
PUT    /api/config/correos                     - Actualizar correos (admin)
```

### 9.10 Usuarios

```
GET    /api/users                              - Listar usuarios (admin)
GET    /api/users/:id                          - Obtener usuario
PUT    /api/users/:id                          - Actualizar usuario (admin)
DELETE /api/users/:id                          - Eliminar usuario (admin)
```

---

## 10. CASOS DE USO

### 10.1 Caso de Uso 1: Día Típico de Producción

**Actor:** Supervisor de Producción

**Flujo:**

1. **8:00 AM - Sincronización**
   - Login al sistema
   - Navega a "Sincronizar SAP"
   - Selecciona fecha de producción (hoy)
   - Click en "Sincronizar"
   - Sistema muestra: 3 masas creadas (Gold, Árabe, Croissant)

2. **8:15 AM - Revisión de Planificación**
   - Navega a "Planificación"
   - Ve lista de masas del día
   - Entra a masa "Hamburguesa Gold"
   - Revisa productos y cantidades programadas
   - Ajusta unidades programadas de 100 a 105 (merma)
   - Guarda cambios

3. **Asigna tareas a operarios:**
   - Operario A: Pesaje
   - Operario B: Amasado
   - Operario C: División/Formado
   - Operario D: Fermentación/Horneado

**Actor:** Operario de Pesaje

4. **8:30 AM - Pesaje**
   - Login al sistema
   - Navega a "Pesaje"
   - Selecciona masa "Hamburguesa Gold"
   - Ve checklist de 7 ingredientes
   - Por cada ingrediente:
     * Marca "Disponible"
     * Verifica visualmente → Marca "Verificado"
     * Pesa en balanza → Ingresa peso real
     * Marca "Pesado"
     * Registra lote y vencimiento
   - Al finalizar: Click "Confirmar Pesaje"
   - Sistema envía email a empaque
   - Sistema desbloquea fase AMASADO

**Actor:** Operario de Amasado

5. **9:00 AM - Amasado**
   - Login al sistema
   - Navega a "Amasado"
   - Selecciona masa "Hamburguesa Gold"
   - Selecciona "Amasadora Industrial 1"
   - Inicia amasado en máquina
   - Registra:
     * Velocidad 1: 8 minutos
     * Velocidad 2: 12 minutos
     * Temperatura agua: 18°C
   - Al finalizar:
     * Temperatura masa final: 26.5°C
   - Click "Completar Amasado"
   - Sistema desbloquea fase DIVISION

**Actor:** Operario de División

6. **9:30 AM - División**
   - Login al sistema
   - Navega a "División"
   - Selecciona masa "Hamburguesa Gold"
   - Sistema indica: "Requiere reposo de 10 minutos"
   - Deja masa en reposo → Registra hora inicio
   - Después de 10 minutos → Registra hora fin
   - Selecciona "Conic"
   - Divide masa según cantidades:
     * Gold x6: 105 unidades
     * Gold x12: 210 unidades
   - Registra temperatura entrada: 25°C
   - Click "Completar División"
   - Sistema desbloquea fase FORMADO

**Actor:** Operario de Formado

7. **10:15 AM - Formado**
   - Login al sistema
   - Navega a "Formado"
   - Selecciona masa "Hamburguesa Gold"
   - Selecciona "Formadora 1"
   - Click "Iniciar Formado"
   - Forma las piezas con máquina
   - Verifica medidas:
     * Diámetro: 10 cm
     * Alto: 3 cm
   - Click "Completar Formado"
   - Sistema desbloquea fase FERMENTACION

**Actor:** Operario de Fermentación

8. **11:00 AM - Fermentación**
   - Login al sistema
   - Navega a "Fermentación"
   - Selecciona masa "Hamburguesa Gold"
   - Ingresa temperatura cámara: 32°C
   - Ingresa humedad: 75%
   - Click "Registrar Entrada a Cámara"
   - Sistema calcula: Salida sugerida 11:45 AM
   - Espera y monitorea...
   - 11:45 AM - Revisa piezas → Están listas
   - Click "Registrar Salida de Cámara"
   - Sistema verifica: No requiere frío
   - Sistema completa FERMENTACION
   - Sistema desbloquea HORNEADO

**Actor:** Operario de Horno

9. **11:50 AM - Horneado**
   - Login al sistema
   - Navega a "Horneado"
   - Selecciona masa "Hamburguesa Gold"
   - Selecciona "Rotativo 1"
   - Selecciona "Programa 1 - Hamburguesas Estándar"
   - Sistema muestra configuración:
     * T. Inicial: 180°C
     * T. Media: 200°C (a los 5 min)
     * T. Final: 190°C
     * Damper: Sí (10-15 min)
     * Tiempo total: 15 min
   - Precalienta horno a 180°C
   - Ingresa temperatura real: 180°C
   - Click "Iniciar Horneado"
   - Mete bandejas al horno
   - **Durante horneado:**
     * Minuto 5: Sube temperatura → Registra 200°C
     * Minuto 10: Abre damper → Registra tiempo 10
     * Minuto 15: Cierra damper → Registra tiempo 15
   - Saca panes del horno
   - Evalúa calidad:
     * Color: PERFECTO
     * Cocción: PERFECTO
   - Click "Completar Horneado"
   - **Sistema marca producción como COMPLETADA**

10. **12:10 PM - Entrega a Empaque**
    - Producto terminado listo
    - Se envía a área de empaque según notificación

---

### 10.2 Caso de Uso 2: Ajuste de Factor de Absorción

**Actor:** Administrador

**Escenario:** Llegó un nuevo lote de harina con absorción 63% (antes era 60%)

**Flujo:**

1. **Login como Admin**
2. **Navega a Configuración**
3. **Sección "Factor de Absorción de Harina"**
   - Valor actual: 60%
4. **Ingresa nuevo valor: 63**
5. **Click "Actualizar"**
6. **Sistema recalcula:**
   - Todas las nuevas sincronizaciones usarán 63%
   - Masas existentes mantienen su factor original
7. **Sistema muestra confirmación:**
   "Factor actualizado a 63%. Afectará nuevas masas."

---

### 10.3 Caso de Uso 3: Manejo de Mermas

**Actor:** Operario de División

**Escenario:** Al dividir, se dan algunas piezas defectuosas

**Flujo:**

1. **Operario está en fase DIVISION**
2. **Debía dividir 100 unidades**
3. **División real:**
   - 100 unidades correctas
   - 3 unidades defectuosas (descartadas)
4. **Sistema ya tiene programadas 105 unidades (merma del 5%)**
5. **Resultado:**
   - Unidades programadas: 105
   - Unidades producidas: 103 (100 + 3 de merma)
   - Unidades pedidas SAP: 100
   - **Cumple pedido:** Sí (100 unidades para el cliente)
   - **Excedente:** 3 unidades → Van a puntos de fábrica

---

### 10.4 Caso de Uso 4: Auditoría de Cambios

**Actor:** Auditor

**Escenario:** Revisar quién modificó las unidades programadas de una masa

**Flujo:**

1. **Login como Auditor**
2. **Navega a "Auditoría"**
3. **Selecciona masa: DEMO-20260123-001**
4. **Sistema muestra historial:**

```
┌────────────────────────────────────────────────────────────────┐
│ Cambios en Masa DEMO-20260123-001                             │
├────────────────────────────────────────────────────────────────┤
│ 2026-01-23 08:15:30 - UPDATE - productos_por_masa             │
│ Usuario: Supervisor Demo                                       │
│ Campos modificados: unidades_programadas                       │
│ Valor anterior: 100                                            │
│ Valor nuevo: 105                                               │
│ Motivo: Ajuste de merma                                        │
├────────────────────────────────────────────────────────────────┤
│ 2026-01-23 09:45:12 - UPDATE - progreso_fases                 │
│ Usuario: Operario Amasado                                      │
│ Campos modificados: estado, fecha_completado                   │
│ Fase: AMASADO                                                  │
│ Estado: EN_PROGRESO → COMPLETADA                              │
└────────────────────────────────────────────────────────────────┘
```

5. **Puede exportar reporte si necesita**

---

## 11. GLOSARIO

**Términos Clave:**

- **Masa:** Agrupación de órdenes de fabricación de SAP del mismo tipo
- **Tipo de Masa:** Categoría de masa (GOLD, ARABE, BRIOCHE, etc.)
- **Merma:** Porcentaje adicional de producción para compensar pérdidas
- **Factor de Absorción:** Capacidad de la harina para absorber agua
- **Prefermento:** Masa base preparada previamente (masa madre)
- **Damper:** Sistema de extracción de vapor en hornos
- **Porcentaje Panadero:** Método de cálculo de ingredientes basado en peso de harinas
- **Conic:** Máquina automática de división de masas
- **SAP B1:** SAP Business One - ERP empresarial
- **Service Layer:** API REST de SAP Business One
- **OWOR:** Tabla de órdenes de fabricación en SAP
- **DocEntry:** ID único de documento en SAP
- **JWT:** JSON Web Token - Sistema de autenticación
- **UUID:** Identificador único universal
- **JSONB:** Tipo de dato JSON binario en PostgreSQL
- **Trigger:** Disparador automático en base de datos

**Estados de Masa:**
- **PLANIFICACION:** Masa recién sincronizada, sin iniciar producción
- **EN_PROCESO:** Producción en curso
- **COMPLETADA:** Producción finalizada exitosamente
- **CANCELADA:** Producción cancelada (excepcional)

**Estados de Fase:**
- **BLOQUEADA:** Fase no disponible aún (fase anterior no completada)
- **EN_PROGRESO:** Fase en ejecución actualmente
- **COMPLETADA:** Fase finalizada exitosamente
- **REQUIERE_ATENCION:** Fase con problemas que requieren intervención

**Roles de Usuario:**
- **ADMIN:** Acceso total, configuración, usuarios
- **SUPERVISOR:** Sincronización, monitoreo, ajustes operativos
- **OPERARIO:** Ejecución de procesos productivos
- **CALIDAD:** Verificación y control de calidad
- **AUDITOR:** Solo lectura, acceso a auditoría

**Fases de Producción:**
1. **PLANIFICACION:** Preparación y sincronización
2. **PESAJE:** Verificación y pesaje de ingredientes
3. **AMASADO:** Mezclado de ingredientes
4. **DIVISION:** Corte en porciones
5. **FORMADO:** Dar forma final (condicional)
6. **FERMENTACION:** Reposo para crecimiento
7. **HORNEADO:** Cocción final

---

## FIN DEL MANUAL FUNCIONAL

**Desarrollado para:** Artesa SAS
**Contacto Técnico:** JONATHAN JAY ZUNIGA PERDOMO
**Fecha de Elaboración:** 23 de Enero de 2026
**Versión del Sistema:** 2.0.0

**Próximos Pasos:**
1. Completar integración SAP (ambiente productivo)
2. Implementar frontend completo
3. Pruebas de usuario
4. Capacitación al personal
5. Go Live: antes del 28 de Febrero de 2026

---

**Notas Importantes:**
- Este manual está basado en las reuniones del 11/12/2025 y 23/01/2026
- El MVP prioritario debe llegar hasta DIVISION como mínimo
- El sistema está diseñado para reemplazar AyM Soft antes del 28/02/2026
- Todas las fases están implementadas en el backend
- El frontend requiere desarrollo para conexión completa con API

---

## ANEXO A: RESUMEN DE TABLAS SQL

### Tablas Core
- masas_produccion
- productos_por_masa
- ingredientes_masa
- progreso_fases
- orden_masa_relacion

### Tablas de Registro
- registros_amasado
- registros_division
- registros_formado
- registros_fermentacion
- registros_horneado

### Tablas de Catálogo
- catalogo_tipos_masa
- catalogo_productos
- amasadoras
- maquinas_corte
- maquinas_formado
- tipos_horno
- programas_horneo
- especificaciones_formado

### Tablas de Sistema
- usuarios
- configuracion_sistema
- auditoria_cambios
- sap_sync_log
- notificaciones_empaque

---

**© 2026 La Artesa SAS - Sistema de Gestión de Producción**
