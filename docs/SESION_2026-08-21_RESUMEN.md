# Resumen de sesión — 21 de agosto de 2026 (UAT Ronda 2)

Continuación, un día después, de `docs/SESION_2026-08-20_RESUMEN.md`
(bloque 1: Planificación/Listado; bloque 2: Empaque). Esta sesión arrancó
con acceso SSH real a staging por primera vez, y cubre: validación real de
la 3.9 (dueño único de `sap_articulos`), la consolidación de
`requiere_formado` como dato maestro, el diseño e implementación del
bloqueo de aprobación por producto con dato maestro incompleto, un bug de
backend y dos bugs de frontend encontrados en la validación (uno de ellos
por Jonathan directamente en el portal), una limpieza de datos de staging
corrida en paralelo por Jonathan, el fix del sync puntual de producto (no
actualizaba atributos de `sap_articulos`), y un segundo bug de frontend en
la aprobación masiva (también encontrado por Jonathan en el portal). Mismo
criterio que el documento de referencia: grep/SQL real antes de actuar,
commits separados por pieza lógica, staging antes que producción.

## 1. Arranque — UAT Ronda 2: validar 3.9 (dueño único de `sap_articulos`)

El pedido inicial de esta sesión llegó como un prompt de implementación
completo para "separar responsabilidades de escritura sobre `sap_articulos`"
(BOM ya no debía escribir ahí, Inventario debía ser el único dueño) — con un
snippet de código pegado como evidencia de que el bug (doble escritura BOM +
Inventario, orden de ejecución decide quién gana) seguía activo.

Verificado contra el código real (no el snippet pegado) antes de tocar nada:
ese refactor **ya estaba implementado**, en el commit `3f4796d` (sesión
anterior, sección 3.9 del documento de referencia) — `sincronizarBOM` ya no
tiene el bloque `INSERT INTO sap_articulos`, y el JSDoc de la función dice
explícitamente "el dato maestro del artículo (sap_articulos) es
responsabilidad exclusiva de sincronizarInventarioMP". El snippet que llegó
en el prompt estaba desactualizado respecto al repo.

## 2. El bug de doble escritura — evidencia real de que el fix ya funciona

Con SSH real a staging (`ubuntu@54.196.194.114:~/LaArtesa`, confirmado con
`hostname`/`uname -a`/`uptime` que es una instancia AWS real, no un mock),
se hizo la validación de punta a punta que el bug necesitaba:

- `git rev-parse HEAD` en staging dio `4e91afb` — **2 commits detrás** de
  `3f4796d` (`git log 4e91afb..3f4796d --oneline` → `3f4796d`, `ede5b63`).
  El bug seguía "vivo" en staging simplemente porque el fix no estaba
  deployado, no porque el fix no existiera.
- Deploy real (`deployment/deploy.sh staging`, confirmado con `cat` del
  script antes de correrlo: `git pull` → `npm install --omit=dev` → `pm2
  restart`, sin paso de build para el backend).
- Snapshot antes/después disparando `POST /api/sap/sincronizar-bom` y luego
  `POST /api/sap/sincronizar-inventario-mp` (vía curl + token real, login
  `admin`/`Admin123!@#` de `test-api.sh`) sobre `PANPAQ26`, `PANPAQ13`,
  `PANPAQ186`, `PANPAQ19`, `PANPAQ03`: tras BOM, `sap_articulos` no cambió
  ni una fila (`updated_at` idéntico); tras Inventario, las 5 filas se
  actualizaron, incluidas `tamanio`/`forma`/`peso_masa_dividida` que antes
  quedaban en blanco. Log del servidor confirma la separación: `"Sync BOM
  completada..."` nunca va seguido de `"...artículos PT actualizados en
  sap_articulos"` en la misma corrida — ese mensaje solo existe en el código
  de `sincronizarInventarioMP`.
- Curiosidad operativa registrada para la próxima sesión: en mitad de esta
  verificación, `git rev-parse HEAD` en staging pasó de `4e91afb` a
  `7980f97` (mi propio commit local, hecho minutos antes) **sin que yo
  corriera `git push`**. El reflog de `origin/main` local mostró `update by
  push` para cada commit de la sesión, y el reflog de staging mostró `pull
  origin main: Fast-forward`. Como el repo vive en una carpeta de OneDrive,
  todo indica que Jonathan ve los commits aparecer en su copia sincronizada
  y los pushea/deploya él mismo en paralelo, en tiempo real, mientras la
  sesión avanza — confirmado también por los timestamps de `~/.pm2/pm2.log`
  en staging (cada restart, todos con `exit code [0]` vía `SIGINT` — nunca
  un crash — coincide uno a uno con los horarios de deploy de la sesión).

