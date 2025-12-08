# 🍞 Artesa Backend - Sistema de Gestión de Producción

Backend API RESTful para el sistema de gestión de producción de panadería **LA ARTESA SAS**.

---

## ✅ Estado del Proyecto

**Fase Actual:** Implementación de Autenticación y Usuarios

### ✅ Completado (PASO 1 y PASO 2)

#### Servicios de Autenticación
- [x] Register
- [x] Login
- [x] Refresh Token
- [x] Logout
- [x] Forgot Password
- [x] Reset Password
- [x] Change Password
- [x] Get Profile
- [x] Update Profile

#### Servicios de Usuarios
- [x] CRUD completo
- [x] Gestión de roles
- [x] Activar/Desactivar usuarios
- [x] Resetear contraseñas
- [x] Desbloquear usuarios
- [x] Obtener actividad
- [x] Estadísticas de usuarios

#### Infraestructura Base
- [x] Configuración centralizada
- [x] Conexión a PostgreSQL
- [x] Sistema de logging con Winston
- [x] Middleware de seguridad
- [x] Middleware de autenticación JWT
- [x] Middleware de verificación de roles
- [x] Manejo de errores centralizado
- [x] Rate limiting (10 limitadores especializados)
- [x] Request logging

---

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js >= 18.0.0
- PostgreSQL >= 15
- npm >= 9.0.0
- Docker y Docker Compose (opcional)

### Opción 1: Con Docker (Recomendado)

```bash
# 1. Clonar el repositorio
git clone <repository-url>
cd artesa-backend

# 2. Las variables de entorno ya están configuradas
# (Incluyen secretos JWT seguros generados)

# 3. Iniciar servicios
docker-compose up -d

# 4. Verificar que esté corriendo
docker-compose ps
docker-compose logs -f backend

# 5. Probar la API
curl http://localhost:3000/health
```

**API disponible en:**
- API: http://localhost:3000
- Docs: http://localhost:3000/api-docs
- Health: http://localhost:3000/health

### Opción 2: Desarrollo Local (sin Docker)

```bash
# 1. Clonar el repositorio
git clone <repository-url>
cd artesa-backend

# 2. Instalar dependencias
npm install

# 3. Configurar PostgreSQL
psql -U postgres

CREATE DATABASE artesa_db;
CREATE USER artesa_user WITH PASSWORD 'artesa_password_2025';
GRANT ALL PRIVILEGES ON DATABASE artesa_db TO artesa_user;
\q

# 4. Ejecutar scripts de inicialización
psql -U artesa_user -d artesa_db -f database/init/01-init.sql
psql -U artesa_user -d artesa_db -f database/init/02-seed.sql
psql -U artesa_user -d artesa_db -f database/init/03-sessions.sql

# 5. Iniciar servidor
npm run dev
```

---

## 📚 API Endpoints

### Autenticación (`/api/auth`)

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Registrar nuevo usuario | No |
| POST | `/login` | Iniciar sesión | No |
| POST | `/refresh` | Refrescar token | No |
| POST | `/logout` | Cerrar sesión | No |
| POST | `/forgot-password` | Solicitar recuperación | No |
| POST | `/reset-password` | Resetear con token | No |
| POST | `/change-password` | Cambiar contraseña | Sí |
| GET | `/profile` | Obtener perfil | Sí |
| PUT | `/profile` | Actualizar perfil | Sí |
| GET | `/verify` | Verificar token | Sí |

### Usuarios (`/api/users`)

| Método | Endpoint | Descripción | Rol Requerido |
|--------|----------|-------------|---------------|
| GET | `/` | Listar usuarios | Admin, Supervisor |
| GET | `/:id` | Obtener usuario | Admin, Supervisor |
| POST | `/` | Crear usuario | Admin |
| PUT | `/:id` | Actualizar usuario | Admin |
| DELETE | `/:id` | Eliminar usuario | Admin |
| POST | `/:id/activate` | Activar usuario | Admin |
| POST | `/:id/deactivate` | Desactivar usuario | Admin |
| POST | `/:id/reset-password` | Resetear contraseña | Admin |
| POST | `/:id/unlock` | Desbloquear usuario | Admin |
| GET | `/:id/activity` | Ver actividad | Admin, Supervisor |
| GET | `/stats` | Estadísticas | Admin, Supervisor |

---

## 🔐 Autenticación

El sistema usa **JWT (JSON Web Tokens)** con dos tipos de tokens:

- **Access Token**: Válido por 24 horas
- **Refresh Token**: Válido por 7 días

### Ejemplo de Login

