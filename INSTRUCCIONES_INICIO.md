# Instrucciones de Inicio - Sistema La Artesa

## Fecha: 2026-01-23

## 📋 Requisitos Previos

Antes de iniciar, asegúrate de tener instalado:

- **Node.js** v18 o superior
- **PostgreSQL** v14 o superior
- **npm** o **yarn**
- **Git** (opcional)

## 🗄️ Configuración de la Base de Datos

### 1. Crear la Base de Datos

```bash
# Conectarse a PostgreSQL
psql -U postgres

# Crear la base de datos
CREATE DATABASE artesa_produccion;

# Crear usuario (opcional)
CREATE USER artesa_user WITH PASSWORD 'tu_password_seguro';
GRANT ALL PRIVILEGES ON DATABASE artesa_produccion TO artesa_user;

# Salir
\q
```

### 2. Inicializar el Schema

Los archivos SQL se ejecutan automáticamente en orden numérico:

```bash
cd backend/database/init

# Ejecutar todos los scripts en orden
psql -U postgres -d artesa_produccion -f 01-init.sql
psql -U postgres -d artesa_produccion -f 02-seed.sql
psql -U postgres -d artesa_produccion -f 03-sessions.sql
psql -U postgres -d artesa_produccion -f 04-produccion-tablas.sql
psql -U postgres -d artesa_produccion -f 05-produccion-seed.sql
psql -U postgres -d artesa_produccion -f 06-datos-demo.sql
```

**O ejecutar todos de una vez:**

```bash
cd backend/database/init
for file in *.sql; do
  echo "Ejecutando: $file"
  psql -U postgres -d artesa_produccion -f "$file"
done
```

**En Windows PowerShell:**

```powershell
cd backend\database\init
Get-ChildItem *.sql | ForEach-Object {
  Write-Host "Ejecutando: $($_.Name)"
  psql -U postgres -d artesa_produccion -f $_.FullName
}
```

### 3. Verificar la Instalación

```sql
-- Conectarse a la base de datos
psql -U postgres -d artesa_produccion

-- Verificar que las tablas se crearon
\dt

-- Verificar datos de demo
SELECT COUNT(*) FROM masas_produccion;
SELECT COUNT(*) FROM usuarios;
SELECT COUNT(*) FROM amasadoras;

-- Debe mostrar:
-- masas_produccion: 3
-- usuarios: 5
-- amasadoras: 4
```

## 🚀 Iniciar el Backend

### 1. Instalar Dependencias

```bash
cd backend
npm install
```

### 2. Configurar Variables de Entorno

Crear archivo `.env` en la carpeta `backend`:

```env
# Servidor
NODE_ENV=development
PORT=3000
HOST=localhost

# Base de Datos
DB_HOST=localhost
DB_PORT=5432
DB_NAME=artesa_produccion
DB_USER=postgres
DB_PASSWORD=tu_password
DB_SSL=false

# JWT
JWT_SECRET=tu_clave_secreta_muy_segura_cambiar_en_produccion
JWT_EXPIRES_IN=24h

# CORS
CORS_ORIGIN=http://localhost:5173

# Logs
LOG_LEVEL=debug

# SAP (opcional - para integración futura)
SAP_ENABLED=false
SAP_HOST=
SAP_PORT=
SAP_USER=
SAP_PASSWORD=

# Email (opcional - para notificaciones)
EMAIL_ENABLED=false
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASSWORD=
```

### 3. Iniciar el Servidor

```bash
# Modo desarrollo (con recarga automática)
npm run dev

# O modo producción
npm start
```

El servidor estará disponible en: `http://localhost:3000`

### 4. Verificar que el Backend está funcionando

```bash
# Probar endpoint de salud
curl http://localhost:3000/api/health

# Debe responder:
# {"status":"ok","timestamp":"..."}
```

## 🎨 Iniciar el Frontend

### 1. Instalar Dependencias

```bash
cd frontend
npm install
```

### 2. Configurar Variables de Entorno

Crear archivo `.env` en la carpeta `frontend`:

```env
VITE_API_URL=http://localhost:3000
VITE_APP_NAME=ARTESA - Producción
VITE_APP_VERSION=1.0.0
```

### 3. Iniciar el Servidor de Desarrollo

```bash
npm run dev
```

El frontend estará disponible en: `http://localhost:5173`

## 🔐 Credenciales de Acceso

### Usuario Administrador
- **Usuario:** `admin`
- **Password:** `Admin123!@#`
- **Rol:** ADMIN

### Usuarios de Prueba
- **Supervisor:** `supervisor1` / `Test123!@#`
- **Operario 1:** `operario1` / `Test123!@#`
- **Operario 2:** `operario2` / `Test123!@#`
- **Calidad:** `calidad1` / `Test123!@#`

⚠️ **IMPORTANTE:** Cambiar estas contraseñas en producción

## 📊 Datos de Demostración

El sistema viene con 3 masas de ejemplo:

### 1. Masa GOLD (Hoy - En Pesaje)
- **Código:** `GOLD-YYYYMMDD-001`
- **Estado:** En fase de PESAJE
- **Uso:** Practicar el checklist de pesaje
- **Ingredientes:** 6 ingredientes sin pesar

### 2. Masa BRIOCHE (Hoy - En Planificación)
- **Código:** `BRIOCHE-YYYYMMDD-001`
- **Estado:** En fase de PLANIFICACION
- **Uso:** Revisar la planificación
- **Ingredientes:** 6 ingredientes

### 3. Masa ARABE (Ayer - Completada)
- **Código:** `ARABE-YYYYMMDD-001`
- **Estado:** COMPLETADA
- **Uso:** Ver historial de producción completa
- **Todas las fases:** Completadas con timestamps

## 🧪 Probar la API

### Usando cURL

```bash
# 1. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123!@#"}'

# Guardar el token que retorna

# 2. Obtener masas del día
curl http://localhost:3000/api/masas?fecha=2026-01-23 \
  -H "Authorization: Bearer TU_TOKEN_AQUI"

# 3. Obtener checklist de pesaje (usar ID de la masa GOLD)
curl http://localhost:3000/api/pesaje/1/checklist \
  -H "Authorization: Bearer TU_TOKEN_AQUI"
```

### Usando Thunder Client o Postman

1. Importar la colección de endpoints (crear archivo JSON con los endpoints)
2. Configurar la variable `baseURL` = `http://localhost:3000`
3. Hacer login y copiar el token
4. Usar el token en el header `Authorization: Bearer TOKEN`

## 📁 Estructura del Proyecto

```
LaArtesa_Produccion/
├── backend/
│   ├── src/
│   │   ├── controllers/      # Controladores de rutas
│   │   ├── models/           # Modelos de datos (queries)
│   │   ├── routes/           # Definición de rutas
│   │   ├── middleware/       # Middlewares (auth, errors, etc.)
│   │   ├── utils/            # Utilidades
│   │   └── server.js         # Punto de entrada
│   ├── database/
│   │   └── init/             # Scripts SQL de inicialización
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/       # Componentes reutilizables
│   │   ├── pages/            # Páginas de la aplicación
│   │   ├── services/         # Servicios de API
│   │   ├── hooks/            # Custom hooks de React
│   │   ├── types/            # Tipos TypeScript
│   │   └── config/           # Configuraciones
│   └── package.json
└── docs/                     # Documentación
```

## 🔧 Scripts Útiles

### Backend

```bash
# Desarrollo con recarga automática
npm run dev

# Producción
npm start

# Ejecutar tests (cuando estén implementados)
npm test

# Linter
npm run lint
```

### Frontend

```bash
# Desarrollo
npm run dev

# Build para producción
npm run build

# Preview del build
npm run preview

# Linter
npm run lint

# Type checking
npm run type-check
```

## 🐛 Troubleshooting

### Error de Conexión a la Base de Datos

```bash
# Verificar que PostgreSQL está corriendo
systemctl status postgresql  # Linux
# o
pg_ctl status                # Windows

# Verificar que puedes conectarte
psql -U postgres -d artesa_produccion
```

### Error de CORS en el Frontend

Verificar que en `backend/.env`:
```env
CORS_ORIGIN=http://localhost:5173
```

### Puerto ya en uso

```bash
# Linux/Mac - Encontrar proceso en puerto 3000
lsof -i :3000
kill -9 PID

# Windows - Encontrar proceso
netstat -ano | findstr :3000
taskkill /PID numero_pid /F
```

### Error de JWT

Verificar que `JWT_SECRET` esté configurado en `backend/.env`

## 📝 Próximos Pasos

1. ✅ Base de datos configurada
2. ✅ Backend corriendo
3. ✅ Frontend corriendo
4. ✅ Datos de demo cargados
5. ⏭️ Probar el flujo completo de pesaje
6. ⏭️ Implementar integración con SAP
7. ⏭️ Configurar envío de correos
8. ⏭️ Deploy a producción

## 📚 Documentación Adicional

- [RESUMEN_CORRECCIONES.md](RESUMEN_CORRECCIONES.md) - Correcciones de consistencia FrontEnd/BackEnd
- [VALIDACION_CHECKLIST_PESAJE.md](backend/VALIDACION_CHECKLIST_PESAJE.md) - Validación del checklist
- [ANALISIS_REUNION_15_ENERO_2026.md](ANALISIS_REUNION_15_ENERO_2026.md) - Análisis de la reunión del 15/01/2026

## 🆘 Soporte

Para problemas o preguntas:
1. Revisar la documentación en la carpeta `docs/`
2. Verificar los logs del backend en la consola
3. Revisar los errores del navegador en la consola de desarrollo
4. Contactar al equipo de desarrollo

---

**Última actualización:** 2026-01-23
**Versión del sistema:** 1.0.0
