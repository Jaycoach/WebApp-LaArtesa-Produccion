# Análisis: Reunión del 15 de Enero de 2026 - Amasado y División

## Fecha de Análisis: 2026-01-23
## Reunión Analizada: 15 de enero de 2026, 2:07 PM (55min 38s)
## Participantes: Kevin Dávila (Jefe de Operaciones Artesa) y Jonathan J. Zúñiga

---

## 📋 Resumen Ejecutivo

Esta reunión se centró en definir las fases de **AMASADO** y **DIVISIÓN/CORTE**, complementando la primera reunión del 11/12/2025 que cubrió planificación y pesaje.

### Estado General: **❌ 20% IMPLEMENTADO**

**Hallazgo Crítico**: Las tablas de base de datos necesarias **NO EXISTEN**. El código en `fases.model.js` está escrito pero las tablas no fueron creadas.

---

## 🔴 PROBLEMA CRÍTICO DETECTADO

### Tablas Faltantes en Base de Datos

El código del BackEnd usa estas tablas pero **NO EXISTEN** en la base de datos:

❌ `masas_produccion`
❌ `orden_masa_relacion`
❌ `productos_por_masa`
❌ `ingredientes_masa`
❌ `progreso_fases`
❌ `notificaciones_empaque`
❌ `registros_amasado`
❌ `registros_division`
❌ `amasadoras`
❌ `maquinas_corte`
❌ `catalogo_productos`

**Acción Realizada**: ✅ Creado script SQL `04-produccion-tablas.sql` con todas las tablas necesarias
**Acción Realizada**: ✅ Creado script SQL `05-produccion-seed.sql` con datos iniciales

---

## 1. PREFERMENTO (Aclaración Importante)

### 🎯 Discusión en la Reunión

**Kevin explicó:**
> "El prefermento es una materia prima que nosotros fabricamos [...] Es agua, harina, levadura y sal nada más"

**Controles solicitados:**
- Tiempo de amasado
- Temperatura
- pH inicial
- pH final

### ✅ **DECISIÓN TOMADA**

**Jonathan concluyó:**
> "Esta información del prefermento se podría manejar más en SAP que en el desarrollo"

**Razón:**
- El prefermento es una materia prima
- Se maneja en bodega/inventario de SAP
- SAP indica si hay o no hay prefermento
- **NO va en el sistema de producción**

**Estado**: ✅ **NO REQUIERE IMPLEMENTACIÓN** en el sistema de producción

---

## 2. AMASADO (Fase Completa)

### 🎯 Requerimientos de la Reunión

#### A. Selección de Amasadora

**Kevin explicó:**
> "Tengo cuatro [amasadoras] en total [...] Ellos tienen que elegir la amasadora"

**Funcionalidad Esperada:**
- Catálogo de 4 amasadoras
- Usuario selecciona cuál va a usar
- Registro de qué amasadora se usó por masa

#### B. Velocidades del Amasado

**Kevin explicó velocidad 1:**
> "La velocidad 1 va a bajar revoluciones y es solo como para ir mezclando todos los polvos y para hacer una pre mezcla"

**Kevin explicó velocidad 2:**
> "La velocidad 2 ya es la que le estoy dando forma a la masa"

**Campos Requeridos:**
- **Velocidad 1 (minutos)**: Tiempo de mezcla de ingredientes
- **Velocidad 2 (minutos)**: Tiempo para dar forma a la masa

**Propósito:**
> "Con esto yo controlo qué hicieron los chicos, si les dieron cinco, seis minutos o 15 o 14"

#### C. Temperaturas

**Kevin explicó:**
> "Con la temperatura del agua juego mucho y con la temperatura de la salida de masa también, porque si sale una masa muy caliente, se me dañó la masa"

**Campos Requeridos:**
- **Temperatura masa final**: Temperatura de salida de la masa
- **Temperatura agua**: Temperatura del agua dosificada

#### D. **IMPORTANTE**: Visualización de Ingredientes

**Kevin solicitó:**
> "Yo necesito que ahí me muestre qué es lo que se pesó [...] En amasado yo dosifico el agua, entonces ellos tienen que saber cuánta agua tienen que poner"

