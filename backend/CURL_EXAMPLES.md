# Ejemplos de Prueba de Endpoints - ARTESA API

Guía con ejemplos de cURL para probar todos los endpoints de la API.

## 🔧 Requisitos

- `curl` instalado
- Base de datos PostgreSQL corriendo
- Servidor backend corriendo en `http://localhost:3000`

## 📋 Tabla de Contenidos

1. [Health Check](#health-check)
2. [Autenticación](#autenticación)
3. [Gestión de Usuarios](#gestión-de-usuarios)
4. [Variables de Referencia](#variables-de-referencia)

---

## Health Check

### Verificar Estado del Servidor

```bash
# Verificar salud general
curl -X GET http://localhost:3000/health

# Con pretty print
curl -X GET http://localhost:3000/health | jq .

# Guardar en archivo
curl -X GET http://localhost:3000/health > health_check.json
```

**Respuesta esperada:**
```json
{
  "status": "OK",
  "timestamp": "2025-01-01T10:30:00.000Z",
  "uptime": 3600,
  "environment": "development",
  "database": "Connected",
  "memory": {
    "used": "125 MB",
    "total": "512 MB"
  }
}
```

### Info General de la API

```bash
curl -X GET http://localhost:3000
```

---

## Autenticación

### 1. Registrar Nuevo Usuario

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@example.com",
    "password": "Secure@Password123",
    "firstName": "Juan",
    "lastName": "Pérez"
  }'
```

**Respuesta exitosa (201):**
```json
{
  "success": true,
  "message": "Usuario registrado exitosamente",
  "data": {
    "id": 1,
    "email": "usuario@example.com",
    "firstName": "Juan",
    "lastName": "Pérez",
    "role": "user"
  }
}
```

### 2. Iniciar Sesión (Login)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@example.com",
    "password": "Secure@Password123"
  }'
```

**Respuesta exitosa (200):**
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

### 3. Obtener Perfil (Autenticado)

```bash
# Guardar token de la respuesta anterior
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Obtener perfil
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Actualizar Perfil

```bash
TOKEN="your_token_here"

curl -X PUT http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Juan",
    "lastName": "Pérez García",
    "phone": "+573001234567"
  }'
```

### 5. Cambiar Contraseña

```bash
TOKEN="your_token_here"

curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "oldPassword": "Secure@Password123",
    "newPassword": "NewSecure@Password456"
  }'
```

### 6. Solicitar Recuperación de Contraseña

```bash
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@example.com"
  }'
```

### 7. Resetear Contraseña

```bash
# Nota: Necesitarás el token enviado al email
RESET_TOKEN="token_from_email"

curl -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "'$RESET_TOKEN'",
    "newPassword": "NewSecure@Password789"
  }'
```

### 8. Verificar Token

```bash
TOKEN="your_token_here"

curl -X GET http://localhost:3000/api/auth/verify \
  -H "Authorization: Bearer $TOKEN"
```

### 9. Refrescar Token

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "your_refresh_token_here"
  }'
```

### 10. Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "your_refresh_token_here"
  }'
```

---

## Gestión de Usuarios

> ⚠️ **Nota**: Requiere token de usuario con rol Admin

### 1. Obtener Estadísticas de Usuarios

```bash
TOKEN="your_admin_token_here"

curl -X GET http://localhost:3000/api/users/stats \
  -H "Authorization: Bearer $TOKEN"
```

### 2. Listar Usuarios

```bash
TOKEN="your_admin_token_here"

# Listar todos los usuarios
curl -X GET http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN"

# Con paginación
curl -X GET "http://localhost:3000/api/users?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Con filtros
curl -X GET "http://localhost:3000/api/users?role=supervisor&isActive=true" \
  -H "Authorization: Bearer $TOKEN"

# Con búsqueda
curl -X GET "http://localhost:3000/api/users?search=Juan" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Obtener Usuario por ID

```bash
TOKEN="your_admin_token_here"
USER_ID=1

curl -X GET http://localhost:3000/api/users/$USER_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Crear Nuevo Usuario

```bash
TOKEN="your_admin_token_here"

curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "Secure@Password123",
    "firstName": "Carlos",
    "lastName": "García",
    "role": "supervisor",
    "phone": "+573001234567"
  }'
