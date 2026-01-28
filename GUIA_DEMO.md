# GUÍA RÁPIDA - DEMO SISTEMA LA ARTESA

**Fecha:** 28 de Enero de 2026
**Usuario:** admin / Admin123!@#

---

## 1. INICIAR BACKEND Y FRONTEND

### Backend:
```bash
cd backend
npm run dev
```
El backend debe correr en: **http://localhost:3000**

### Frontend:
```bash
cd frontend
npm run dev
```
El frontend debe correr en: **http://localhost:5173**

---

## 2. LOGIN

Usuario: **admin**
Password: **Admin123!@#**

---

## 3. DATOS DE DEMO ACTUALES

Ya hay **3 masas** cargadas en la base de datos:

### Masa 1: MASA-20260128-GOLD (Hamburguesa Gold)
- Estado: EN_PROCESO
- Fase actual: AMASADO
- ✅ PESAJE completado al 100%
- 🔄 AMASADO en progreso al 60%
- 🔒 DIVISIÓN y demás fases bloqueadas

### Masa 2: MASA-20260128-ARABE (Pan Árabe)
- Estado: EN_PROCESO
- Fase actual: PESAJE
- 🔄 PESAJE en progreso al 40%
- 🔒 Demás fases bloqueadas

### Masa 3: MASA-20260128-CROIS (Croissant Francés)
- Estado: PLANIFICACION
- Fase actual: PESAJE
- 🔒 Todas las fases bloqueadas

---

## 4. ENDPOINTS PRINCIPALES API

**Base URL:** http://localhost:3000/api

### Autenticación:
```
POST /api/auth/login
Body: { "username": "admin", "password": "Admin123!@#" }
```

### Masas:
```
GET /api/masas?fecha=2026-01-28         # Listar masas por fecha
GET /api/masas/:id                      # Detalle de una masa
GET /api/masas/:id/productos            # Productos de una masa
GET /api/masas/:id/composicion          # Ingredientes de una masa
```

### Pesaje (Masa 2 - ARABE):
```
GET /api/pesaje/2/checklist             # Ver checklist de ingredientes
PATCH /api/pesaje/2/ingredientes/:id    # Actualizar ingrediente
  Body: {
    "disponible": true,
    "verificado": true,
    "pesado": true,
    "peso_real": 68300,
    "lote": "LT-2026-100",
    "fecha_vencimiento": "2026-04-28"
  }
POST /api/pesaje/2/confirmar            # Confirmar pesaje completo
```

### Fases (General):
```
GET /api/fases/:masaId                  # Ver progreso de todas las fases

PUT /api/fases/:masaId/progreso         # Actualizar fase
  Body: {
    "fase": "AMASADO",
    "accion": "completar",
    "datos": {
      "temperatura_masa_final": 26.5,
      "observaciones": "Amasado correcto"
    }
  }

PUT /api/fases/:masaId/:fase/completar  # Completar fase específica
```

### Formado:
```
GET /api/formado/:masaId                # Info de formado
POST /api/formado/:masaId/iniciar       # Iniciar formado
POST /api/formado/:masaId/completar     # Completar formado
```

### Fermentación:
```
GET /api/fermentacion/:masaId
POST /api/fermentacion/:masaId/camara/entrada
POST /api/fermentacion/:masaId/camara/salida
POST /api/fermentacion/:masaId/frio/entrada
POST /api/fermentacion/:masaId/frio/salida
```

### Horneado:
```
GET /api/horneado/hornos                # Catálogo de hornos
GET /api/horneado/programas             # Programas de horneado
GET /api/horneado/:masaId
POST /api/horneado/:masaId/iniciar
POST /api/horneado/:masaId/completar
```

### Sincronización DEMO (sin SAP):
```
POST /api/sap/sincronizar-demo
  Body: { "fecha": "2026-01-28" }
```

---

## 5. FLUJO DE DEMO - MASA 2 (PAN ÁRABE)

### Paso 1: Ver la masa
```
GET /api/masas/2
```

### Paso 2: Iniciar PESAJE
```
GET /api/pesaje/2/checklist
```

Verás 5 ingredientes. Necesitas marcar cada uno como disponible, verificado y pesado.

