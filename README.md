# ARTESA - Sistema de Gestión de Producción

Backend API REST para el sistema de gestión de producción de panadería con integración SAP Business One.

## 🚀 Características

- ✅ API REST completa con Express.js
- ✅ Autenticación JWT con refresh tokens
- ✅ PostgreSQL como base de datos
- ✅ Integración con SAP Business One vía Service Layer
- ✅ Sistema de permisos basado en roles (RBAC)
- ✅ Rate limiting y seguridad avanzada
- ✅ Logging completo con Winston
- ✅ Documentación con Swagger
- ✅ Docker y Docker Compose
- ✅ Nginx como reverse proxy
- ✅ Sincronización automática con SAP

## 📋 Requisitos Previos

- Docker y Docker Compose
- Node.js 18+ (para desarrollo local)
- Git
- ngrok (opcional, para desarrollo remoto)

## 🛠️ Instalación

### Opción 1: Con Docker (Recomendado)

1. **Clonar el repositorio:**
```bash
git clone <repository-url>
cd artesa-backend
```

2. **Configurar variables de entorno:**
```bash
cp .env.example .env
```

Editar `.env` y configurar:
- Credenciales de base de datos
- Secretos JWT (IMPORTANTE: generar nuevos)
- Credenciales SAP
- Otras configuraciones

3. **Generar secretos JWT seguros:**
```bash
# En Node.js, ejecutar:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copiar y pegar en `JWT_SECRET` y `JWT_REFRESH_SECRET` en `.env`

4. **Iniciar con Docker Compose:**
```bash
docker-compose up -d
```

5. **Verificar que esté corriendo:**
```bash
docker-compose ps
docker-compose logs -f backend
```

6. **La API estará disponible en:**
- Development: http://localhost:3000
- Documentation: http://localhost:3000/api-docs
- Health: http://localhost:3000/health

### Opción 2: Desarrollo Local (sin Docker)

1. **Instalar PostgreSQL localmente**

2. **Configurar variables de entorno:**
```bash
cp .env.example .env
# Editar .env con configuración local
```

3. **Instalar dependencias:**
```bash
npm install
```

4. **Crear base de datos:**
```bash
# Conectarse a PostgreSQL
psql -U postgres

CREATE DATABASE artesa_db;
CREATE USER artesa_user WITH PASSWORD 'artesa_secure_password_2025';
GRANT ALL PRIVILEGES ON DATABASE artesa_db TO artesa_user;
```

5. **Ejecutar migraciones:**
```bash
# Ejecutar scripts SQL manualmente
psql -U artesa_user -d artesa_db -f database/init/01-init.sql
psql -U artesa_user -d artesa_db -f database/init/02-seed.sql
```

6. **Iniciar servidor en modo desarrollo:**
```bash
npm run dev
```

## 🐳 Comandos Docker

```bash
# Iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f backend

# Detener servicios
docker-compose down

# Reconstruir imágenes
docker-compose up -d --build

# Ejecutar comandos en el contenedor
docker-compose exec backend npm run <comando>

# Acceder a PostgreSQL
docker-compose exec postgres psql -U artesa_user -d artesa_db

# Ver estado de servicios
docker-compose ps

# Reiniciar solo el backend
docker-compose restart backend
```

## 📊 Base de Datos

### Estructura de Tablas

- `usuarios` - Gestión de usuarios y autenticación
- `ordenes_produccion` - Órdenes de producción
- `orden_productos` - Productos por orden
- `etapas_proceso` - Etapas del proceso productivo
- `control_calidad` - Control de calidad
- `recetas` - Recetas/fórmulas
- `receta_ingredientes` - Ingredientes de recetas
- `lotes` - Control de lotes
- `sap_sync_log` - Log de sincronización SAP
- `auditoria` - Auditoría del sistema
- `configuracion_sistema` - Configuraciones

### Comandos Base de Datos

```bash
# Backup
docker-compose exec postgres pg_dump -U artesa_user artesa_db > backup.sql

# Restore
docker-compose exec -T postgres psql -U artesa_user artesa_db < backup.sql