```

### 5. Actualizar Usuario

```bash
TOKEN="your_admin_token_here"
USER_ID=2

curl -X PUT http://localhost:3000/api/users/$USER_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Carlos",
    "lastName": "García Martínez",
    "role": "admin",
    "phone": "+573009876543"
  }'
```

### 6. Eliminar Usuario (Soft Delete)

```bash
TOKEN="your_admin_token_here"
USER_ID=2

curl -X DELETE http://localhost:3000/api/users/$USER_ID \
  -H "Authorization: Bearer $TOKEN"
```

### 7. Activar Usuario

```bash
TOKEN="your_admin_token_here"
USER_ID=2

curl -X POST http://localhost:3000/api/users/$USER_ID/activate \
  -H "Authorization: Bearer $TOKEN"
```

### 8. Desactivar Usuario

```bash
TOKEN="your_admin_token_here"
USER_ID=2

curl -X POST http://localhost:3000/api/users/$USER_ID/deactivate \
  -H "Authorization: Bearer $TOKEN"
```

### 9. Resetear Contraseña de Usuario

```bash
TOKEN="your_admin_token_here"
USER_ID=2

curl -X POST http://localhost:3000/api/users/$USER_ID/reset-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newPassword": "NewSecure@Password999"
  }'
```

### 10. Desbloquear Usuario

```bash
TOKEN="your_admin_token_here"
USER_ID=2

curl -X POST http://localhost:3000/api/users/$USER_ID/unlock \
  -H "Authorization: Bearer $TOKEN"
```

### 11. Obtener Actividad de Usuario

```bash
TOKEN="your_admin_token_here"
USER_ID=1

# Obtener actividad con paginación
curl -X GET "http://localhost:3000/api/users/$USER_ID/activity?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Variables de Referencia

### Configuración Recomendada para Scripts

```bash
# Base URL
API_URL="http://localhost:3000"

# Credenciales de prueba
TEST_EMAIL="test@example.com"
TEST_PASSWORD="Secure@Password123"

# Después de login, guardar tokens
ACCESS_TOKEN=""
REFRESH_TOKEN=""

# Función auxiliar para loguear
login() {
  response=$(curl -s -X POST $API_URL/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"$TEST_EMAIL\",
      \"password\": \"$TEST_PASSWORD\"
    }")
  
  ACCESS_TOKEN=$(echo $response | jq -r '.data.accessToken')
  REFRESH_TOKEN=$(echo $response | jq -r '.data.refreshToken')
  
  echo "Login exitoso"
  echo "Access Token: $ACCESS_TOKEN"
}

# Uso
login
echo "Token de acceso: $ACCESS_TOKEN"
```

---

## Flujo Completo de Prueba

```bash
#!/bin/bash

API_URL="http://localhost:3000"

# 1. Registrar usuario
echo "1. Registrando usuario..."
curl -X POST $API_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Secure@Password123",
    "firstName": "Test",
    "lastName": "User"
  }' | jq .

# 2. Loguear
echo -e "\n2. Iniciando sesión..."
TOKEN_RESPONSE=$(curl -s -X POST $API_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Secure@Password123"
  }')

TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.data.accessToken')
echo "Token obtenido: $TOKEN"

# 3. Obtener perfil
echo -e "\n3. Obteniendo perfil..."
curl -X GET $API_URL/api/auth/profile \
  -H "Authorization: Bearer $TOKEN" | jq .

# 4. Health check
echo -e "\n4. Verificando salud del servidor..."
curl -X GET $API_URL/health | jq .

echo -e "\n✅ Prueba completada"
```

---

## Notas Importantes

1. **Requisitos de Contraseña**:
   - Mínimo 8 caracteres
   - Al menos una mayúscula
   - Al menos un número
   - Al menos un carácter especial

2. **Token JWT**:
   - Expires en 24 horas (configurable)
   - Incluir en header: `Authorization: Bearer <token>`
   - Puede refrescarse con el refresh token

3. **Roles**:
   - `admin`: Acceso total
   - `supervisor`: Ver usuarios y estadísticas
   - `user`: Solo su propio perfil

4. **Códigos de Estado HTTP**:
   - `200`: OK
   - `201`: Creado
   - `400`: Bad Request
   - `401`: No autorizado
   - `403`: Acceso denegado
   - `404`: No encontrado
   - `500`: Error del servidor
