# Guía de Uso de Swagger UI - ARTESA API

## 📚 Acceso a la Documentación

La documentación interactiva de la API está disponible en:
```
http://localhost:3000/api-docs
```

## 🚀 Cómo Probar los Endpoints

### 1. **Health Check**
Verifica que el servidor está funcionando:
- **Endpoint**: `GET /health`
- **Descripción**: Retorna el estado del servidor y la base de datos
- **Acceso**: Público (sin autenticación)

### 2. **Autenticación (Authentication)**

#### Register - Crear Nuevo Usuario
```
POST /api/auth/register
```
**Body JSON:**
```json
{
  "email": "usuario@example.com",
  "password": "Secure@Password123",
  "firstName": "Juan",
  "lastName": "Pérez"
}
```

#### Login - Iniciar Sesión
```
POST /api/auth/login
```
**Body JSON:**
```json
{
  "email": "usuario@example.com",
  "password": "Secure@Password123"
}
```
**Respuesta:**
```json
{
  "success": true,
  "message": "Login exitoso",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "usuario@example.com",
      "firstName": "Juan",
      "role": "user"
    }
  }
}
```

#### Obtener Perfil (Autenticado)
```
GET /api/auth/profile
```
**Header requerido:**
```
Authorization: Bearer <accessToken>
```

### 3. **Usuarios (Users) - Requiere Autenticación**

> ⚠️ **Nota**: Todos los endpoints de usuarios requieren un token JWT válido

#### Listar Usuarios
```
GET /api/users
```
**Parámetros query opcionales:**
- `page` (default: 1) - Número de página
- `limit` (default: 10) - Registros por página
- `search` - Buscar por nombre o email
- `role` - Filtrar por rol (admin, supervisor, user)
- `isActive` - Filtrar por estado (true/false)

**Header:**
```
Authorization: Bearer <accessToken>
```

#### Crear Usuario (Admin)
```
POST /api/users
```
**Body JSON:**
```json
{
  "email": "newuser@example.com",
  "password": "Secure@Password123",
  "firstName": "Carlos",
  "lastName": "García",
  "role": "supervisor",
  "phone": "+573001234567"
}
```

#### Actualizar Usuario (Admin)
```
PUT /api/users/{id}
```

#### Eliminar Usuario (Admin)
```
DELETE /api/users/{id}
```

#### Activar/Desactivar Usuario (Admin)
```
POST /api/users/{id}/activate
POST /api/users/{id}/deactivate
```

#### Resetear Contraseña de Usuario (Admin)
```
POST /api/users/{id}/reset-password
```
**Body JSON:**
```json
{
  "newPassword": "NewSecure@Password123"
}
}
```

## 🔐 Cómo Usar Tokens JWT en Swagger

### Paso 1: Obtener Token
1. Ve a `POST /api/auth/login`
2. Haz click en "Try it out"
3. Ingresa tus credenciales
4. Haz click en "Execute"
5. Copia el `accessToken` de la respuesta

### Paso 2: Configurar Autorización
1. En la esquina superior derecha de Swagger UI, haz click en el botón "Authorize" 🔒
2. Pega el token en el campo: `Bearer <tu_token_aquí>`
3. Haz click en "Authorize"
4. Ya puedes probar los endpoints autenticados

### Paso 3: Usar Token para Endpoints Autenticados
- Todos los endpoints que requieren autenticación mostrarán un candado 🔒
- Una vez que has hecho "Authorize", el token se añade automáticamente a las peticiones

## 📋 Roles y Permisos

| Rol | Descripción | Permisos |
|-----|------------|----------|
| **admin** | Administrador del sistema | Acceso total a todos los endpoints |
| **supervisor** | Supervisor de producción | Ver usuarios y estadísticas |
| **user** | Usuario regular | Solo ver su propio perfil |

## 🧪 Requisitos de Contraseña

Las contraseñas deben cumplir con:
- ✅ Mínimo 8 caracteres
- ✅ Al menos una mayúscula
- ✅ Al menos un número
- ✅ Al menos un carácter especial (@, #, $, %, etc.)

**Ejemplo válido:** `Secure@Password123`

## 🔄 Refrescar Token

Si tu `accessToken` expira (24 horas):

```
POST /api/auth/refresh
```
**Body JSON:**
```json
{
  "refreshToken": "<tu_refresh_token>"
}
```

## 📊 Endpoints Disponibles Resumen

### Health & Info
- `GET /` - Info de la API
- `GET /health` - Estado del servidor

### Authentication (Público)
- `POST /api/auth/register` - Registrar
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/refresh` - Refrescar token
- `POST /api/auth/logout` - Cerrar sesión
- `POST /api/auth/forgot-password` - Recuperar contraseña
- `POST /api/auth/reset-password` - Resetear contraseña

### Authentication (Privado)
- `GET /api/auth/profile` - Obtener perfil
- `PUT /api/auth/profile` - Actualizar perfil
- `POST /api/auth/change-password` - Cambiar contraseña
- `GET /api/auth/verify` - Verificar token

### Users (Privado - Admin/Supervisor)
- `GET /api/users` - Listar usuarios
- `GET /api/users/{id}` - Obtener usuario
- `POST /api/users` - Crear usuario (Admin)
- `PUT /api/users/{id}` - Actualizar usuario (Admin)
- `DELETE /api/users/{id}` - Eliminar usuario (Admin)
- `POST /api/users/{id}/activate` - Activar usuario (Admin)
- `POST /api/users/{id}/deactivate` - Desactivar usuario (Admin)
- `POST /api/users/{id}/reset-password` - Resetear contraseña (Admin)
- `POST /api/users/{id}/unlock` - Desbloquear usuario (Admin)
- `GET /api/users/{id}/activity` - Ver actividad del usuario
- `GET /api/users/stats` - Estadísticas de usuarios

## 💡 Tips Útiles

1. **Try It Out**: Cada endpoint tiene un botón "Try it out" para probar directamente
2. **Modelos**: En la sección "Schemas" puedes ver todas las estructuras de datos
3. **Ejemplos**: Cada request/response muestra ejemplos reales
4. **Persistence**: El token se guarda durante tu sesión en Swagger

## 🆘 Solución de Problemas

### Error 401 - No autorizado
- Verifica que el token es válido
- Haz click en "Authorize" y pega el token nuevamente
- Comprueba que el token no ha expirado

### Error 403 - Acceso denegado
- Verifica tu rol de usuario
- Algunos endpoints requieren rol Admin o Supervisor

### Error 400 - Bad Request
- Revisa que los datos cumplan con los requisitos
- Las contraseñas deben tener mayúsculas, números y caracteres especiales

## 🔗 Relacionados

- [README.md](./README.md) - Información general del proyecto
- [package.json](./package.json) - Dependencias del proyecto