### Paso 3: Completar ingredientes (uno por uno)
```
PATCH /api/pesaje/2/ingredientes/8      # Harina
PATCH /api/pesaje/2/ingredientes/9      # Agua
PATCH /api/pesaje/2/ingredientes/10     # Sal
PATCH /api/pesaje/2/ingredientes/11     # Levadura
PATCH /api/pesaje/2/ingredientes/12     # Aceite
```

Body de cada request:
```json
{
  "disponible": true,
  "verificado": true,
  "pesado": true,
  "peso_real": [peso aproximado en gramos],
  "lote": "LT-2026-XXX",
  "fecha_vencimiento": "2026-04-28"
}
```

### Paso 4: Confirmar pesaje
```
POST /api/pesaje/2/confirmar
```

Esto marcará PESAJE como COMPLETADA y desbloqueará AMASADO.

### Paso 5: Completar AMASADO
```
PUT /api/fases/2/AMASADO/completar
Body: {
  "temperatura_masa_final": 26.0,
  "velocidad_1_minutos": 8,
  "velocidad_2_minutos": 12,
  "temperatura_agua": 18.0,
  "amasadora_id": 1
}
```

### Paso 6: Completar DIVISIÓN
```
PUT /api/fases/2/DIVISION/completar
Body: {
  "maquina_corte_id": 1,
  "temperatura_entrada": 25.0,
  "requiere_reposo": false,
  "cantidad_divisiones": 105
}
```

### Paso 7: FORMADO (si aplica)
Pan Árabe NO requiere formado, por lo que esta fase se saltará automáticamente.

### Paso 8: FERMENTACIÓN
```
POST /api/fermentacion/2/camara/entrada
Body: {
  "temperatura_camara": 32.0,
  "humedad_camara": 75.0
}

# Esperar unos segundos (simular tiempo)

POST /api/fermentacion/2/camara/salida
Body: {
  "observaciones": "Fermentación correcta"
}
```

### Paso 9: HORNEADO
```
POST /api/horneado/2/iniciar
Body: {
  "tipo_horno_id": 1,
  "programa_horneo_id": 8,
  "temperatura_inicial_real": 230.0,
  "uso_damper_real": true
}

# Simular horneado...

POST /api/horneado/2/completar
Body: {
  "calidad_color": "PERFECTO",
  "calidad_coccion": "PERFECTO",
  "observaciones": "Horneado exitoso"
}
```

---

## 6. CREAR NUEVA MASA DE DEMO (SIN SAP)

Si necesitas crear nuevas masas sin conexión SAP:

```
POST /api/sap/sincronizar-demo
Body: {
  "fecha": "2026-01-28"
}
```

Esto creará masas simuladas listas para comenzar desde PESAJE.

---

## 7. VERIFICAR DATOS

### Ver todas las masas:
```
GET /api/masas?fecha=2026-01-28
```

### Ver progreso de fases:
```
GET /api/fases/2
```

---

## 8. TIPS PARA LA DEMO

1. **Usa Postman o Thunder Client** para hacer las peticiones REST
2. **Guarda el token JWT** que recibes al hacer login
3. **Incluye el token en todas las peticiones** como header:
   ```
   Authorization: Bearer [tu_token_aqui]
   ```
4. **Sigue el orden de las fases**: PESAJE → AMASADO → DIVISION → FORMADO → FERMENTACION → HORNEADO
5. **Cada fase debe completarse** antes de que la siguiente se desbloquee
6. **Los IDs de ingredientes** puedes verlos con `GET /api/pesaje/:masaId/checklist`

---

## 9. PROBLEMAS COMUNES

### Error 401 Unauthorized
- Revisa que el token JWT esté incluido en el header
- Verifica que el token no haya expirado (24 horas)

### Fase bloqueada
- Asegúrate de completar la fase anterior primero
- Verifica el estado con `GET /api/fases/:masaId`

### Backend no responde
- Verifica que el backend esté corriendo en puerto 3000
- Revisa los logs del backend en la consola

---

## 10. RESUMEN DE CREDENCIALES

**Base de Datos:**
- Host: localhost:5432
- Database: PRODUCCION_ARTESA_WEBAPP
- User: admin
- Password: 4dm1n*

**Usuario Sistema:**
- Username: admin
- Password: Admin123!@#
- Rol: ADMIN

**Endpoints Base:**
- Backend API: http://localhost:3000/api
- Frontend: http://localhost:5173

---

¡Listo para la DEMO! 🚀