# Resetear base de datos (CUIDADO en producción)
docker-compose down -v
docker-compose up -d
```

## 🔐 Seguridad

### Características de Seguridad Implementadas:

1. **Autenticación JWT** con access y refresh tokens
2. **Bcrypt** para hashing de contraseñas (12 rounds)
3. **Helmet** para headers HTTP seguros
4. **Rate Limiting** por IP
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

Al primer login, se solicitará cambiar la contraseña.

## 📝 API Endpoints

### Autenticación
```
POST   /api/auth/register      - Registrar usuario
POST   /api/auth/login         - Iniciar sesión
POST   /api/auth/refresh       - Renovar token
POST   /api/auth/logout        - Cerrar sesión
GET    /api/auth/me            - Perfil actual
```

### Órdenes de Producción
```
GET    /api/ordenes            - Listar órdenes
GET    /api/ordenes/:id        - Detalle de orden
POST   /api/ordenes/sync       - Sincronizar con SAP
PUT    /api/ordenes/:id/start  - Iniciar producción
PUT    /api/ordenes/:id/close  - Cerrar producción
```

### Proceso Productivo
```
POST   /api/proceso/:id/pesaje
POST   /api/proceso/:id/amasado
POST   /api/proceso/:id/division
POST   /api/proceso/:id/formado
POST   /api/proceso/:id/fermentacion
POST   /api/proceso/:id/horneado
```

Ver documentación completa en `/api-docs`

## 🔧 Scripts NPM

```bash
# Desarrollo
npm run dev              # Iniciar en modo desarrollo (nodemon)

# Producción
npm start                # Iniciar en modo producción

# Base de datos
npm run db:create        # Crear base de datos
npm run db:migrate       # Ejecutar migraciones
npm run db:seed          # Cargar datos iniciales
npm run db:reset         # Resetear BD completa

# Testing
npm test                 # Ejecutar tests
npm run test:watch       # Tests en modo watch

# Code Quality
npm run lint             # Verificar código
npm run lint:fix         # Corregir problemas
npm run format           # Formatear código

# Documentación
npm run docs             # Generar documentación
```

## 🌐 Ngrok (Desarrollo Remoto)

Para exponer la API localmente y permitir acceso remoto:

```bash
# Instalar ngrok
brew install ngrok  # macOS
# o descargar de https://ngrok.com

# Configurar auth token
ngrok config add-authtoken <your-token>

# Exponer puerto 3000
ngrok http 3000
```

Actualizar `CORS_ORIGIN` en `.env` con la URL de ngrok.

## 🔄 Integración SAP

### Configuración

Editar en `.env`:
```bash
SAP_URL=https://your-sap-server:50000/b1s/v1
SAP_COMPANY=ARTESA_SAS
SAP_USER=api_user
SAP_PASSWORD=your_password
```

### Sincronización Automática

La sincronización con SAP se ejecuta automáticamente a las 8:00 PM (Lun-Vie).

Para ejecutar manualmente:
```bash
curl -X POST http://localhost:3000/api/sync/now \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📊 Logs

Los logs se guardan en `logs/`:

- `combined-YYYY-MM-DD.log` - Todos los logs
- `error-YYYY-MM-DD.log` - Solo errores
- `sap-sync-YYYY-MM-DD.log` - Sincronización SAP

Ver logs en tiempo real:
```bash
# Con Docker
docker-compose logs -f backend

# Sin Docker
tail -f logs/combined-*.log
```

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Con coverage
npm test -- --coverage

# Tests específicos
npm test -- auth.test.js
```

## 🚀 Despliegue a Producción

### Preparación

1. **Actualizar variables de entorno producción:**
```bash
cp .env.example .env.production
# Editar con valores de producción
```

2. **Generar nuevos secretos JWT**

3. **Configurar SSL/TLS** en nginx

4. **Habilitar perfil de producción:**
```bash
docker-compose --profile production up -d
```

### Con Nginx

Nginx ya está configurado como reverse proxy con:
- SSL/TLS
- Rate limiting
- Compresión
- Headers de seguridad
- Cacheo

Certificados SSL en: `nginx/ssl/`

## 📈 Monitoreo

### Health Check

```bash
curl http://localhost:3000/health
```

Respuesta:
```json
{
  "status": "OK",
  "timestamp": "2025-01-XX...",
  "uptime": 1234.56,
  "environment": "development",
  "database": "Connected"
}
```

### Métricas

Ver estadísticas del pool de conexiones:
```bash
curl http://localhost:3000/api/metrics
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

## 📄 Licencia

MIT

## 👤 Autor

**Jonathan Jay Zúñiga Perdomo**
- Email: jaycoach@hotmail.com
- Consultor SAP Business One
- FullStack Developer

## 📞 Soporte

Para soporte técnico:
- Email: jaycoach@hotmail.com
- Issues: GitHub Issues

---

## ⚡ Quick Start

```bash
# Clonar e iniciar
git clone <repo>
cd artesa-backend
cp .env.example .env
# Editar .env
docker-compose up -d

# Verificar
curl http://localhost:3000/health

# Ver docs
open http://localhost:3000/api-docs
```

## 🎯 Roadmap Fase 1 (MVP)

- [x] Estructura base del proyecto
- [x] Base de datos PostgreSQL
- [x] Sistema de autenticación JWT
- [x] Middleware de seguridad
- [ ] Controladores de producción
- [ ] Integración SAP Service Layer
- [ ] Sincronización automática
- [ ] API completa
- [ ] Tests unitarios
- [ ] Documentación Swagger
- [ ] Deploy inicial

**Duración estimada:** 8 semanas