```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "Admin123!@#"
}
```

**Respuesta:**
```json
{
  "success": true,
  "message": "Login exitoso",
  "data": {
    "user": {
      "id": 1,
      "username": "admin",
      "email": "admin@artesa.com",
      "nombre_completo": "Administrador del Sistema",
      "rol": "admin"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": "24h"
  }
}
```

### Usar Token en Requests

```bash
GET /api/users
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## 👥 Sistema de Roles

| Rol | Descripción | Permisos |
|-----|-------------|----------|
| `admin` | Administrador | Todos los permisos |
| `supervisor` | Supervisor | Ver usuarios, órdenes, reportes |
| `operador` | Operador | Gestionar órdenes, procesos |
| `visualizador` | Solo lectura | Solo ver información |

---

## 🗄️ Estructura del Proyecto

```
artesa-backend/
├── src/
│   ├── config/
│   │   └── index.js           # Configuración centralizada
│   ├── controllers/
│   │   ├── auth.controller.js # Controlador de autenticación
│   │   └── user.controller.js # Controlador de usuarios
│   ├── database/
│   │   └── connection.js      # Conexión PostgreSQL
│   ├── middleware/
│   │   ├── auth.js            # Middleware de autenticación
│   │   ├── roleCheck.js       # Verificación de roles
│   │   ├── errorHandler.js    # Manejo de errores
│   │   ├── rateLimiter.js     # Rate limiting (10 limitadores)
│   │   └── requestLogger.js   # Logging de requests
│   ├── routes/
│   │   ├── index.js           # Router principal
│   │   ├── auth.routes.js     # Rutas de autenticación
│   │   └── user.routes.js     # Rutas de usuarios
│   ├── services/
│   │   ├── auth.service.js    # Lógica de autenticación
│   │   └── user.service.js    # Lógica de usuarios
│   ├── utils/
│   │   ├── jwt.js             # Utilidades JWT
│   │   └── logger.js          # Sistema de logging
│   ├── validators/
│   │   ├── auth.validator.js  # Validadores de auth
│   │   └── user.validator.js  # Validadores de users
│   └── server.js              # Servidor principal
│
├── database/
│   └── init/
│       ├── 01-init.sql        # Tablas iniciales
│       ├── 02-seed.sql        # Datos de prueba
│       └── 03-sessions.sql    # Tabla de sesiones
│
├── logs/                      # Archivos de log
├── nginx/                     # Configuración Nginx
├── .env                       # Variables de entorno (incluidas)
├── .env.example               # Template de respaldo
├── docker-compose.yml         # Orquestación de servicios
├── Dockerfile                 # Imagen del backend
├── package.json              # Dependencias del proyecto
└── README.md                 # Este archivo
```

---

## 📊 Scripts NPM

```bash
# Desarrollo
npm start          # Iniciar en producción
npm run dev        # Iniciar en desarrollo (con nodemon)

# Testing
npm test           # Ejecutar tests
npm run test:watch # Tests en modo watch

# Code Quality
npm run lint       # Revisar código
npm run lint:fix   # Corregir problemas de lint
npm run format     # Formatear código

# Seguridad
npm run security:check # Auditar vulnerabilidades

# Documentación
npm run docs       # Generar documentación
```

---

## 🐳 Comandos Docker

```bash
# Iniciar servicios
docker-compose up -d

# Ver logs en tiempo real
docker-compose logs -f backend

# Detener servicios
docker-compose down

# Reconstruir imágenes
docker-compose up -d --build

# Ejecutar comando en contenedor
docker-compose exec backend npm run <comando>

# Acceder a PostgreSQL
docker-compose exec postgres psql -U artesa_user -d artesa_db

# Ver estado de servicios
docker-compose ps

# Reiniciar servicios
docker-compose restart backend
```

---

## 🔧 Variables de Entorno

El archivo `.env` ya incluye todas las variables necesarias:

```env
# Servidor
NODE_ENV=development
PORT=3000

# Base de datos
DB_HOST=postgres
DB_PORT=5432
DB_NAME=artesa_db
DB_USER=artesa_user
DB_PASSWORD=artesa_password_2025

# JWT (¡Ya generados y seguros!)
JWT_SECRET=<valor-incluido>
JWT_REFRESH_SECRET=<valor-incluido>

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=http://localhost:3000

