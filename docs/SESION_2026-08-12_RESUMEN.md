# Resumen de sesión — 12 de agosto de 2026

Contexto para retomar el trabajo en una sesión nueva. Cubre Fases 1 a 5,
todas ya en `origin/main` (commit final: `eb63569`).

**Importante**: el historial de git se reescribió por completo el
12-ago-2026 (purgado de secretos, ver sección 2). Todos los hashes de
commit de este documento son los NUEVOS, posteriores al purgado — si ves
referencias a hashes viejos (`b667af4`, `22458f2`, etc.) en conversaciones
o notas anteriores a esta reescritura, ya no existen.

## 1. Metodología no negociable de este proyecto

Establecida y seguida estrictamente durante toda la sesión:

- **`grep`/`cat`/`psql` del estado real antes de proponer cualquier cambio.**
  Nunca asumir que un "diseño confirmado" en una ronda anterior sigue
  siendo válido sin re-verificarlo contra el código/datos reales. Varias
  veces en esta sesión una premisa que parecía cerrada resultó
  incorrecta al verificarla (ej. `clasificarClaveAgrupacion` no estaba
  conectada a ningún flujo real; `productos_por_masa.requiere_formado`
  existía como columna pero nunca se poblaba).
- **Whitelist estricta por fase.** Cada fase define explícitamente qué
  archivos se pueden tocar. Ampliar la whitelist requiere pedido
  explícito del usuario, acotado a un bloque/línea específica — nunca se
  asume ni se amplía por iniciativa propia. Pasó varias veces por fase
  (Fase 4: `masas.controller.js`, luego `sap.controller.js` acotado a
  líneas 945-1053; Fase 5: `sap.service.js` acotado a una línea,
  `fases.model.js` acotado a líneas 609-679).
- **Un commit por pieza lógica**, nunca todo junto. Cortes usados: migración
  aparte, backend aparte, frontend aparte (a veces backend se subdividió
  más, ej. Fase 4: migración / lógica pura / puntos de enganche).
- **Mostrar el diff completo antes de escribir en disco**, esperar
  confirmación explícita. Después de escribir, mostrar el resultado real
  del archivo y esperar otra confirmación antes de `git commit`. Después
  del commit, esperar confirmación antes de `git push`.
- **Staging antes que producción.** Las migraciones se corren contra
  staging (túnel SSH a `localhost:5433`) y se verifican con el propio
  `SELECT` de verificación de la migración antes de comitear. El deploy
  real (staging y producción) lo hace el usuario manualmente — nunca se
  ejecuta desde esta sesión.
- **Nunca tocar lo que ya funciona.** Piezas explícitamente protegidas
  durante la sesión: consolidación de OVs (B1, ver sección 3), patrón
  `esDecoracion` en `getItemsUoM` (plantilla de estilo a replicar, no
  modificar), manejo de repeticiones SAP Series=89.
- Detenerse al final de cada fase y esperar confirmación antes de
  continuar con la siguiente — no adelantarse.

## 2. Estado real de fases completadas hoy

Todas pusheadas a `origin/main`. Última migración aplicada: **056**
(verificado en staging con `\d` / `SELECT` de cada migración).

Hashes ya actualizados post-purgado (ver nota de arriba):

| Fase | Qué hace | Commit(s) |
|---|---|---|
| **1** | Pesaje: `sin_stock` ya no se marca en ingredientes ya pesados aunque el stock global caiga después | `01cc4df` |
| **2** | Horno tipo Piso fuerza Programa 1 automáticamente (frontend + validación backend) | `04d0bd7` |
| **3** | Sync SAP: `U_JZ_Formado` → `esFormado`, fallbacks defensivos de tamaño/forma/peso/divisor con `logger.warn` auditable. Migración 054 (`requiere_formado` en `productos_por_masa`, sin poblar todavía en esa fase) | `fd0aa06` |
| **4** | Simulación de agrupación de División por 4 atributos (`clasificarClaveAgrupacion` extendida con `multiplo_divisor`, `simularAjusteDivisorPorGrupo`, empaquetado por chunks de 2 niveles). 3 puntos de enganche: `aprobarMasaCore`, `confirmarPesaje`, merge de OV en `sap.controller.js`. Migración 055 | `a22f49c` (migración) → `168350e` (lógica) → `f58e787` (enganches) |
| **5** | Formado por producto/SKU en vez de por tipo de masa completo. `formado_detalles` (1 fila por producto formado). Migración 056 | `b74139a` (migración) → `718ddc8` (backend) → `eb63569` (frontend) |

