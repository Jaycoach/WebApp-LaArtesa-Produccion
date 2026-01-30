# 🚀 INSTRUCCIONES PARA EJECUTAR EL SISTEMA LA ARTESA

## 📋 RESUMEN DEL PROBLEMA ACTUAL

Has reportado que no puedes navegar a Pesaje, Amasado y División. El problema principal es que:

1. ❌ **El backend NO está ejecutándose** (o no está respondiendo en `http://localhost:3000`)
2. ❌ **No hay datos en la base de datos** para la fecha seleccionada
3. ✅ **La navegación está arreglada** - Los componentes de División, Amasado y Pesaje ya están funcionales

---

## 🔧 PASO 1: VERIFICAR Y EJECUTAR EL BACKEND

### 1.1 Verificar si el backend está corriendo

Abre una nueva terminal y ejecuta:

```bash
curl http://localhost:3000/api/
```

**Si el backend está corriendo:** Verás una respuesta JSON
**Si NO está corriendo:** Verás un error "Connection refused" o similar

### 1.2 Iniciar el backend

#### Opción A: Modo Desarrollo (Recomendado)

```bash
cd c:\Users\jayco\OneDrive\CLIENTES\MASORG\Desarrollo\LaArtesa_Produccion\backend
npm run dev
```

#### Opción B: Modo Producción

```bash
cd c:\Users\jayco\OneDrive\CLIENTES\MASORG\Desarrollo\LaArtesa_Produccion\backend
npm start
```

### 1.3 Verificar que el backend esté corriendo

Deberías ver algo como:

```
🚀 Server running on port 3000
✅ Database connected successfully
```

---

## 🗄️ PASO 2: VERIFICAR LA BASE DE DATOS

### 2.1 Verificar conexión a PostgreSQL

El backend necesita una base de datos PostgreSQL corriendo. Verifica el archivo `.env` en el backend:

```bash
cd c:\Users\jayco\OneDrive\CLIENTES\MASORG\Desarrollo\LaArtesa_Produccion\backend
type .env
```

Deberías ver algo como:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=artesa_produccion
DB_USER=postgres
DB_PASSWORD=tu_password
```

### 2.2 Verificar que PostgreSQL esté corriendo

```bash
# En Windows
sc query postgresql-x64-14
```

Si no está corriendo, inícialo:

```bash
# En Windows (como administrador)
sc start postgresql-x64-14
```

### 2.3 Conectarse a la base de datos

Usando pgAdmin o psql:

```bash
psql -h localhost -U postgres -d artesa_produccion
```

Verifica que existan tablas:

```sql
\dt
```

Deberías ver tablas como: `masas_produccion`, `productos_por_masa`, `ingredientes_masa`, etc.

---

## 📊 PASO 3: CREAR DATOS DE PRUEBA

Si no tienes datos en la base de datos, hay dos opciones:

### Opción A: Sincronizar desde SAP (Producción)

**IMPORTANTE:** Esta opción solo funciona si tienes conexión con SAP Business One configurada.

1. Inicia el frontend:
   ```bash
   cd c:\Users\jayco\OneDrive\CLIENTES\MASORG\Desarrollo\LaArtesa_Produccion\frontend
   npm run dev
   ```

2. Abre el navegador en `http://localhost:5173`

3. Login con tus credenciales

4. Ve a **Planificación** → Click en **"Sincronizar SAP"**

5. Esto creará masas desde las órdenes de fabricación de SAP

### Opción B: Insertar datos de prueba manualmente (Desarrollo)

Conecta a la base de datos y ejecuta estos scripts:

```sql
-- 1. Insertar un usuario de prueba
INSERT INTO usuarios (username, password_hash, nombre, rol, email, activo)
VALUES ('admin', '$2b$10$XYZ...', 'Admin Demo', 'ADMIN', 'admin@artesa.com', true);

-- 2. Insertar un tipo de masa en el catálogo
INSERT INTO catalogo_tipos_masa (
    codigo_sap, tipo_masa, nombre_masa,
    requiere_reposo_pre_division, tiempo_reposo_division_minutos,
    requiere_formado, requiere_camara_frio,
    tiempo_fermentacion_estandar_minutos
) VALUES (
    'HAMBURGUESA_GOLD_6', 'GOLD', 'Hamburguesa Gold x6',
    true, 10,
    true, false,
    45
);

-- 3. Insertar una masa de producción de prueba
INSERT INTO masas_produccion (
    codigo_masa, tipo_masa, nombre_masa, fecha_produccion,
    estado, fase_actual,
    total_kilos_base, porcentaje_merma, total_kilos_con_merma,
    factor_absorcion_usado,
    total_ordenes, total_productos,
    total_unidades_pedidas, total_unidades_programadas
) VALUES (
    'TEST-20260130-001', 'GOLD', 'Hamburguesa Gold x6', '2026-01-30',
    'PLANIFICACION', 'PESAJE',
    50.0, 5.0, 52.5,
    60.0,
    1, 1,
    100, 105
) RETURNING id;

-- Guarda el ID que devuelve (ejemplo: 1)

-- 4. Insertar productos para esta masa (usa el ID de arriba)
INSERT INTO productos_por_masa (
    masa_id, producto_codigo, producto_nombre, presentacion,
    gramaje_unitario, unidades_pedidas, unidades_programadas,
    kilos_pedidos, kilos_programados
) VALUES (
    1, 'HAMB-GOLD-6', 'Hamburguesa Gold x6', 'Bolsa x6',
    500, 100, 105,
    50.0, 52.5
);

-- 5. Insertar ingredientes para esta masa
INSERT INTO ingredientes_masa (
    masa_id, ingrediente_nombre, orden_visualizacion,
    porcentaje_panadero, es_harina, es_agua,
    cantidad_gramos, cantidad_kilos,
    disponible, verificado, pesado
) VALUES
(1, 'Harina de Trigo', 1, 100.0, true, false, 30000, 30.0, false, false, false),
(1, 'Agua', 2, 60.0, false, true, 18000, 18.0, false, false, false),
(1, 'Sal', 3, 2.0, false, false, 600, 0.6, false, false, false),
(1, 'Levadura', 4, 3.0, false, false, 900, 0.9, false, false, false),
(1, 'Azúcar', 5, 5.0, false, false, 1500, 1.5, false, false, false),
(1, 'Aceite', 6, 3.0, false, false, 900, 0.9, false, false, false);

-- 6. Insertar progreso de fases
INSERT INTO progreso_fases (
    masa_id, fase, estado, porcentaje_completado
) VALUES
(1, 'PESAJE', 'EN_PROGRESO', 0),
(1, 'AMASADO', 'BLOQUEADA', 0),
(1, 'DIVISION', 'BLOQUEADA', 0),
(1, 'FORMADO', 'BLOQUEADA', 0),
(1, 'FERMENTACION', 'BLOQUEADA', 0),
(1, 'HORNEADO', 'BLOQUEADA', 0);
```

---

## 🖥️ PASO 4: INICIAR EL FRONTEND

### 4.1 Instalar dependencias (si no lo has hecho)

```bash
cd c:\Users\jayco\OneDrive\CLIENTES\MASORG\Desarrollo\LaArtesa_Produccion\frontend
npm install
```

### 4.2 Iniciar el frontend en modo desarrollo

```bash
npm run dev
```

### 4.3 Abrir en el navegador

Abre `http://localhost:5173` en tu navegador

---

## 🔍 PASO 5: PROBAR EL FLUJO DE NAVEGACIÓN

Una vez que tengas el backend y frontend corriendo, y datos en la base de datos:

### 5.1 Login

1. Abre `http://localhost:5173/login`
2. Ingresa credenciales (ejemplo: `admin` / `password`)
3. Deberías ser redirigido al Dashboard

