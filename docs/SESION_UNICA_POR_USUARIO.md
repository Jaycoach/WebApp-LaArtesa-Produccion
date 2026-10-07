# Sesión única por usuario

**Estado: SIEMPRE ACTIVA.** No hay bandera que la apague por defecto. Cuando un usuario inicia sesión
en otro dispositivo o navegador se cierran todas sus demás sesiones, y las cerradas quedan fuera **de
inmediato** (no cuando venza su token).

## Cómo funciona

| Pieza | Comportamiento |
|---|---|
| `POST /auth/login` | Una transacción: `SELECT id FROM usuarios WHERE id=$1 FOR UPDATE`, revoca todas las demás sesiones vigentes del usuario, inserta la nueva (`RETURNING id`) y firma el access token con el claim `sid` = id de esa fila. Dos logins simultáneos se serializan y dejan exactamente **una** sesión viva. Si algo falla: `ROLLBACK` y la sesión previa sigue viva. |
| `POST /auth/refresh` | Rota una sesión por otra (inserta la nueva y revoca la presentada, en una transacción). **No** revoca las demás sesiones. El access nuevo trae el `sid` de la fila nueva. |
| `verifyToken` (middleware) | Comprueba el `sid` dentro de la misma consulta de usuario (subconsulta por PK de `usuarios_sesiones`). Sesión inexistente, de otro usuario o revocada → `401` con `code: 'SESSION_REPLACED'`. |
| Access token **sin** `sid` | `401 SESSION_REPLACED`. Ya no valen los tokens emitidos antes de esta versión: **no existe ventana de 24 h**; todos inician sesión una vez tras el despliegue. |
| Cambio de contraseña | Revoca las demás sesiones (la actual se conserva si el cliente envía su `refreshToken`): los access tokens de las otras estaciones caen al instante. |
| Auditoría | `SESION_REEMPLAZADA` en `auditoria_cambios` solo si se cerró al menos una sesión: cantidad, IP y navegador de las desplazadas (hasta 20 detalladas) y del nuevo login. Sin tokens ni hashes. |
| Frontend | Ante `401 SESSION_REPLACED` no intenta renovar: limpia la sesión, redirige a `/login` y muestra una sola vez *"Tu sesión se cerró porque iniciaste sesión en otro dispositivo o navegador"* (flag en `sessionStorage`, lo lee y borra la pantalla de login). |

**Excepción acotada:** la verificación de correo emite un token corto (15 min) sin sesión, con
`scp: 'set-password'`; el middleware lo acepta sin `sid` **solo** en `POST /auth/set-initial-password`
(alta de usuarios nuevos). En cualquier otra ruta se rechaza como `SESSION_REPLACED`.

Rutas que **no** dependen del `sid`: `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/register`,
`/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/request-verification`,
`/api/version` (polling del frontend) y `/health`: no pasan por `verifyToken`.

## Interruptor de emergencia

`config.security.singleSessionPerUser` (variable `SINGLE_SESSION_PER_USER`):

* **Sin la variable definida → ACTIVA** (sesión única). Es el valor normal.
* Solo un `false` explícito (sin distinguir mayúsculas ni espacios) la desactiva. Cualquier otro valor
  (`0`, `no`, `off`, vacío…) la deja activa.
* Desactivada, el login **no** revoca las demás sesiones ni audita `SESION_REEMPLAZADA`. El `sid`, el
  rechazo de tokens sin `sid` y la rotación de `/auth/refresh` siguen igual.
* Permite revertir **sin redeploy**. No hace falta tocar ningún `.env`.

### Usarlo con PM2 (trampa del entorno)

**PM2 fusiona, no reemplaza.** `pm2 restart --update-env` mezcla el entorno del shell con el que PM2 ya
tiene guardado para el proceso: una variable que se definió una vez **no desaparece** aunque la quites del
shell y reinicies (verificado en staging con `scripts/tests/test_sesion_unica.sh`). Por eso `unset` + `restart`
**no** sirve para volver al valor por defecto. Siempre en una sesión SSH nueva:

```bash
# 1) Desactivar (emergencia): la variable solo para este comando
ssh artesa-prod "bash -l -c 'source ~/.nvm/nvm.sh; SINGLE_SESSION_PER_USER=false pm2 restart artesa-backend-prod --update-env'"

# 2a) Reactivar YA (rápido, sin recrear el proceso): dejarla explícita en true (equivale al valor por defecto)
ssh artesa-prod "bash -l -c 'source ~/.nvm/nvm.sh; SINGLE_SESSION_PER_USER=true pm2 restart artesa-backend-prod --update-env'"

# 2b) Volver al estado "variable NO definida": recrear el proceso desde el ecosistema, con el entorno limpio
#     (el ecosistema solo define NODE_ENV y PORT; lo demás lo lee la app de backend/.env)
ssh artesa-prod "bash -l -c 'source ~/.nvm/nvm.sh; unset SINGLE_SESSION_PER_USER; cd ~/LaArtesa/backend && pm2 delete artesa-backend-prod; pm2 start ecosystem.config.js --only artesa-backend-prod; pm2 save'"

# 3) Confirmar (solo NOMBRES de variables, nunca valores):
ssh artesa-prod "bash -l -c 'source ~/.nvm/nvm.sh; pm2 jlist' | node -e \"let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const p=JSON.parse(t.slice(t.indexOf('['))).find(x=>x.name==='artesa-backend-prod');console.log(Object.keys(p.pm2_env).filter(k=>/^SINGLE_SESSION/.test(k)).join(',')||'(ninguna)')})\""
```

Para staging el proceso se llama `artesa-backend-staging`. `scripts/tests/test_sesion_unica.sh` ejercita
este ciclo (desactivar → comprobar → recrear el proceso con el entorno limpio → comprobar) y lo deja restaurado.

## Despliegue

* Tras el deploy **todos** los usuarios (incluidas las cuentas compartidas: Lider1, Lider2, pesaje,
  supervisor, liderempaque1, con 8 a 36 sesiones vivas cada una) deben iniciar sesión una vez: sus access
  tokens sin `sid` devuelven `401 SESSION_REPLACED` y el frontend los manda a `/login` con el aviso.
* Los refresh tokens anteriores siguen existiendo en BD; el frontend no los usa ante `SESSION_REPLACED`,
  y el primer login de cada usuario los revoca todos. Si se prefiere limpiarlos de golpe al desplegar
  (opcional, **NO ejecutado**):

```sql
-- Revoca todas las sesiones vigentes (cada usuario vuelve a iniciar sesión una vez). Solo con aprobación de Jonathan.
SELECT count(*) AS vigentes FROM usuarios_sesiones WHERE revocado = false;   -- primero, mirar
UPDATE usuarios_sesiones SET revocado = true WHERE revocado = false;
```

  (El trigger `audit_session_changes()` escribe una fila en `auditoria` por cada sesión revocada.)
* Las cuentas compartidas dejan de funcionar a la vez: un segundo operario que entre con el mismo usuario
  cierra la sesión del primero. Cada persona debe usar su propio usuario.

## Sin migraciones

No se agregan columnas ni tablas: `sid` es el `id` existente de `usuarios_sesiones`.