Nota sobre el historial de git: hubo un incidente de duplicación de
commits (mismo contenido, hashes distintos — commits equivalentes por
trabajar dentro de una carpeta sincronizada por OneDrive). Se resolvió
con un merge. Si vuelve a pasar, es la misma causa — considerar sacar
`.git/` de la sincronización de OneDrive.

**Incidente de seguridad — historial de git purgado (12-ago-2026):**
Durante la sesión se detectó que, además de un password de RDS de
staging expuesto por esta misma sesión (`.claude/settings.local.json`),
el commit `94944d2` ("Changes Deploy Backend AWS", 15-feb-2026 — de
**6 meses antes** de esta sesión, no relacionado con el trabajo de hoy)
tenía subido al repo:
- La **llave privada SSH completa** del EC2 de staging
  (`deployment/aws-staging/produccion-artesa-staging-key.pem`)
- Dos passwords de RDS en texto plano (uno en
  `DB_PASSWORD_TEMP.txt`/`RECURSOS_CREADOS.txt`/`BACKEND_DEPLOYED.txt`,
  otro distinto en `aws-deployment-config.env`)
- `JWT_SECRET`/`JWT_REFRESH_SECRET` completos (`aws-deployment-config.env`)
- Credenciales de login de la app en texto plano (`admin`, `supervisor1`,
  `operario1`) en `BACKEND_DEPLOYED.txt`
- `backend/backend.tar.gz` y `backend/backend.zip` (43MB), que a su vez
  contenían un `.env` empaquetado adentro con las mismas credenciales

Se purgó todo el historial con `git-filter-repo` (instalado vía `pip
install git-filter-repo`, versión 2.47.0), sacando 8 paths de los 928
commits del repo (`.claude/settings.local.json` +
`deployment/aws-staging/produccion-artesa-staging-key.pem` +
`DB_PASSWORD_TEMP.txt` + `aws-deployment-config.env` +
`RECURSOS_CREADOS.txt` + `BACKEND_DEPLOYED.txt` + `backend.tar.gz` +
`backend.zip`). Verificación tras el purgado (`git log --all
-S'<valor>'` con los 3 secretos conocidos, y `git cat-file -e` sobre los
hashes viejos `242e313`/`94944d2`): **ningún valor de los secretos
aparece en el historial nuevo, y los commits originales ya no existen**.
`origin/main` se reescribió con `git push --force` (HEAD pasó de
`b667af4` a `eb63569`).

**Esto NO rota los secretos reales** — el purgado del historial de git
no invalida la llave SSH ni los passwords en el servidor real. Sigue
pendiente rotarlos del lado de AWS/EC2/RDS (ver sección 4). Cualquier
clone/fork del repo hecho antes del purgado todavía tiene el historial
viejo con los secretos.

## 3. Decisiones de diseño reutilizables

- **Patrón tabla `_detalles`** (`registros_X` = header, 1 fila por
  masa/sesión; `X_detalles` = 1 fila por producto, FK a
  `producto_masa_id`): ya existía en `empaque_detalles`, se replicó en
  `formado_detalles` (Fase 5). Es el patrón a seguir para cualquier
  evento futuro que necesite trazarse por producto dentro de una fase
  (ej. Fase 6 — Fermentación por producto — debería usar el mismo
  esquema).
- **Desempate determinístico: id ascendente**, usado consistentemente en
  toda la Fase 4 (`simularAjusteDivisorPorGrupo`, `agruparProductosEnTandas`
  a nivel grupo y a nivel producto). Variante técnica real, no oculta:
  comparaciones de cantidades exactas (panes, enteros) usan `!==`
  estricto; comparaciones de kg (float) usan épsilon `Math.abs(diff) >
  0.0001`. El desempate final siempre es id ascendente (o `minId` del
  grupo cuando el elemento comparado es un grupo, no un producto).