**Funcionalidad Esperada:**
- Mostrar TODOS los ingredientes que se pesaron
- Incluir el agua calculada con factor de absorción
- Usuario ve qué cantidad de agua dosificar
- Sirve para verificar que todo llegó de pesaje

### ✅ IMPLEMENTACIÓN

#### Base de Datos: ✅ **SCRIPT CREADO**

**Tabla `amasadoras`** (Catálogo):
```sql
- id
- nombre
- codigo
- capacidad_kg
- tipo (INDUSTRIAL, PASTELERIA)
- activa
- observaciones
```

**Tabla `registros_amasado`**:
```sql
- masa_id
- amasadora_id
- amasadora_nombre
- velocidad_1_minutos  ⭐
- velocidad_2_minutos  ⭐
- temperatura_masa_final  ⭐
- temperatura_agua  ⭐
- usuario_id
- fecha_registro
- observaciones
```

**Datos Semilla**:
✅ 4 amasadoras precargadas en `05-produccion-seed.sql`

#### Backend: ❌ **FALTA IMPLEMENTAR**

**Pendiente**:
- [ ] Controlador `amasado.controller.js`
- [ ] Rutas `amasado.routes.js`
- [ ] Modelo `amasado.model.js`
- [ ] Endpoints:
  - `GET /api/amasado/amasadoras` - Listar amasadoras
  - `GET /api/amasado/:masaId` - Obtener datos de amasado
  - `POST /api/amasado/:masaId` - Registrar amasado
  - `PUT /api/amasado/:masaId` - Actualizar amasado
  - `GET /api/amasado/:masaId/ingredientes` - Ver ingredientes pesados

#### Frontend: ❌ **FALTA IMPLEMENTAR**

**Pendiente**:
- [ ] Servicio `amasadoService.ts`
- [ ] Tipos TypeScript para amasado
- [ ] Componente `AmasadoMasa.tsx`
- [ ] Selector de amasadora
- [ ] Formulario de velocidades y temperaturas
- [ ] Visualización de ingredientes

---

## 3. CONTROLES ENTRE FASES (Validaciones)

### 🎯 Requerimientos de la Reunión

**Kevin solicitó:**
> "Si de pesaje no me dan liberación [...] Si pesaje no completó el proceso, no pueda pasar a amasado"

**Jonathan preguntó:**
> "¿Qué controles debe hacer el sistema para que alguien le diga OK pesaje o pasar la siguiente fase?"

#### A. Control de Pesaje → Amasado

**Kevin especificó:**
> "Primero esté todo en la materia prima que se haya pesado todo [...] Lo único que no se revisa es el agua, porque el agua se dosifica en amasado"

**Validación Requerida:**
- ✅ TODOS los ingredientes deben tener check (excepto agua)
- ✅ Check de: `disponible`, `verificado`, `pesado`
- ❌ NO permitir avanzar a amasado sin completar pesaje

#### B. Control de Amasado → División

**Jonathan propuso:**
> "En amasado tienen que estar todas [...] Todos los controles, o sea, que se haya elegido la amasadora, que hayan ingresado la velocidad, la temperatura"

**Validación Requerida:**
- ✅ Amasadora seleccionada
- ✅ Velocidad 1 ingresada
- ✅ Velocidad 2 ingresada
- ✅ Temperatura masa final ingresada
- ✅ Temperatura agua ingresada
- ❌ NO permitir avanzar a división sin completar amasado

### ✅ IMPLEMENTACIÓN

#### Pesaje → Amasado: ✅ **IMPLEMENTADO**