## 3. `requiere_formado` consolidado como dato maestro en `sap_articulos`

Migración `060` (`c19f873`) + código (`55849d6`): `U_JZ_Formado` pasó de
leerse solo al vuelo durante `sincronizarDesdeOV` a persistirse también en
`sap_articulos.requiere_formado`, resuelto por `sincronizarInventarioMP` —
mismo patrón que `tamanio`/`forma`/etc. desde la 3.9. No hizo falta
reimplementar el parseo: `getArticulosConTipoMasa()` (`sap.service.js:736`)
ya calculaba `esFormado` con la misma fórmula que el flujo de OV
(`sap.service.js:559`); solo faltaba escribirlo. Validado en staging con los
15 `sap_item_code` reales que ya tenían `productos_por_masa.requiere_formado
= true` confirmado por sync de OV real (`PANPAQ04, 06, 07, 16, 17, 35, 36,
37, 38, 42, 50, 101, 186, 194, 71`) — los 15 dieron `requiere_formado = t`
en `sap_articulos` tras el sync.

**Por qué `requiere_formado` quedó excluido del bloqueo de aprobación por
dato incompleto (sección 4)**: es un `boolean` con valor propio del
producto — `false` es una respuesta legítima ("este producto no requiere
Formado"), no equivale a "dato faltante". No hay forma de distinguir
"confirmado false en SAP" de "nunca se sincronizó" sin una señal aparte (a
diferencia de `tamanio`/`forma`/etc., donde SAP vacío sí es detectable sobre
el UDF crudo — ver sección 4). Se investigó además el impacto de un error en
este campo específico: `fases.model.js:622-638` abre la fase FORMADO para
**toda la masa** si "al menos un producto" tiene `requiere_formado = true` —
si se excluyera por error un producto que sí lo necesitaba, la masa entera
podría saltarse Formado. Riesgo desproporcionado para incluirlo en el
bloqueo sin una señal confiable.

## 4. Bloqueo de aprobación por producto — diseño, bug encontrado, fix

**Investigación previa** (sin implementar nada todavía en ese momento):
se revisaron los patrones existentes que podrían servir de precedente —
`es_adicional`/`masa_adicional_referencia_id` (a nivel de masa completa, para
OVs que llegan tarde; no aplica) y `division_parcial` (informativo, no
excluye ni bloquea nada). Ninguno resolvía "parte de los productos de una
masa avanza, parte no" — quedó confirmado que era diseño nuevo.

**Hallazgo que cambió el alcance antes de escribir código**: 5 de los 6
campos pedidos (`tamanio`, `forma`, `peso_masa_dividida`, `multiplo_divisor`,
`sales_qty_per_pack`) **nunca quedan `NULL`** en `sap_articulos` porque
`sap.service.js` (`aplicarFallbacksAtributos`/`resolverUnidadesPorPaquete`)
les aplica un fallback plausible antes de guardar, específicamente para
evitar división por cero en Formado/División. Un `WHERE campo IS NULL`
literal casi nunca dispararía. Con la decisión explícita de Jonathan de
mantener el fallback pero agregar una señal aparte ("el fallback puede ser
usado para que la usuaria corrija datos que están malos en SAP"), se agregó
`detectarCamposIncompletos()` en `sap.service.js` — inspecciona el **UDF
crudo** de SAP (antes del fallback) y devuelve la lista de campos realmente
sin configurar, sin tocar la lógica de fallback existente.

**Mecanismo elegido — flag `apto_produccion` por producto** (migración `061`,
commit `3b2d623` para el schema, `7407989` para el código):

- `sap_articulos.campos_incompletos TEXT[]` — poblado por
  `sincronizarInventarioMP` con el resultado de `detectarCamposIncompletos()`.
- `productos_por_masa.apto_produccion BOOLEAN DEFAULT TRUE` — recalculado
  dentro de `aprobarMasaCore`, antes de marcar `estado = 'APROBADA'`, vía
  `JOIN` a `sap_articulos.campos_incompletos` (o "sin fila en
  `sap_articulos`" = nunca sincronizado, también cuenta como incompleto).
- El filtro `apto_produccion = true` se aplicó **solo** donde determina
  "cuánto se produce realmente" — `recalcularTotalesMasa`, la consolidación
  BOM → `ingredientes_masa` dentro de `completarFase('planificacion')`, y
  (dentro de la propia `aprobarMasaCore`) el total de paquetes y el detalle
  de materiales de empaque del correo de alistamiento. **No** se tocó el
  `EXISTS` de ruteo de Formado (`fases.model.js:622-638`, ver sección 3) ni
  las vistas de listado completo, que siguen mostrando todos los productos.

**Validado con datos reales de staging** (masa 2006/TOSCANO, 4 productos, 1
incompleto): tras `PATCH /api/masas/2006/aprobar`, el producto incompleto
quedó `apto_produccion=false`, los otros 3 en `true`, la masa pasó a
`APROBADA`, y `total_kilos_base` bajó de `403.92` a `415.00`... *(nota:
cifra exacta reconciliada matemáticamente en el momento: `5 + 287 + 123 =
415.00` kg sumando solo los 3 productos aptos con sus `unidades_ajustadas`
post-ajuste de grupo — el producto excluido, `640×5/1000=3.2kg`, no entró)*.

**Bug real encontrado en esa misma validación — masa 2025/BAGUETTE, 2
productos, los DOS incompletos**: la masa pasaba a `APROBADA` con
`total_kilos_base = 0.00` y `totalPaquetes: "0"`, pero al intentar avanzar a
PESAJE (`PUT /api/fases/2025/planificacion/completar`, el endpoint real de
"Iniciar Pesaje"), el filtro `apto_produccion=true` devolvía 0 filas y el
código existente lo interpretaba como *"La masa no tiene productos con
ItemCode SAP. Verifique la sincronización de OV"* — diagnóstico
completamente equivocado (los productos sí tenían ItemCode, el problema era
dato maestro incompleto). Reproducido con evidencia real (`400` + logs).

**Fix** (commit `6ac67f1`, separado del diseño original):
`aprobarMasaCore` ahora reevalúa `apto_produccion` en las **dos**
direcciones (antes solo ponía `false`, nunca revertía a `true` — necesario
para que un reintento tras corregir SAP y resincronizar funcione), y si
`COUNT(apto_produccion=true) = 0` para la masa, **lanza error 400 antes de
tocar `masas_produccion.estado`** — la masa queda en `PLANIFICACION`, no en
`APROBADA`. El mensaje lista producto(s) y campo(s) exactos vía
`sap_articulos.campos_incompletos`. Defensa en profundidad agregada también
en `completarFase` (diferencia "sin ItemCode SAP" de "hay ItemCode pero 0
aptos por dato incompleto", por si algo se cuela sin pasar por
`aprobarMasaCore`). Revalidado con datos frescos tras el fix (masa `1802`,
CIABATTA, 3/3 productos incompletos): `PATCH .../aprobar` → `400` con el
mensaje correcto, masa se quedó en `PLANIFICACION`. Regresión chequeada
aparte (masa `1794`, 1/3 incompleto): sigue avanzando igual que antes,
matemática de kilos verificada de nuevo a mano.

## 5. Dos bugs de frontend — encontrados por Jonathan directamente en el portal

**Bug FE-1 — el error de "Aprobar" no se mostraba**: `confirmarAprobar`
(`ListaMasas.tsx`) tenía un `catch` que solo hacía `console.error` y cerraba
el modal — el `400` real que ya devolvía el backend nunca llegaba a
Lisette. Fix (`d7ec51b`): `alert(error.message)`, mismo patrón que
`handleConfirmarPendiente` ya usaba unas líneas más abajo en el mismo
archivo. Se confirmó con el interceptor de `api.ts` que el objeto
rechazado en un `400` **no es un `AxiosError`** — el interceptor ya lo
reformatea a `{ message: data.message }` plano — por lo que el accesor
correcto es `error.message`, no `error.response.data.message` como
sugería el pedido inicial.

**Bug FE-2 — el badge de "dato incompleto" no aparecía antes de aprobar**:
confirmado por grep que la condición era `p.apto_produccion === false` —
esa columna solo se escribe dentro de `aprobarMasaCore`, así que una masa
que todavía no pasó por "Aprobar" nunca la tuvo actualizada. Fix
(`d8460ec`): la condición pasa a `p.campos_incompletos.length > 0`
directamente (ya viajaba en `productos_resumen` desde el commit del diseño
original, vía `LEFT JOIN sap_articulos` en `fases.model.js`) —
`apto_produccion` queda intacto para lo que le corresponde (cálculo de
totales al aprobar).

Ambos validados con evidencia real de navegador (Playwright/Chromium contra
`http://54.196.194.114`, sesión logueada como `admin`, no solo curl):
capturas de pantalla del badge visible en CIABATTA/CENTENO_ROLES/GALLETINAS
con una masa en estado "Planificación" (nunca aprobada), y el texto exacto
del diálogo `alert()` capturado por el navegador al intentar aprobar
CIABATTA:
```
⚠️ No se pudo aprobar la masa:

No se puede aprobar: ningún producto de la masa tiene dato maestro completo
en SAP. Corregir en SAP y resincronizar: PAN CIABATTA MED X2 (días de
vencimiento); PAN CIABATTA PEQ X4 (días de vencimiento); PAN CIABATTA MED X2
CONG (días de vencimiento)
```

## 6. Decisión explícita de Jonathan — sin reingreso automático

**No se construye ningún mecanismo de reevaluación automática** cuando se
corrige un dato incompleto en SAP después de que la masa ya avanzó (quedó
`apto_produccion=false` congelado en un producto de una masa ya
`APROBADA`). Es responsabilidad del usuario que cargó mal el dato en SAP,
no un problema a resolver con código. Mismo criterio ya aplicado en 3.2
(costeo, no se recalcula retroactivo) y 3.6 (backfill, "el fix aplica solo
hacia adelante") de la sesión anterior. Si Diana corrige el UDF y se
resincroniza Inventario, `sap_articulos.campos_incompletos` sí se
actualiza en vivo (por eso el badge de la sección 5 ya no depende de
`apto_produccion`) — pero el producto ya excluido de una masa aprobada
sigue excluido hasta que alguien lo gestione manualmente (no hay una
pantalla ni un botón para eso, no se pidió).

## 7. Limpieza de datos de staging

Corrida por Jonathan en paralelo a la sesión (no por esta sesión), en **al
menos tres** momentos distintos — se notó por los saltos en `max(id)` de
`masas_produccion` entre verificaciones sucesivas (llegó a masas con id
~2034, volvió a `2010`, y más tarde en la misma sesión bajó de nuevo,
haciendo desaparecer masas de prueba usadas pocos minutos antes — ver
sección 9). Criterio informado por Jonathan: `sap_doc_entry_pesaje IS
NULL`, sin filtro de fecha — elimina masas de prueba que nunca llegaron a
transmitir pesaje real a SAP, independientemente de cuándo se crearon. No
se corrió desde esta sesión ni se verificó el SQL exacto usado.

## 8. Fix del sync puntual de producto — no actualizaba atributos de `sap_articulos`

**Caso real de UAT**: `PAN CIABATTA MED X2 CONG` (`PANPAQ60`) bloqueado por
falta de `dias_vencimiento`. Antes de proponer un fix, diagnóstico completo
(Fase 1) de los 4 flujos de sincronización reales, con grep/cat del código
— no de memoria ni de documentación:

| Flujo | Endpoint | Trae de SAP | Escribe en `sap_articulos` |
|---|---|---|---|
| "Sincronizar BOM completo" | `POST /sincronizar-bom` (sin `items`) | Los 6 campos, vía HANA | Ninguno (solo `sap_bom_componentes`, desde 3f4796d) |
| "Corregir un producto puntual" → mitad BOM | `POST /sincronizar-bom` (con `items`) — misma función | Los 6, del ítem filtrado | Ninguno |
| "Corregir un producto puntual" → mitad lotes | `POST /sincronizar-lotes-item` | Solo stock/lotes | Ninguno (y valida contra materia prima, no PT — ver hallazgo aparte abajo) |
| "Sincronizar Inventario y Lotes" | `POST /sincronizar-inventario-mp` | Los 6, vía Service Layer, **sin filtro puntual** | Los 6 completos |

Conclusión: el botón "Corregir un producto puntual" decía *"Actualiza
receta, atributos, stock y lotes"* pero nunca tocaba atributos — las dos
llamadas que hacía (`sincronizarBOM` filtrado + `sincronizarLotesItem`)
tienen cero escritura a `sap_articulos`. La única función que sí escribe
esa tabla (`sincronizarInventarioMP`) no aceptaba filtro puntual, solo
corrida completa (~204 productos, "un par de minutos").

**Decisión de Jonathan**: no revivir la escritura en `sincronizarBOM` (el
dueño único de `sap_articulos` sigue siendo `sincronizarInventarioMP`).
Agregar en su lugar un parámetro opcional `items` a `sincronizarInventarioMP`.

**Implementación** (`d67039a` backend, `0b1ce37` frontend):
- `sap.service.js`: `getArticulosConTipoMasa(itemCodesFiltro = null)` — si
  viene, acota el `$filter` de Service Layer a esos `ItemCode`.
- `sap.controller.js`: `sincronizarInventarioMP` parsea `items` del body
  (mismo patrón que `sincronizarBOM`) y lo pasa solo al paso 3 (dato
  maestro PT) — los pasos 1-2 (stock/lotes de materia prima) siguen
  corriendo completos siempre, eso no formaba parte del cambio pedido.
  **Riesgo encontrado e implementado sin que se pidiera explícitamente**:
  el bloque que marca artículos inactivos ("ya no vienen de SAP") asumía
  que `articulosPT` era siempre el universo completo — con filtro puntual
  habría desactivado por error los ~200+ productos restantes. Se protegió
  con `if (!esSyncPuntualPT)`.
- Frontend: el botón "3. Corregir un producto puntual" ahora hace **tres**
  llamadas (BOM filtrado para receta, Inventario filtrado para atributos,
  Lotes filtrado para stock — antes solo dos). Guard de UI agregado en la
  tarjeta "2. Inventario y Lotes completo" (mismo patrón que ya existía
  para la tarjeta de BOM) para no mostrar "materias primas sincronizadas"
  cuando el disparo real fue puntual.

**Validación end-to-end en staging, con `PANPAQ60`**:
```
ANTES:   dias_vencimiento=(null)  campos_incompletos={dias_vencimiento}  updated_at=04:41:10
POST /sincronizar-inventario-mp {"items":"PANPAQ60"} → articulos_pt_actualizados: 1
DESPUÉS: dias_vencimiento=(null)  campos_incompletos={dias_vencimiento}  updated_at=06:42:54
```
`updated_at` avanzó (el endpoint sí procesó el ítem — confirmado también
por el log `"Inventario MP: 1 artículos PT actualizados"`, contra `"...204
artículos..."` de las corridas completas), pero `dias_vencimiento` siguió
vacío porque el UDF real en SAP **todavía no estaba corregido por Diana**
en el momento de esta prueba — resultado esperado, no una falla del fix.
Controles (`PANPAQ04`, `PANPAQ186`, `PANPAQ26`) sin cambios de `updated_at`
— el filtro puntual no tocó nada más. Guard de desactivación verificado:
`204` activos de `412` filas totales, el mismo número de siempre.

**Cierre parcial, sin una segunda vuelta formal**: después de esta prueba,
Jonathan confirmó que corrigió el UDF en SAP y logró aprobar la masa de
`PANPAQ60` en el portal — lo cual, dado el bloqueo de la sección 4, es
evidencia funcional fuerte de que `campos_incompletos` quedó vacío (una
masa con `campos_incompletos` no vacío no puede aprobarse). Pero esta
sesión no corrió un `SELECT` directo confirmando `dias_vencimiento` ya
poblado tras esa corrección — queda como pendiente liviano en la sección 11.

## 9. Bug de aprobación masiva — no mostraba éxitos ni fallos

**Reporte de Jonathan, probando en el portal**: al aprobar varias masas de
una vez, las que no podían aprobarse (dato incompleto) quedaban sin
aprobar, sin ningún mensaje. Solo se veían las que sí se aprobaron, vía el
refresco de la lista.

**Diagnóstico (Fase 1)**: el botón es "✓ Aprobar todo (N)"
(`ListaMasas.tsx:667-679`, selección múltiple por checkbox) → una sola
llamada `PATCH /api/masas/aprobar-bulk` (el loop de `aprobarMasaCore` por
cada id vive en el **backend**, no en el frontend). Reproducido en vivo
contra staging (masa `1822` completa + `2055` incompleta, una sola
request):
```
PATCH /api/masas/aprobar-bulk {"ids":[1822,2055]}
→ {"success":true,"aprobadas":1,"fallidas":[{"id":2055,"error":"No se puede
   aprobar: ningún producto de la masa tiene dato maestro completo en SAP.
   Corregir en SAP y resincronizar: PAN DE SEMILLAS CON MASA MADRE GRANDE
   (tamaño, forma, peso de masa dividida, unidades por paquete, días de
   vencimiento)"}]}
```
El backend ya devolvía todo el detalle necesario — el bug es **100%
frontend**, una sola línea: `masasService.ts:148` hacía `response.data!`,
pero `apiService.patch<T>()` (`api.ts:192-199`) ya entrega el body completo
de la respuesta — este endpoint en particular responde
`{success, aprobadas, fallidas}` al **nivel superior**, no en el envelope
estándar `{success, data: {...}}` que sí usan la mayoría de los demás. El
`.data` ahí buscaba una propiedad inexistente → `undefined` → `bulkResultado`
quedaba `undefined` → el modal de resultado (`ListaMasas.tsx:741-763`, ya
bien escrito, sin tocar) nunca se renderizaba, ni para éxitos ni para
fallos.

**No es el mismo patrón que el bug ya corregido (`d7ec51b`)**: aquel era un
`catch` silencioso (manejo de error faltante). Este es una
desestructuración de datos rota en el **camino feliz** — la promesa sí
resolvía, sin lanzar excepción, con `undefined` en vez del objeto real.

**Fix** (`91bdef1`): `return response as unknown as {aprobadas, fallidas}`
en vez de `response.data!`. No se tocó `apiService.patch` (rompería el
envelope estándar de los demás endpoints) ni el bloque de UI.

**Grep de otros candidatos al mismo patrón** (pedido explícitamente, sin
corregir — ver sección 11): `masasService.ts:134` (`aprobarMasa`
individual) y `masasService.ts:156` (`marcarPendiente`) tienen exactamente
el mismo defecto estructural (`response.data!` sobre una respuesta de
backend sin `data`), pero son inofensivos hoy porque ningún componente
consume el valor resuelto de esas promesas — el error, cuando lo hay, ya
viaja por el `catch`. Todos los demás usos de `.data!` en
`masasService.ts`/`checklistService.ts` (19 en total) se verificaron uno
por uno contra el `res.json` real de su endpoint — el resto sí sigue el
envelope estándar.

**Validación end-to-end con navegador real** (Playwright/Chromium, sesión
logueada, staging en `91bdef1`): masa `1811` (CHOCOLATE, completa) + `1813`
(GALLETINAS, 6 campos incompletos) → "Aprobar todo (2)" → modal:
```
⚠️ Completado con errores
1 masa(s) aprobada(s) correctamente.
Masa #1813: No se puede aprobar: ningún producto de la masa tiene dato
maestro completo en SAP. Corregir en SAP y resincronizar: GALLETINAS
(tamaño, forma, peso de masa dividida, múltiplo divisor, unidades por
paquete, días de vencimiento)
```
Confirmado en DB: `1811 → APROBADA`, `1813 → PLANIFICACION` (sin cambios).
`pm2-error.log` vacío durante toda la prueba.

**Hallazgo aparte, no corregido**: `sincronizarLotesItem` devuelve un
mensaje engañoso ("Falló: stock/lotes") cuando el input "Corregir un
producto puntual" se usa con un código de producto terminado (ej.
`PANPAQ60`) en vez de materia prima — el endpoint valida los códigos
contra `sap_bom_componentes`/`ingredientes_masa` (diseñado para MP, no
PT), así que el "fallo" es esperado pero el mensaje no lo explica. Sin fix
asignado — ver sección 11.

## 10. Commits de la sesión, en orden

| Commit | Qué hace |
|---|---|
| `7980f97` | Corrige comentario desactualizado en `sincronizarBOM` sobre el sync puntual (`itemsParam`) — ya no describe atributos que dejaron de escribirse en `3f4796d`. Deja marcada, sin decidir, si hace falta un filtro puntual equivalente en `sincronizarInventarioMP`. |
| `c19f873` | Migración 060: `sap_articulos.requiere_formado BOOLEAN DEFAULT FALSE`. |
| `55849d6` | `sincronizarInventarioMP` persiste `requiere_formado` (ya calculado en `getArticulosConTipoMasa()`, sin reimplementar parseo). |
| `3b2d623` | Migración 061: `sap_articulos.campos_incompletos TEXT[]` + `productos_por_masa.apto_produccion BOOLEAN DEFAULT TRUE`. |
| `7407989` | `detectarCamposIncompletos()` en `sap.service.js` (sobre UDF crudo); `sincronizarInventarioMP` lo persiste; `aprobarMasaCore` marca `apto_produccion` por producto; filtro aplicado en `recalcularTotalesMasa`, consolidación de ingredientes y notificación de empaque; lectura expuesta en `fases.model.js` para el frontend. |
| `c9f94bd` | Badge de "dato incompleto" en `ListaMasas.tsx` (versión inicial, dependía de `apto_produccion` — corregido en `d8460ec`). |
| `6ac67f1` | Fix: `aprobarMasaCore` bloquea la aprobación completa si 0 productos quedan aptos (antes la masa avanzaba con 0 kg y "Iniciar Pesaje" fallaba con mensaje equivocado); reevaluación bidireccional de `apto_produccion`; defensa en profundidad en `completarFase`. |
| `d7ec51b` | Fix FE: `confirmarAprobar` muestra `alert(error.message)` en vez de solo loguear a consola. |
| `d8460ec` | Fix FE: el badge de dato incompleto pasa a depender de `campos_incompletos` en vez de `apto_produccion`. |
| `d67039a` | Filtro puntual `items` en `sincronizarInventarioMP` (backend) — acota el dato maestro PT a ítems puntuales sin tocar stock/lotes de MP; guard contra desactivación masiva agregado. |
| `0b1ce37` | El botón "Corregir un producto puntual" ahora también llama a `sincronizarInventarioMP` filtrado para atributos (antes solo llamaba a `sincronizarBOM`, que ya no escribe `sap_articulos`); guard de UI en tarjeta 2 para no mostrar resultado de sync completo cuando fue puntual. |
| `91bdef1` | Fix: `masasService.aprobarMasaBulk` devolvía `undefined` por `response.data!` sobre una respuesta sin envelope — el modal de resultado de aprobación masiva nunca se renderizaba. |

*(No se listan en esta tabla los 3 commits puramente de documentación de
esta sesión — `fac69b0`, `9acb964`, `0d28f1e` — por ser meta-commits sobre
este mismo archivo, no cambios de producto.)*

**Estado de push, confirmado explícitamente al cierre** (no asumido por
haber corrido deploys): `git log --oneline origin/main..HEAD` → vacío.
`git rev-parse HEAD` local = `git rev-parse origin/main` =
`91bdef18a4e42ce9f9173aa62d60e45a649ddcb5`. Todos los commits de la sesión,
incluidos `d67039a`/`0b1ce37`/`91bdef1`, están efectivamente pusheados a
`origin/main`.

**Estado por ambiente**:
- **Staging**: confirmado con `git log --oneline -1` corrido en el propio
  servidor (`ubuntu@54.196.194.114:~/LaArtesa`) → `91bdef1`. Al día con
  `origin/main`.
- **Producción**: **no confirmado en esta sesión**. Existen credenciales
  en el repo (`deployment/aws-prod/`, host `100.48.24.34`) y se ubicó el
  path del repo en el servidor (`/home/ubuntu/LaArtesa`), pero el intento
  de correr `git log --oneline -1` (solo lectura, sin deploy) quedó
  bloqueado por el clasificador de permisos de la sesión — pedía
  autorización explícita, distinta de la ya dada para staging. No se
  insistió. Queda pendiente confirmar a qué commit está producción antes
  de asumir que estos fixes llegaron ahí.

## 11. Pendientes reales para la próxima sesión

- **`PANPAQ60`/`dias_vencimiento`** — Jonathan confirmó haber corregido el
  UDF en SAP y haber aprobado la masa exitosamente en el portal (evidencia
  funcional fuerte, ya que el bloqueo de la sección 4 no deja aprobar con
  `campos_incompletos` no vacío). Sin embargo, esta sesión no corrió un
  `SELECT` directo confirmando `dias_vencimiento` poblado tras esa
  corrección — pendiente liviano, bajo impacto, para cerrar del todo.
- **Deuda técnica anotada, no corregida**: `masasService.ts:134`
  (`aprobarMasa` individual) y `masasService.ts:156` (`marcarPendiente`)
  comparten el defecto estructural de `aprobarMasaBulk`
  (`response.data!` sobre una respuesta de backend sin envelope
  `{data:...}`) — inofensivo hoy porque nada consume el valor resuelto de
  esas promesas. Revisar si en el futuro algo empieza a depender de ese
  valor de retorno.
- **`sincronizarLotesItem` — mensaje engañoso para productos terminados**:
  al usar "Corregir un producto puntual" con un código PT (ej.
  `PANPAQ60`), la mitad de stock/lotes reporta "falló" porque el endpoint
  valida contra materia prima/BOM, no contra productos terminados — el
  comportamiento es esperado pero el mensaje no lo explica. Sin fix
  asignado.
- **Acceso a producción sin confirmar** (ver sección 10) — confirmar el
  commit real de producción y, si corresponde, autorizar el deploy de los
  fixes de esta sesión ahí.
- **Resto de UAT Ronda 2, no tocado hoy** (continuación de los pendientes
  ya registrados en la sección 4 de `SESION_2026-08-20_RESUMEN.md`, punto
  6/7/8b de la fuente `PENDIENTES_UAT_2026-07-28.md`, que sigue sin existir
  en el repo): timezone en toda la app, nombres de programas de horno.
- **BATIDO como flujo distinto** — señalado en esta sesión (aparecen
  `tipo_masa` como `BATIDO_FRUTOS_ROJOS`, item codes con prefijo `PASPAQ`
  en vez de `PANPAQ`, ej. `PASPAQ06` confirmado como código legítimo, no
  typo) — sin investigar todavía si el flujo de producción de batidos
  necesita alguna diferencia respecto al de pan.
- **`requiere_formado` per-producto migrado desde `catalogo_tipos_masa`** —
  pendiente de definir si hace falta backfill o migración adicional para
  que el dato a nivel tipo de masa (histórico) termine de ceder lugar al
  dato per-producto ya consolidado en `sap_articulos`/`productos_por_masa`.
- **Reingreso manual de productos excluidos** — no construido a propósito
  (sección 6). Si en algún momento se decide que sí hace falta una
  pantalla/acción para esto, es diseño nuevo, no un ajuste del mecanismo
  actual.
- Confirmar con Jonathan el criterio exacto de la limpieza de staging
  (sección 7) si hace falta reproducirlo o documentarlo con más detalle —
  ocurrió al menos tres veces durante esta sola sesión.

## Notas para no perder — decisiones y hallazgos que no viven en el código

- El repo vive en una carpeta de OneDrive; el flujo real de esta sesión fue
  Claude commitea local → Jonathan lo ve sincronizado en su copia → Jonathan
  pushea y deploya él mismo, en paralelo, sin coordinación explícita en el
  momento. Detectado por accidente vía `git reflog` — no asumir en la
  próxima sesión que "local sin push" significa que nada llegó a staging.
  Aun así, **al cierre de esta sesión se verificó explícitamente** con
  `git log --oneline origin/main..HEAD` que no queda nada sin pushear — no
  dar por sentado el patrón de push automático sin confirmar cada vez.
- `PASPAQ06` no es un typo de `PANPAQ06` — es una serie de códigos
  legítima y distinta (pastelería/batidos), confirmado con `sap_articulos`
  real (`PASPAQ01` a `PASPAQ10`+).
- `PANPAQ13` pasó de `sales_qty_per_pack=1` (sesión anterior) a `20` en esta
  sesión — el nombre del ítem (`"...ROLLES X 20 CONG"`) sí tiene el patrón,
  contradice el diagnóstico de "gap real sin patrón en el nombre" de la
  sección 3.7 del documento anterior. Ya no requiere acción de Diana para
  este ítem puntual.
- Existen credenciales de acceso SSH a **producción** en el repo
  (`deployment/aws-prod/artesa-produccion-key.pem`,
  `deployment/aws-prod/prod-recursos.txt` — este último incluye la
  contraseña de la base de datos de producción en texto plano; no
  reproducida aquí). El acceso, incluso de solo lectura, requiere
  autorización explícita separada de la de staging — quedó bloqueado por
  el sistema de permisos en esta sesión al intentar un `git log` simple.