### 5.2 Navegar a Planificación

1. Click en **"Planificación"** en el menú lateral
2. Deberías ver la lista de masas
3. Selecciona la fecha: **30 de Enero de 2026** (o la fecha que pusiste en los datos de prueba)

### 5.3 Ver detalle de una masa

1. Click en una tarjeta de masa
2. Verás el detalle completo: productos, ingredientes, progreso de fases

### 5.4 Navegar a procesos

Desde el detalle de la masa, deberías ver tarjetas de "Progreso de Producción":

#### ✅ PESAJE (debe estar EN_PROGRESO o desbloqueada)
- Click en la tarjeta de **PESAJE**
- Verás el checklist de ingredientes
- Podrás marcar: Disponible → Verificado → Pesado
- Registrar peso real, lote, vencimiento
- Botón **"Confirmar Pesaje Completo"**

#### ✅ AMASADO (se desbloquea al completar PESAJE)
- Click en la tarjeta de **AMASADO**
- Formulario con: temperaturas, velocidades, amasadora
- Botón **"Completar Amasado"**

#### ✅ DIVISIÓN (se desbloquea al completar AMASADO)
- Click en la tarjeta de **DIVISIÓN**
- Formulario con: máquina de corte, temperatura, reposo
- Tabla para registrar cantidades divididas por producto
- Botón **"Completar División"**

---

## ⚠️ PROBLEMAS COMUNES Y SOLUCIONES

### Problema: "Connection refused" al conectar con el backend

**Solución:**
- Verifica que el backend esté corriendo en el puerto 3000
- Ejecuta: `npm run dev` en la carpeta `backend`
- Verifica el archivo `.env` tenga la configuración correcta

### Problema: "Database connection error"

**Solución:**
- Verifica que PostgreSQL esté corriendo
- Verifica credenciales en el archivo `.env`
- Verifica que la base de datos `artesa_produccion` exista

### Problema: "No hay masas para esta fecha"

**Solución:**
- Inserta datos de prueba (ver Paso 3, Opción B)
- O sincroniza desde SAP (ver Paso 3, Opción A)
- Asegúrate de que la fecha en el selector coincida con la fecha en tus datos

### Problema: Error de CORS

**Solución:**
Verifica que el backend tenga configurado CORS para `http://localhost:5173`:

En `backend/src/server.js` debería haber:
```javascript
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
```

### Problema: Las fases están bloqueadas

**Solución:**
- Las fases se desbloquean secuencialmente
- PESAJE es la primera fase (debe estar EN_PROGRESO desde el inicio)
- Completa cada fase para desbloquear la siguiente

---

## 📝 CHECKLIST FINAL

Antes de reportar problemas, verifica:

- [ ] ✅ PostgreSQL está corriendo
- [ ] ✅ Backend está corriendo en puerto 3000
- [ ] ✅ Frontend está corriendo en puerto 5173
- [ ] ✅ Hay datos en la base de datos para la fecha seleccionada
- [ ] ✅ Puedes hacer login exitosamente
- [ ] ✅ Ves masas en la lista de Planificación
- [ ] ✅ Puedes acceder al detalle de una masa
- [ ] ✅ Las tarjetas de fases son clickeables (excepto las bloqueadas)

---

## 🆘 SI AÚN NO FUNCIONA

Si después de seguir estos pasos aún tienes problemas, proporciona:

1. **Logs del backend**: Copia la salida de la consola donde ejecutaste `npm run dev`
2. **Logs del navegador**: Abre DevTools (F12) → pestaña Console → copia los errores
3. **Versión de Node**: Ejecuta `node --version`
4. **Versión de npm**: Ejecuta `npm --version`
5. **Estado de PostgreSQL**: Ejecuta `sc query postgresql-x64-14`

---

**Desarrollado para:** Artesa SAS
**Fecha:** 30 de Enero de 2026
**Versión del Sistema:** 2.0.0