- **B1 — consolidación de OVs**: bug ya resuelto antes de esta sesión
  (masa en PLANIFICACION sin aprobar que recibe una OV nueva del mismo
  tipo). Nunca se tocó su lógica en ninguna fase — Fase 4 solo agregó el
  enganche de `simularAjusteDivisorPorGrupo` DENTRO de ese bloque
  (`sap.controller.js:945-1053`), sin alterar la consolidación en sí.
- **B2 — agrupación de `agruparProductosEnTandas` solo por `tipo_masa`**:
  decisión del 3-ago-2026 (comentario "FIX 2026-08-04" en el código
  original). **Estado actual: superada/reemplazada en Fase 4** — la
  función ahora sí usa `clasificarClaveAgrupacion` (4 factores:
  tipo_masa+forma+tamaño+multiplo_divisor) para el corte por chunks. Es
  un cambio reconocido y documentado explícitamente en el propio código
  como evolución del diseño original, no un descuido.
- **Limitación conocida y documentada — sin cohesión de OV en el
  empaquetado**: `agruparProductosEnTandas`/Pieza A y
  `simularAjusteDivisorPorGrupo` operan sobre `productos_por_masa`
  agregado, sin visibilidad de OV individual. Una misma OV puede quedar
  partida entre tandas aunque hubiera cabido entera en una
  (`distribuirProductosPorTandas` sigue fragmentando proporcionalmente).
  **Decisión explícita** tomada tras evaluar costo/beneficio en Fase 4 —
  bajar a nivel de `productos_por_masa_ov` queda como fase aparte, solo
  si se confirma como necesidad real de negocio.

## 4. Pendientes

- **Deploy a staging** del código acumulado de las 5 fases (las
  migraciones 054-056 ya están aplicadas en staging vía psql directo;
  falta el deploy real del código backend/frontend).
- **Deploy a producción** de todo lo acumulado hoy — nada de esto llegó a
  producción todavía, incluidas las migraciones 054, 055 y 056.
- **Pruebas funcionales explícitamente pendientes**:
  - Fase 1: confirmar en vivo que un ingrediente ya pesado no vuelve a
    mostrar ⚠ sin stock aunque otra masa consuma el mismo ítem después.
  - Fase 5: aprobar/pesar una masa de prueba con productos que tengan
    `requiere_formado=true` (requiere que el próximo sync SAP corra con
    el fix de Fase 3/5 para poblar el campo — antes de esto, ningún
    producto real en staging tenía `requiere_formado=true`, confirmado en
    Fase 5).
- **Seguridad — rotación real de credenciales (URGENTE, no lo resuelve el
  purgado de git):** el purgado del historial (ver sección 2) borra los
  secretos del repo, pero NO los invalida en AWS/el servidor real. Sigue
  pendiente, del lado de infraestructura (fuera del alcance de esta
  sesión):
  - Rotar/reemplazar la llave SSH del EC2 de staging
    (`produccion-artesa-staging-key.pem`, IP `54.196.194.114`) — la
    llave vieja debe dejar de aceptarse en el servidor.
  - Rotar el password de la RDS de staging (`artesa_staging`) — hay DOS
    valores viejos expuestos (el usado en esta sesión y otro anterior en
    `aws-deployment-config.env`).
  - Rotar `JWT_SECRET`/`JWT_REFRESH_SECRET` si esos valores siguen siendo
    los que usa el servidor real — esto invalida todas las sesiones
    activas de usuarios, hay que planearlo, no es instantáneo/gratis.
  - Cambiar los passwords de los usuarios demo expuestos
    (`admin`/`supervisor1`/`operario1`) si siguen siendo los reales en
    staging.
  - Nada de esto lo pude hacer desde esta sesión (no tengo acceso a
    AWS/EC2/RDS) — queda 100% en manos del usuario.
- **Fase 6** (Fermentación por producto + quitar label "Salida sugerida")
  no se empezó — sigue en el plan original, mismo patrón de
  investigación-antes-de-diseño que Fases 4 y 5.
