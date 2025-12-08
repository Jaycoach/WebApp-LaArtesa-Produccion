# ⚡ INSTALACIÓN RÁPIDA - BACKEND ARTESA

## 📦 Archivos Incluidos

Tienes dos opciones para descargar:

1. **Carpeta completa**: `artesa-backend/` 
2. **Archivo comprimido**: `artesa-backend.tar.gz` (30KB)

## 🚀 INICIO EN 5 MINUTOS

### Prerrequisitos
- Docker Desktop instalado
- Git (opcional)
- Editor de código (VS Code recomendado)

### Paso 1: Extraer el proyecto

Si descargaste el .tar.gz:
```bash
tar -xzf artesa-backend.tar.gz
cd artesa-backend
```

Si descargaste la carpeta:
```bash
cd artesa-backend
```

### Paso 2: Configurar variables de entorno

```bash
# Copiar el ejemplo
cp .env.example .env

# Editar con tu editor favorito
code .env
# o
nano .env
# o
vim .env
```

**IMPORTANTE**: Debes cambiar estos valores:

```env
# JWT Secrets - OBLIGATORIO CAMBIAR
JWT_SECRET=GENERAR_NUEVO_SECRET_AQUI
JWT_REFRESH_SECRET=GENERAR_OTRO_SECRET_AQUI

# Base de datos (puedes dejar los defaults para desarrollo)
DB_PASSWORD=artesa_secure_password_2025

# SAP (cuando tengas las credenciales)
SAP_URL=https://tu-servidor-sap:50000/b1s/v1
SAP_COMPANY=ARTESA_SAS
SAP_USER=tu_usuario_sap
SAP_PASSWORD=tu_password_sap
```

### Paso 3: Generar secretos JWT seguros

Ejecuta este comando DOS veces y copia cada resultado:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Primera ejecución → copia en `JWT_SECRET`
Segunda ejecución → copia en `JWT_REFRESH_SECRET`

### Paso 4: Iniciar con Docker

```bash
# Iniciar todos los servicios
docker-compose up -d

# Ver si está corriendo
docker-compose ps

# Ver logs en tiempo real
docker-compose logs -f backend
```

### Paso 5: Verificar que funciona

```bash
# Health check
curl http://localhost:3000/health

# Deberías ver algo como:
# {
#   "status": "OK",
#   "timestamp": "2025-01-...",
#   "uptime": 123.45,
#   "environment": "development",
#   "database": "Connected"
# }
```

¡Listo! Tu backend está corriendo en **http://localhost:3000**

## 📖 Siguientes Pasos

### 1. Verificar la base de datos

```bash
# Conectarse a PostgreSQL
docker-compose exec postgres psql -U artesa_user -d artesa_db

# Ver las tablas
\dt

# Deberías ver las 10 tablas creadas
# Salir con: \q
```

### 2. Probar usuario admin

El sistema viene con un usuario admin precreado:

```
Username: admin
Email: admin@artesa.com
Password: Admin123!@#
```

**⚠️ CAMBIAR EN PRODUCCIÓN**

### 3. Ver documentación completa

Abre estos archivos en tu editor:

- `README.md` - Documentación completa
- `PROXIMOS_PASOS.md` - Qué hacer ahora
- `RESUMEN_IMPLEMENTACION.md` - Qué está hecho

### 4. Continuar desarrollo

Ver `PROXIMOS_PASOS.md` para el roadmap detallado.

Los próximos archivos a crear son:
- `src/routes/index.js`
- `src/controllers/auth.controller.js`
- `src/services/auth.service.js`

## 🛠️ Comandos Útiles

```bash
# Ver logs
docker-compose logs -f backend

# Reiniciar backend
docker-compose restart backend

# Detener todo
docker-compose down

# Detener y borrar datos (CUIDADO)
docker-compose down -v

# Reconstruir tras cambios
docker-compose up -d --build

# Ejecutar comando en el contenedor
docker-compose exec backend npm run <comando>

# Acceder a la base de datos
docker-compose exec postgres psql -U artesa_user -d artesa_db

# Ver uso de recursos
docker stats
```

## 🐛 Troubleshooting

### Error: "Port 3000 already in use"

Cambiar el puerto en `.env`:
```env
PORT=3001
```

O detener el proceso que usa el puerto 3000:
```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Error: "Cannot connect to database"

Verificar que PostgreSQL esté corriendo:
```bash
docker-compose ps postgres
docker-compose logs postgres
```

Reiniciar servicios:
```bash
docker-compose down
docker-compose up -d
```

### Error: "Permission denied"

En Linux, puede ser necesario usar sudo:
```bash
sudo docker-compose up -d
```

O agregar tu usuario al grupo docker:
```bash
sudo usermod -aG docker $USER
# Cerrar sesión y volver a entrar
```

### Ver todos los logs

```bash
docker-compose logs -f
```

## 📁 Estructura del Proyecto

```
artesa-backend/
├── README.md                    ← Lee esto primero
├── PROXIMOS_PASOS.md            ← Qué hacer ahora
├── RESUMEN_IMPLEMENTACION.md    ← Qué está hecho
├── docker-compose.yml           ← Configuración Docker
├── Dockerfile                   ← Imagen Docker
├── package.json                 ← Dependencias Node
├── .env.example                 ← Variables de entorno
├── .gitignore                   ← Git ignore
│
├── database/
│   └── init/
│       ├── 01-init.sql          ← Tablas
│       └── 02-seed.sql          ← Datos iniciales
│
├── nginx/
│   └── nginx.conf               ← Configuración Nginx
│
├── src/
│   ├── server.js                ← Servidor principal
│   ├── config/
│   │   └── index.js             ← Configuración
│   ├── database/
│   │   └── connection.js        ← Conexión PostgreSQL
│   ├── middleware/
│   │   ├── auth.js              ← Autenticación JWT
│   │   ├── errorHandler.js     ← Manejo de errores
│   │   ├── notFound.js          ← 404 handler
│   │   ├── rateLimiter.js       ← Rate limiting
│   │   └── requestLogger.js     ← Logging requests
│   └── utils/
│       └── logger.js            ← Sistema de logs
│
└── logs/                        ← Se crea automático
```

## 🎯 Para Producción

Antes de deploy a producción:

1. ✅ Cambiar usuario admin default
2. ✅ Generar nuevos secretos JWT
3. ✅ Configurar SSL en Nginx
4. ✅ Usar contraseñas fuertes en BD
5. ✅ Configurar backup automático
6. ✅ Configurar monitoring
7. ✅ Revisar logs regularmente
8. ✅ Habilitar rate limiting
9. ✅ Configurar firewall
10. ✅ Usar HTTPS

## 📞 ¿Necesitas Ayuda?

1. Lee `README.md`
2. Lee `PROXIMOS_PASOS.md`
3. Revisa los logs: `docker-compose logs -f`
4. Verifica health: `curl http://localhost:3000/health`

---

## ✨ Resumen

```bash
# Setup completo en 4 comandos
cp .env.example .env
# Editar .env con tus datos
docker-compose up -d
curl http://localhost:3000/health
```

¡Tu backend de ARTESA está listo! 🚀
