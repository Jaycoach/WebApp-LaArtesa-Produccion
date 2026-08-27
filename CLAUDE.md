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