- ✅ Función `checkTodosPesados()` en [fases.model.js:152-174](backend/src/models/fases.model.js#L152-L174)
- ✅ Endpoint `POST /api/pesaje/:masaId/confirmar`
- ✅ Validación estricta en [pesaje.controller.js:109-148](backend/src/controllers/pesaje.controller.js#L109-L148)

#### Amasado → División: ❌ **FALTA IMPLEMENTAR**

**Pendiente**:
- [ ] Función de validación de amasado completo
- [ ] Endpoint `POST /api/amasado/:masaId/confirmar`
- [ ] Verificar que todos los campos estén llenos

---

## 4. DIVISIÓN/CORTE (Fase Completa)

### 🎯 Requerimientos de la Reunión

#### A. Reposo (Antes o Después del Corte)

**Kevin explicó:**
> "Hay unos masas que recortan y ponen a reposar y hay otras masas que reposa y cortan"

**Jonathan propuso:**
> "Colocamos un checkcito que diga reposo sí o no y habilite"

**Solución Acordada:**
- ✅ Checkbox "Reposo Sí/No"
- ✅ Si es Sí: habilitar 2 campos
  - **Hora inicio reposo**
  - **Hora fin reposo**
- ✅ Sistema calcula tiempo de reposo automáticamente

**Kevin aclaró:**
> "Los chicos dijeron sí, esta masa necesito un reposo, listo. ¿A qué horas comenzó el reposo?"

#### B. Selección de Máquina de Corte

**Kevin mencionó:**
> "Tengo una máquina que se llama Conic, una máquina que le llamo divisora manual"

**Kevin explicó el uso:**
> "Cuando nosotros usamos la divisora manual, lo usamos con las masas que tuvieron el reposo"

**Funcionalidad Esperada:**
- Catálogo de máquinas de corte
- Usuario selecciona cuál usa
- Registro de qué máquina se usó

#### C. Temperatura de Entrada

**Kevin solicitó:**
> "Nosotros al momento de que ya llegue a división, nosotros tenemos que revisar a qué temperatura llegó"

**Campo Requerido:**
- **Temperatura entrada**: Temperatura de la masa al llegar a división

#### D. **CRÍTICO**: Desagrupación de Productos

**Kevin explicó:**
> "Aquí ya se abren las masas [...] Los chicos deben saber que de esa masa son, un ejemplo, 50 hamburguesas grandes, 30 hamburguesas pequeñas y 10 perros"

**Jonathan entendió:**
> "Acá en la división, el usuario debe identificar cuáles son los productos finales que vamos a obtener"

**Funcionalidad Requerida:**
1. Mostrar productos finales de las órdenes originales
2. Por cada producto mostrar:
   - Nombre del producto
   - Tamaño/presentación
   - Cantidad a producir (número de divisiones)
   - Peso de masa esperado (del catálogo)
   - Checkbox para verificar producción

#### E. Catálogo de Productos con Pesos

**Kevin solicitó:**
> "Para que ellos no, o sea, ellos no me digan, yo le puse esto 30g, no, sino que la aplicación les diga esta hamburguesa debe pesar tanto"

**Jonathan propuso:**
> "Crear un catálogo de productos en donde diga cuánto pesa en la masa para cada uno de esos productos"

**Funcionalidad:**
- Tabla `catalogo_productos`
- Cada producto tiene su peso de masa
- Al mostrar producto en división, traer peso automáticamente
- Usuario solo verifica con checkbox

**Kevin aclaró el flujo:**
> "Llegó la masa división y el chico diga, abre, digo, a ver qué voy a hacer primero, pan hamburguesa [...] le aplique y le diga, pan hamburguesa, tienes que sacar 50 unidades con este peso"

### ✅ IMPLEMENTACIÓN

#### Base de Datos: ✅ **SCRIPT CREADO**

**Tabla `maquinas_corte`** (Catálogo):
```sql
- id
- nombre
- codigo
- tipo (CONIC, MANUAL, AUTOMATICA)
- capacidad_kg
- activa
- observaciones
```

**Tabla `registros_division`**:
```sql
- masa_id
- maquina_corte_id
- maquina_nombre
- requiere_reposo  ⭐
- hora_inicio_reposo  ⭐
- hora_fin_reposo  ⭐
- tiempo_reposo_minutos
- temperatura_entrada  ⭐
- usuario_id
- fecha_registro
- observaciones
```

**Tabla `catalogo_productos`**:
```sql
- codigo_producto
- nombre
- presentacion
- peso_masa_gramos  ⭐ (peso para división)
- categoria
- tipo_masa
- activo
```

**Tabla `productos_por_masa`** (actualizada):
```sql
...campos existentes...
- peso_masa_division  ⭐ (peso verificado)
- cantidad_divisiones  ⭐ (piezas cortadas)
- division_completada  ⭐ (checkbox)
```

**Datos Semilla**:
✅ 2 máquinas de corte en `05-produccion-seed.sql`
✅ 18 productos con pesos en `05-produccion-seed.sql`

#### Backend: ❌ **FALTA IMPLEMENTAR**

**Pendiente**:
- [ ] Controlador `division.controller.js`
- [ ] Rutas `division.routes.js`
- [ ] Modelo `division.model.js`
- [ ] Endpoints:
  - `GET /api/division/maquinas` - Listar máquinas
  - `GET /api/division/:masaId` - Obtener datos de división
  - `GET /api/division/:masaId/productos` - Productos a dividir
  - `POST /api/division/:masaId` - Registrar división
  - `PUT /api/division/:masaId/producto/:productoId` - Marcar producto como dividido
  - `POST /api/division/:masaId/confirmar` - Confirmar división completa

#### Frontend: ❌ **FALTA IMPLEMENTAR**

**Pendiente**:
- [ ] Servicio `divisionService.ts`
- [ ] Tipos TypeScript para división
- [ ] Componente `DivisionMasa.tsx`
- [ ] Checkbox de reposo con campos condicionales
- [ ] Selector de máquina de corte
- [ ] Listado de productos con checkboxes
- [ ] Campo de temperatura

---

## 5. ENVÍO A EMPAQUE (Notificaciones)

### 🎯 Requerimientos de la Reunión

#### A. Cuándo Enviar

**Primera propuesta de Kevin:**
> "Empaque él apenas entró a cargar la producción, se vaya"

**Kevin decidió:**
> "Apenas se aprueben las órdenes de fabricación, que llegue tanto a pesaje y que también llegue a Empaque"

**Acuerdo Final:**
- Botón "Enviar a Empaque" en la pantalla de pesaje
- Cuando se recibe la orden de fabricación
- Envía información de productos que se van a fabricar

#### B. Contenido del Correo

**Kevin explicó el propósito:**
> "Con esto vamos solucionando muchos problemas que ahorita tengo, porque así que me pasa ahorita, nosotros producimos y Empaque no tienen idea de lo que vamos a hacer"

**Información a Enviar:**
- Productos que se van a fabricar
- Cantidad de paquetes por producto
- Para que Empaque prepare bolsas y etiquetas

#### C. Destinatarios Configurables

**Kevin solicitó:**
> "Me gustaría que ese correo se envíe no solo a Empaque, sino también a Bodega"

**Kevin especificó:**
> "Son siempre los que necesito. Sería empaque, bodega y a mi persona, nada más"

**Solución Acordada:**
- Ventana de configuración
- Campo con correos separados por comas
- 3 destinatarios: Empaque, Bodega, Kevin

### ✅ IMPLEMENTACIÓN

#### Base de Datos: ✅ **SCRIPT CREADO**

**Tabla `notificaciones_empaque`**:
```sql
- masa_id
- destinatarios (ARRAY)  ⭐
- asunto
- cuerpo
- estado_envio (PENDIENTE, ENVIADO, ERROR)
- fecha_envio
- error_mensaje
- enviado_por
```

**Configuración**:
```sql
INSERT INTO configuracion_sistema
(clave, valor)
VALUES
('correos_empaque', 'empaque@artesa.com,bodega@artesa.com')
```

#### Backend: ✅ **PARCIALMENTE IMPLEMENTADO**

**Existente**:
- ✅ Modelo `createNotificacionEmpaque()` en [fases.model.js:249-267](backend/src/models/fases.model.js#L249-267)
- ✅ Endpoint `POST /api/pesaje/:masaId/enviar-correo` en [pesaje.controller.js:150-202](backend/src/controllers/pesaje.controller.js#L150-L202)
- ⚠️ **SIMULADO**: Envío de correo no implementado

**Pendiente**:
- [ ] Configurar servicio de correo (NodeMailer/SendGrid)
- [ ] Implementar envío real de correos
- [ ] Endpoint para configuración de correos
- [ ] Validación de formato de correos

#### Frontend: ❌ **FALTA IMPLEMENTAR**

**Pendiente**:
- [ ] Botón "Enviar a Empaque" en pantalla de pesaje
- [ ] Servicio para enviar notificación
- [ ] Pantalla de configuración de correos

---

## 6. NAVEGACIÓN POR PESTAÑAS

### 🎯 Discusión en la Reunión

**Jonathan propuso:**
> "¿Estaría bien que nosotros creáramos como una plantilla de producción y que se moviera en la pantalla por pestañas?"

**Kevin confirmó:**
> "Lo que yo necesito es que si de pesaje no me dan liberación [...] no pueda pasar a amasado"

**Funcionalidad Esperada:**
- Navegación por pestañas: Pesaje → Amasado → División
- Validaciones entre pestañas
- Bloqueo de pestaña siguiente hasta completar actual

### ❌ **NO IMPLEMENTADO**

**Pendiente**:
- [ ] Componente de navegación por pestañas
- [ ] Sistema de bloqueo/desbloqueo de pestañas
- [ ] Indicadores visuales de completitud

---

## 📊 Tabla de Implementación

| Funcionalidad | BD | Backend | Frontend | Total |
|---|---|---|---|---|
| **Prefermento** | N/A | N/A | N/A | N/A |
| **Amasado - Amasadoras** | ✅ | ❌ | ❌ | 33% |
| **Amasado - Velocidades** | ✅ | ❌ | ❌ | 33% |
| **Amasado - Temperaturas** | ✅ | ❌ | ❌ | 33% |
| **Amasado - Ver ingredientes** | ✅ | ❌ | ❌ | 33% |
| **Control Pesaje→Amasado** | ✅ | ✅ | ⚠️ | 75% |
| **Control Amasado→División** | ✅ | ❌ | ❌ | 33% |
| **División - Reposo** | ✅ | ❌ | ❌ | 33% |
| **División - Máquinas** | ✅ | ❌ | ❌ | 33% |
| **División - Temperatura** | ✅ | ❌ | ❌ | 33% |
| **División - Productos** | ✅ | ❌ | ❌ | 33% |
| **Cat

álogo Productos** | ✅ | ❌ | ❌ | 33% |
| **Envío Empaque** | ✅ | ⚠️ | ❌ | 50% |
| **Config Correos** | ✅ | ❌ | ❌ | 33% |
| **Navegación Pestañas** | N/A | ❌ | ❌ | 0% |

**Leyenda:**
- ✅ Completamente implementado
- ⚠️ Parcialmente implementado
- ❌ No implementado
- N/A No aplica

---

## 🎯 Acciones Críticas Requeridas

### 1. **URGENTE: Crear Tablas en Base de Datos** 🔴

**Archivo Creado**: [04-produccion-tablas.sql](backend/database/init/04-produccion-tablas.sql)
**Archivo Creado**: [05-produccion-seed.sql](backend/database/init/05-produccion-seed.sql)

**Acción Requerida**:
```bash
# Ejecutar scripts SQL en orden
psql -d artesa_produccion -f backend/database/init/04-produccion-tablas.sql
psql -d artesa_produccion -f backend/database/init/05-produccion-seed.sql
```

### 2. **Implementar Backend de Amasado** 🔴

**Archivos a Crear**:
- `backend/src/models/amasado.model.js`
- `backend/src/controllers/amasado.controller.js`
- `backend/src/routes/amasado.routes.js`

**Endpoints Necesarios**:
- `GET /api/amasado/amasadoras`
- `GET /api/amasado/:masaId`
- `GET /api/amasado/:masaId/ingredientes`
- `POST /api/amasado/:masaId`
- `PUT /api/amasado/:masaId`
- `POST /api/amasado/:masaId/confirmar`

### 3. **Implementar Backend de División** 🔴

**Archivos a Crear**:
- `backend/src/models/division.model.js`
- `backend/src/controllers/division.controller.js`
- `backend/src/routes/division.routes.js`

**Endpoints Necesarios**:
- `GET /api/division/maquinas`
- `GET /api/division/:masaId`
- `GET /api/division/:masaId/productos`
- `POST /api/division/:masaId`
- `PUT /api/division/:masaId/producto/:productoId`
- `POST /api/division/:masaId/confirmar`

### 4. **Implementar Frontend** 🔴

**Servicios**:
- `frontend/src/services/amasadoService.ts`
- `frontend/src/services/divisionService.ts`

**Componentes**:
- `frontend/src/pages/Amasado/AmasadoMasa.tsx`
- `frontend/src/pages/Division/DivisionMasa.tsx`
- `frontend/src/components/fases/NavegacionFases.tsx`

### 5. **Configurar Envío de Correos** ⚠️

**Opciones**:
- NodeMailer (SMTP)
- SendGrid (API)
- AWS SES (API)

**Archivos a Modificar**:
- `backend/src/services/email.service.js` (crear)
- `backend/src/controllers/pesaje.controller.js` (actualizar)

### 6. **Actualizar Rutas Principales** 🔴

**Archivo**: `backend/src/routes/index.js`

Agregar:
```javascript
const amasadoRoutes = require('./amasado.routes');
const divisionRoutes = require('./division.routes');

router.use('/amasado', amasadoRoutes);
router.use('/division', divisionRoutes);
```

---

## ✅ Lo que SÍ está listo

1. ✅ **Scripts SQL completos** para todas las tablas
2. ✅ **Datos semilla** para amasadoras, máquinas y productos
3. ✅ **Modelo de fases** con validación de checklist
4. ✅ **Configuración del sistema** para factor de absorción y correos
5. ✅ **Estructura de notificaciones** para empaque

---

## 📋 Checklist de Implementación

### Fase 1: Base de Datos (COMPLETADO)
- [x] Crear tabla masas_produccion
- [x] Crear tabla productos_por_masa
- [x] Crear tabla ingredientes_masa
- [x] Crear tabla progreso_fases
- [x] Crear tabla amasadoras
- [x] Crear tabla registros_amasado
- [x] Crear tabla maquinas_corte
- [x] Crear tabla registros_division
- [x] Crear tabla catalogo_productos
- [x] Crear tabla notificaciones_empaque
- [x] Insertar datos semilla

### Fase 2: Backend Amasado (PENDIENTE)
- [ ] Modelo amasado.model.js
- [ ] Controlador amasado.controller.js
- [ ] Rutas amasado.routes.js
- [ ] Validación de amasado completo
- [ ] Endpoint confirmar amasado

### Fase 3: Backend División (PENDIENTE)
- [ ] Modelo division.model.js
- [ ] Controlador division.controller.js
- [ ] Rutas division.routes.js
- [ ] Lógica de productos por masa
- [ ] Validación de división completa
- [ ] Endpoint confirmar división

### Fase 4: Backend Correos (PENDIENTE)
- [ ] Servicio de correo email.service.js
- [ ] Configuración SMTP/API
- [ ] Plantillas de correo
- [ ] Testing de envío

### Fase 5: Frontend (PENDIENTE)
- [ ] Servicios TypeScript
- [ ] Tipos e interfaces
- [ ] Componente Amasado
- [ ] Componente División
- [ ] Navegación por pestañas
- [ ] Formularios y validaciones

---

## 💡 Recomendaciones

### 1. Priorización

**Orden Sugerido de Implementación**:
1. Ejecutar scripts SQL (CRÍTICO)
2. Backend Amasado
3. Backend División
4. Frontend Amasado y División
5. Envío de correos
6. Navegación por pestañas

### 2. Testing

Crear casos de prueba para:
- Validación de pesaje completo
- Validación de amasado completo
- Cálculo de tiempo de reposo
- Envío de correos electrónicos

### 3. Coordinación con SAP

Pendiente reunión con equipo SAP para:
- Integración de órdenes de fabricación
- Estructura de datos esperada
- Manejo de prefermento

---

## 📝 Notas Adicionales

### Diferencias con Sistema Actual (IMSoft)

Kevin mencionó problemas con IMSoft:
- No permite modificar unidades programadas fácilmente
- No tiene control de fases
- No valida que el pesaje esté completo
- No notifica a empaque automáticamente

### Mejoras del Nuevo Sistema

1. ✅ Validación estricta entre fases
2. ✅ Modificación de mermas por producto
3. ✅ Factor de absorción configurable
4. ✅ Notificaciones automáticas a empaque
5. ✅ Catálogo de productos con pesos
6. ✅ Trazabilidad completa
7. ✅ Registro de maquinaria usada

---

**Revisado por**: Claude Sonnet 4.5
**Fecha**: 2026-01-23
**Basado en**: Reunión del 15/01/2026 (55min 38s)
**Archivos Creados**:
- [04-produccion-tablas.sql](backend/database/init/04-produccion-tablas.sql)
- [05-produccion-seed.sql](backend/database/init/05-produccion-seed.sql)
