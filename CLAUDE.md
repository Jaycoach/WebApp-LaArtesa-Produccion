## Definition of Done — obligatorio para toda tarea/feature

Ninguna tarea se reporta como "completa" o "implementada" sin pasar por estos tres estados, cada uno con su propia palabra exacta en el reporte final:

1. **IMPLEMENTADO** — el código está escrito, compila/lintea limpio (`node --check`, `tsc --noEmit`). Esto NO es "listo" ni "completado".

2. **VALIDADO EN STAGING** — se ejecutó un script de aceptación real contra staging (no lectura de código, no inferencia — evidencia real: filas de SQL antes/después, respuestas HTTP, logs). Solo se llega aquí si el script terminó con exit 0.

3. **APROBADO PARA PRODUCCIÓN** — Jonathan dio el visto bueno explícito. ClaudeCode nunca se auto-otorga este estado ni ejecuta contra producción sin esa aprobación (ver regla existente de "production approval state").

### Antes de escribir código

Para cualquier tarea nueva (feature, fix, refactor), antes de tocar código: escribir un script de aceptación en `scripts/tests/` que defina qué significa "funciona" con comandos ejecutables (curl, psql, diffs de estado antes/después). Ese script ES el criterio de éxito — no una descripción en prosa.

### Después de escribir código

1. Correr el script. Si falla: leer el error, corregir, volver a correr. Repetir hasta exit 0 — sin pedir permiso para cada intento intermedio.

2. Si el script requiere acceso que ClaudeCode no tiene (SSH a staging, credenciales, servicios externos): decirlo explícitamente y quedarse en estado IMPLEMENTADO — nunca reportar VALIDADO sin haber corrido el script tú mismo con tus propias manos/herramientas.

3. El reporte final SIEMPRE incluye la salida completa del script como evidencia pegada, no un resumen de que "se probó".

### Prohibido

- Reportar una tarea como terminada, lista, o funcionando basándose solo en que el código "se ve correcto" o en lectura estática.

- Usar palabras como "implementado" y "completo" como sinónimos en el mismo reporte — son estados distintos y deben aparecer por separado.

- Mezclar cambios de negocio (NEGOCIO, ej. errores de stock) con cambios de infraestructura (CONEXION, ej. desconexión) sin clasificarlos explícitamente si la tarea lo requiere.

## Manejo de credenciales y contraseñas en scripts — obligatorio

Ningún script, test, migración o archivo versionado en git puede contener
una contraseña real (reportada por un usuario, vista en un log de
producción, o de una cuenta real de Artesa) ni una credencial real
(tokens, claves de API, connection strings) en texto plano — sin
excepción, ni siquiera "solo para reproducir un bug puntual".

### Reglas concretas
1. **Contraseñas de prueba se generan en runtime**, nunca como literal
   hardcodeado en el archivo (ej. `openssl rand -base64 12`, o
   equivalente). Esto aplica también a contraseñas "inventadas" que no
   son reales — el hábito correcto es generar, no escribir.
2. **Los tests de validación de contraseña se escriben contra la regla
   real, no contra un ejemplo puntual.** Si el objetivo es probar "la
   validación acepta caracteres especiales" o "rechaza contraseñas
   cortas", el script debe leer o replicar la regex/reglas reales del
   validador (`auth.validator.js` o donde viva) y generar casos que
   cumplan/incumplan esas reglas de forma programática — no comparar
   contra un string específico que alguien reportó estar usando. Un test
   que depende de que "Empaque123*" siga siendo válida es un test frágil
   además de un riesgo de filtración; un test que verifica "toda
   contraseña que cumple mayúscula+minúscula+dígito+especial es aceptada"
   prueba lo mismo sin el riesgo.
3. **Nunca reproducir en un script una contraseña real reportada por un
   usuario o vista en logs/incidentes**, ni siquiera como caso de
   regresión. Generar un valor sintético con las mismas propiedades
   estructurales.
4. **Salida de scripts que pueda contener valores sensibles se enmascara
   antes de loguearse o mostrarse** (ej. no hacer `echo` del body crudo
   de un request que incluya `newPassword`/`currentPassword` — extraer
   solo los campos relevantes para el assert).
5. Antes de reportar VALIDADO EN STAGING en cualquier tarea que toque
   autenticación/contraseñas: correr un grep de sanidad sobre los
   archivos tocados buscando patrones sospechosos de contraseña/credencial
   literal, y confirmar en el reporte que se corrió, no asumirlo.

### Si se detecta una violación de esto en un commit ya hecho
Reportarlo explícitamente a Jonathan en el resumen final, incluso si no
es parte del alcance de la tarea actual — no corregirlo en silencio ni
ignorarlo.

## Objetos de base de datos compartidos (triggers, funciones, vistas) — obligatorio

Antes de calificar un bug en un trigger/función/vista compartida como
"fuera de alcance" o "no relacionado", se debe listar TODOS los puntos
de llamada reales (grep en el backend completo, no solo el endpoint que
reportó el síntoma original) y confirmar, uno por uno, si cada uno
también está afectado. Un trigger sobre una tabla compartida
(ej. usuarios_sesiones) casi nunca tiene un solo llamador — la primera
lectura del alcance suele quedarse corta. Reportar la lista completa de
puntos de llamada como parte de VALIDADO EN STAGING, incluso los que
resultaron no afectados.Me refiero a Skill de ClaudeCode, quiero que la metodología de desarrollo sea uy confiable y refinada

### Deploy: shell no interactivo pierde el PATH de nvm

`deploy.sh` puede fallar en shells no interactivos (ej. cuando ClaudeCode
ejecuta el script directo por SSH) porque nvm no carga node/npm en ese
contexto — el PATH del shell no interactivo no incluye lo que nvm
inyecta normalmente en un shell de login.

**Síntoma:** `deploy.sh` falla en el paso de npm/build con `command not
found: npm` o similar, pese a que `npm` funciona perfecto en una sesión
SSH manual normal.

**Fix:** correr el script con shell de login explícito:

\`\`\`bash
ssh artesa-staging "bash -l -c '~/LaArtesa/deployment/deploy.sh staging'"
# análogo para producción:
ssh artesa-prod "bash -l -c '~/LaArtesa/deployment/deploy.sh prod'"
\`\`\`

o, si ya estás en una sesión SSH abierta, asegurate de que sea `bash -l`
(login shell) y no `bash` a secas, antes de invocar `deploy.sh`.