# Logging
LOG_LEVEL=debug
```

**Cambiar en producción:**
- Credenciales de base de datos
- Secretos JWT (regenerar con: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- Variables SAP cuando corresponda

---

## 🔐 Seguridad Implementada

### Características de Seguridad:

1. **Autenticación JWT** con access y refresh tokens
2. **Bcrypt** para hashing de contraseñas (12 rounds)
3. **Helmet** para headers HTTP seguros
4. **Rate Limiting** - 10 limitadores especializados:
   - General (100 req/15min por IP)
   - Auth (5 intentos/15min por IP)
   - Create/Update/Delete (limitados)
   - Admin (operaciones administrativas)
   - Strict (operaciones críticas)
   - SAP (sincronización)
   - Query (consultas complejas)
   - Export (exportación de datos)
5. **CORS** configurado
6. **XSS Protection**
7. **HPP** (HTTP Parameter Pollution)
8. **Input Sanitization**
9. **Control de sesiones** y bloqueo por intentos fallidos
10. **Logging de eventos de seguridad**

### Usuario Administrador por Defecto

**⚠️ IMPORTANTE: Cambiar en producción**

```
Username: admin
Email: admin@artesa.com
Password: Admin123!@#
```

**Al primer login se debe cambiar la contraseña.**

---

## 📊 Base de Datos

### Tablas Principales

| Tabla | Descripción |
|-------|-------------|
| `usuarios` | Gestión de usuarios y autenticación |
| `ordenes_produccion` | Órdenes de producción |
| `orden_productos` | Productos por orden |
| `etapas_proceso` | Etapas del proceso productivo |
| `control_calidad` | Control de calidad |
| `recetas` | Recetas/fórmulas |
| `receta_ingredientes` | Ingredientes de recetas |
| `lotes` | Control de lotes |
| `sap_sync_log` | Log de sincronización SAP |
| `auditoria` | Auditoría del sistema |
| `configuracion_sistema` | Configuraciones |
| `sesiones_usuarios` | Control de sesiones |

### Respaldo y Restauración

```bash
# Crear backup
docker-compose exec postgres pg_dump -U artesa_user artesa_db > backup.sql

# Restaurar backup
docker-compose exec -T postgres psql -U artesa_user artesa_db < backup.sql

# Resetear base de datos (⚠️ Cuidado en producción)
docker-compose down -v
docker-compose up -d
```

---

## 📊 Monitoreo

### Health Check

```bash
curl http://localhost:3000/health
```

**Respuesta:**
```json
{
  "status": "OK",
  "timestamp": "2025-01-07T...",
  "uptime": 1234.56,
  "environment": "development",
  "database": "Connected"
}
```

### Logs

Los logs se guardan en `logs/`:

```
logs/
├── combined-YYYY-MM-DD.log  # Todos los logs
├── error-YYYY-MM-DD.log     # Solo errores
└── sap-sync-YYYY-MM-DD.log  # Sincronización SAP
```

Ver logs en tiempo real:
```bash
# Con Docker
docker-compose logs -f backend

# Sin Docker
tail -f logs/combined-*.log
```

---

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Tests en modo watch
npm run test:watch

# Tests con coverage
npm test -- --coverage

# Tests específicos
npm test -- auth.test.js
```

---

## 🔄 Integración SAP

### Configuración

Las credenciales SAP se configuran en `.env`:

```env
SAP_URL=https://tu-servidor-sap:50000/b1s/v1
SAP_COMPANY=ARTESA_SAS
SAP_USER=tu_usuario_api
SAP_PASSWORD=tu_password
```

### Sincronización Automática

La sincronización se ejecuta automáticamente a las 8:00 PM (Lun-Vie).

Ejecutar manualmente:
```bash
curl -X POST http://localhost:3000/api/sync/now \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🚀 Despliegue a Producción

### Preparación

1. **Generar nuevos secretos JWT:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

2. **Actualizar `.env` con valores de producción:**
   - Credenciales seguras de BD
   - Nuevos secretos JWT
   - URLs correctas
   - SAP credenciales

3. **Configurar SSL/TLS en Nginx**

4. **Iniciar con perfil de producción:**
```bash
docker-compose --profile production up -d
```

---

## 🎯 Próximos Pasos

### PASO 3: Órdenes de Producción (Siguiente)

- [ ] Servicios de órdenes
- [ ] Controladores
- [ ] Validadores
- [ ] Rutas
- [ ] Integración SAP

Ver `PROXIMOS_PASOS.md` para el roadmap completo.

---

## 📞 Soporte

- **Email**: jaycoach@hotmail.com
- **Autor**: Jonathan Jay Zúñiga Perdomo
- **Rol**: Consultor SAP Business One | FullStack Developer

---

## 📄 Licencia

MIT
