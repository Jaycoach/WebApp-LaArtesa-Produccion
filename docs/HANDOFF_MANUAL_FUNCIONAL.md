# ENCARGO PARA CLAUDECODE — Reescribir el Manual Funcional de Orbit

## Tarea

Reescribir el manual funcional de Orbit para que sea una **guía de uso paso a
paso** (qué botón tocar, qué campo llenar, qué ve el usuario en pantalla),
no una lista descriptiva de funcionalidades. Salida final: documento Word
(.docx), mismo estilo visual que versiones anteriores si es posible (navy
`#1F3864` / dorado `#B08D57`) — pero prioriza contenido correcto sobre estilo.

## Metodología obligatoria

Antes de escribir cada sección, **grep/cat el componente `.tsx` y el
controller real de esa fase en este repo**. No asumas nada de versiones
anteriores del manual ni de esta conversación — el estado de la app cambia
seguido y el borrador de abajo puede estar desactualizado en varios puntos.
El borrador adjunto al final de este archivo es solo referencia de
**estructura y tono**, no de contenido verificado.

## Reglas de contenido (confirmadas por Jonathan, 03-sep-2026)

1. **Nunca mencionar personas por nombre propio.** Usar cargo/rol:
   "Coordinación de Operaciones", "Jefe de Almacén", "Jefe de Empaque",
   "Supervisor de Producción", etc. El personal rota y los nombres quedan
   obsoletos en meses.
2. **Sincronización SAP — flujo real:** Sidebar → Planificación (Lista de
   Masas) → seleccionar fecha del día → botón "Sincronizar SAP" ahí mismo
   (no es una página aparte). Verificar contra `ListaMasas.tsx`. Este es el
   Paso 3 del proceso de sync (después de BOM e Inventario/Lotes) — debe
   describirse igual, de forma consistente, en todo el documento.
3. **Notificación por correo a empaque:** ocurre al **aprobar** la masa en
   Planificación, no al confirmar Pesaje. Verificar en `aprobarMasaCore` /
   `masas.controller.js` y corregir si el manual anterior lo tenía mal.
4. **División, Amasado y Horneado:** el registro es **por producto** dentro
   de cada masa, no un formulario único agregado para toda la masa —
   verificar contra `DivisionMasa.tsx` y los componentes de Amasado/Horneado,
   y reflejarlo explícitamente en los pasos.
5. **Documentar (verificando en código):** al aprobar una masa, desde Pesaje
   se puede visualizar los lotes que se van a fabricar y, a modo
   informativo, los materiales de empaque que se van a usar.
6. **Ajuste de paquetes en Planificación:** `DELTA_DEFAULT_PAQ = 0`
   (confirmado por Jonathan) — el campo de ajuste inicia en 0, no en 2.
   Verificar contra `aprobarMasaCore` actual antes de describirlo.

## Estructura sugerida

Introducción → Sincronización SAP (3 pasos, orden obligatorio) → Lista de
Masas (filtros) → Roles (sin nombres) → las 8 fases, cada una con "qué hace"
+ "cómo se registra, paso a paso, por producto donde aplique" → FAQ →
Glosario.

---

# BORRADOR DE REFERENCIA (estructura y tono — NO verificado contra el código actual)

**ORBIT**

Control de Producción — La Artesa SAS

**MANUAL FUNCIONAL**

*Guía de uso paso a paso — cómo operar cada pantalla*

Versión 4.0 — 3 de septiembre de 2026

*(Reemplaza la versión 3.0 — esta versión explica cómo hacer cada
registro, no solo qué existe)*

**Índice**

1\. Introducción

2\. Antes de empezar el día: sincronizar con SAP (orden obligatorio)

3\. La lista de masas — filtros y búsqueda

4\. Roles y trazabilidad

5\. Las 8 fases — qué hacen y cómo registrar cada una

5.1 Planificación

5.2 Pesaje

5.3 Amasado

5.4 División

5.5 Formado

5.6 Fermentación

5.7 Horneado

5.8 Empaque

6\. Preguntas frecuentes

7\. Glosario rápido

**1. Introducción**

Orbit es el sistema que usa La Artesa para controlar todo el proceso de
producción de panadería, desde que llega el pedido desde SAP hasta que
el producto queda empacado y listo para despacho.

Esta versión del manual está pensada para que cualquier persona del
equipo pueda sentarse frente a una pantalla de Orbit y saber exactamente
qué botón tocar, qué campo llenar y qué va a ver el sistema en cada paso
— no es solo una descripción de funcionalidades.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>ℹ️ Alcance de este documento</strong></p>
<p>Si necesitas ayuda con contraseñas, creación de usuarios o roles,
existe un manual aparte: "Manual Funcional — Gestión de Usuarios"
(agosto 2026).</p></td>
</tr>
</tbody>
</table>

**2. Antes de empezar el día: sincronizar con SAP**

Todo el trabajo del día depende de que Orbit tenga la información más
reciente de SAP. Esto se hace desde la pantalla "Sincronizar con SAP",
en 3 pasos que van en un orden fijo. Si se sincronizan las órdenes de
venta (Paso 2) sin haber hecho antes el Paso 1 (BOM) al menos una vez, o
sin tener el inventario al día, los cálculos de ingredientes y stock
pueden salir mal.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>⚠️ Obligatorio — orden importa</strong></p>
<p>Paso 1 — Sincronizar BOM: se hace una sola vez al arrancar, y cada
vez que se modifique una receta en SAP. No hace falta repetirlo todos
los días si las recetas no cambiaron.</p>
<p>Paso 2 — Sincronizar Inventario y Lotes: se recomienda al inicio de
cada día. Tarda entre 10 y 15 minutos — no cierres la pestaña mientras
corre.</p>
<p>Paso 3 — Sincronizar Órdenes de Venta: se hace cada día, después de
los dos pasos anteriores. Es lo que crea las masas del día en
Planificación.</p></td>
</tr>
</tbody>
</table>

**2.1 Paso 1 — Sincronizar BOM (recetas)**

Trae de SAP la lista de materiales (receta) de cada producto — de aquí
sale cuánto de cada ingrediente lleva una masa.

1.  Entra a "Sincronizar con SAP" desde el menú.

2.  En la tarjeta "Paso 1 — Listas de Materiales (BOM)", haz clic en el
    botón "Sincronizar BOM".

3.  Espera el mensaje de confirmación en verde: "✓ BOM sincronizado
    correctamente", con el número de artículos procesados y cuántos
    tienen receta.

Si algún artículo queda "sin BOM en SAP", el sistema lo indica en el
mismo mensaje — repórtalo a Diana/Operaciones para que se complete la
receta en SAP.

**2.2 Paso 2 — Sincronizar Inventario y Lotes**

Trae de SAP el stock disponible, el costo promedio y los lotes activos
de cada materia prima. También actualiza los datos maestros del producto
(tamaño, forma, si es decoración, peso máximo de división).

1.  En la misma pantalla, busca la sección "Inventario y Lotes — Bodega
    ALMP".

2.  Haz clic en "🔄 Sincronizar Inventario y Lotes".

3.  Espera — el proceso consulta SAP artículo por artículo y puede tomar
    entre 10 y 15 minutos. La página sigue funcionando mientras tanto,
    no hace falta recargarla.

4.  Al terminar, verás cuántas materias primas y cuántos lotes se
    sincronizaron.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>💡 Atajo</strong></p>
<p>Si necesitas corregir solo uno o dos productos puntuales (por
ejemplo, uno que quedó con un dato faltante), hay una sección aparte "🎯
Sincronizar códigos puntuales" donde escribes los códigos SAP separados
por coma, sin tener que repetir la sincronización completa.</p></td>
</tr>
</tbody>
</table>

**2.3 Paso 3 — Sincronizar Órdenes de Venta (cada día)**

Importa las órdenes de venta abiertas del día, las agrupa por tipo de
masa y crea las masas en Planificación.

1.  En la tarjeta "Paso 2 — Órdenes de Venta (diario)", selecciona la
    fecha de producción (por defecto aparece la de hoy).

2.  Deja sin marcar la casilla "Forzar re-sincronización" en el uso
    normal del día — solo se usa si necesitas recrear masas ya
    existentes en Planificación (esta opción preserva las que ya están
    en producción).

3.  Haz clic en "Sincronizar Órdenes de Venta".

4.  Verás el mensaje "✓ Órdenes sincronizadas. Ve a Planificación para
    continuar."

5.  Ve al menú "Planificación" para ver las masas recién creadas.

**3. La lista de masas — filtros y búsqueda**

Una vez sincronizadas las órdenes, en "Planificación" aparece la lista
de masas del día. La barra superior de esta lista tiene, en este orden:
casilla "Seleccionar Todo", cuadro de búsqueda "Buscar masa...", el
desplegable "Filtros" y el botón "Expandir todo".

- Buscar masa: escribe el nombre o código de la masa para encontrarla
  rápido, sin tener que revisar toda la lista.

- Filtros (desplegable de selección múltiple): permite filtrar por fase
  actual, por estado, o por atributo especial de la masa — repetición,
  adicional, prioritaria o subdivisión. Por defecto no hay ningún filtro
  aplicado ("Todas").

- Seleccionar Todo: marca automáticamente todas las masas que se pueden
  aprobar de una vez (solo aparece esta casilla cuando hay más de 2
  masas pendientes de aprobar).

- Expandir todo: abre de una vez el detalle de todas las tarjetas de
  masa en pantalla, en lugar de tener que hacer clic una por una.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>💡 Cómo leer una tarjeta de masa</strong></p>
<p>Cada tarjeta de masa muestra también si es una "Repetición" (llegó
más de un pedido del mismo tipo de masa) o si tiene algún dato
incompleto en SAP (badge de advertencia) — en ese caso no se debe
aprobar hasta corregir el dato en SAP y resincronizar.</p></td>
</tr>
</tbody>
</table>

**4. Roles y trazabilidad**

Todos los usuarios pueden ver el estado de cualquier masa en cualquier
fase, pero solo pueden operar (registrar datos, completar una fase) en
la que les corresponde según su rol. El sistema siempre registra qué
usuario hizo qué y en qué momento.

**5. Las 8 fases — qué hacen y cómo registrar cada una**

**5.1. Planificación**

*Rol responsable: Supervisores de producción*

Aquí se revisan las masas recién sincronizadas, se ajustan las unidades
a producir si hace falta, y se aprueban para que puedan pasar a Pesaje.

**Depende de: Haber completado la sincronización de SAP (sección 2).**

**Cómo ajustar las unidades de un producto (opcional)**

1.  Entra al detalle de la masa (clic en la tarjeta desde la lista).

2.  En la tabla de productos, ubica la columna de ajuste (solo visible
    para Supervisor, mientras la masa esté en fase Planificación).

3.  El campo ya trae un valor precargado — si no lo tocas, ese es el que
    se aplicará al aprobar.

4.  Si quieres un ajuste distinto, escribe el número de paquetes (puede
    ser positivo como "+2" o negativo como "-1"; escribe "0" si quieres
    que no se aplique ningún ajuste).

5.  Opcionalmente, escribe un motivo en el campo de texto de abajo.

6.  Haz clic en "Guardar" junto al campo.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>❓ Por confirmar contigo antes de distribuir</strong></p>
<p>El valor que trae precargado el campo de ajuste (y el que se aplica
automáticamente si nunca lo tocas al aprobar) — necesito que confirmes
si actualmente es "+2 paquetes" o "0", porque encontré información
distinta entre el código fuente y lo que tenía anotado de una sesión
reciente. Dime cuál es el comportamiento correcto en este momento y lo
dejo fijo en la próxima versión.</p></td>
</tr>
</tbody>
</table>

**Cómo aprobar la masa**

1.  Revisa que ningún producto tenga el badge de "dato incompleto" (si
    lo tiene, no se puede aprobar — hay que corregir en SAP y
    resincronizar primero).

2.  Haz clic en "Aprobar" (o, si vas a aprobar varias a la vez, marca
    "Seleccionar Todo" y usa "Aprobar todo").

3.  La masa pasa a estado "Aprobada" y queda lista para Iniciar Pesaje.

**5.2. Pesaje**

*Rol responsable: Operarios de bodega/pesaje*

Se verifica y registra el pesaje real de cada ingrediente de la masa,
comparándolo contra el peso teórico esperado.

**Depende de: Que el inventario y los lotes de SAP estén sincronizados y
correctos (sección 2.2).**

**Cómo hacer el registro**

1.  Abre la masa aprobada y entra a la fase Pesaje.

2.  Verás el checklist de ingredientes. Para cada uno, marca en orden:
    "Disponible" → "Verificado" → "Pesado".

3.  El sistema sugiere automáticamente con qué lote pesar cada
    ingrediente — el que vence primero (FEFO) — para evitar desperdicio.

4.  Registra el peso real; el sistema lo compara al instante contra el
    peso teórico y muestra la diferencia.

5.  Los ingredientes marcados como "decoración" (por ejemplo, huevo para
    pintar o semillas) no aparecen aquí — se manejan más adelante en el
    proceso.

6.  Cuando todos los ingredientes tengan sus 3 pasos marcados, haz clic
    en "Confirmar Pesaje Completo".

Al confirmar, el sistema descuenta automáticamente el inventario real en
SAP y notifica por correo al equipo de empaque para que empiece a
alistar materiales.

**Al completarse: se desbloquea Amasado.**

**5.3. Amasado**

*Rol responsable: Operarios de amasado*

Se registra cómo se preparó la masa: amasadora usada, velocidades y
temperaturas.

**Cómo hacer el registro**

1.  Entra a la fase Amasado desde el detalle de la masa.

2.  Selecciona la amasadora utilizada, de la lista disponible.

3.  Llena los campos obligatorios: Temperatura masa final (°C),
    Velocidad 1 (minutos), Velocidad 2 (minutos).

4.  Llena, si aplica, Temperatura del agua (°C).

5.  Agrega observaciones si lo consideras necesario.

6.  Haz clic en "Completar Amasado".

Los ingredientes principales (harina, agua) que ya se confirmaron en
Pesaje aparecen en pantalla como referencia, sin tener que volver a
preguntarlos.

**Al completarse: se desbloquea División.**

**5.4. División**

*Rol responsable: Operarios de corte*

Se registra cómo se dividió la masa en porciones por producto.

**Depende de: Ingredientes ya amasados. Atributos de tamaño/forma
configurados en SAP para cada producto.**

**Cómo hacer el registro**

1.  Entra a la fase División desde el detalle de la masa.

2.  Selecciona la máquina de corte: Conic (automática, 100 kg) o
    Divisora Manual (50 kg).

3.  Registra la temperatura de entrada de la masa (°C) — campo
    obligatorio.

4.  Si el tipo de masa requiere reposo pre-división (por ejemplo Gold,
    Brioche, Croissant), marca la casilla y registra hora de inicio y
    fin — el sistema calcula el tiempo automáticamente.

5.  En la tabla de productos, verás para cada uno: paquetes pedidos,
    panes sugeridos a cortar, gramaje unitario, y si la máquina exige
    cortar en múltiplos exactos (por ejemplo, de 6 en 6).

6.  Escribe en cada fila las unidades que realmente se cortaron.

7.  Agrega observaciones si lo consideras necesario.

8.  Haz clic en "Completar División".

Si se corta más de lo pedido por exigencia de múltiplos de la máquina,
ese excedente queda registrado como inventario adicional, no se pierde.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>🆕 Novedad (septiembre 2026)</strong></p>
<p>Una vez la masa ya fue dividida, el sistema bloquea cualquier ajuste
posterior de paquetes/unidades sobre esa masa — hay que gestionar el
cambio directamente con el supervisor.</p></td>
</tr>
</tbody>
</table>

**Al completarse: se desbloquea Formado.**

**5.5. Formado**

*Rol responsable: Operarios de formado*

Aplica solo a los tipos de masa que requieren dar forma final a la pieza
(por ejemplo Gold, Brioche, Ciabatta, Croissant, Toscano, Baguette). El
Pan Árabe, por ejemplo, no pasa por esta fase.

**Cómo hacer el registro**

1.  Entra a la fase Formado desde el detalle de la masa.

2.  Verás la tabla de productos a formar, con las unidades y el gramaje
    esperado por producto.

3.  Selecciona la máquina formadora de la lista. Si no hay máquinas
    configuradas, el sistema avisa que se registrará como formado
    manual.

4.  Confirma que las piezas están listas y haz clic en el botón para
    completar/confirmar el formado.

**Al completarse: se desbloquea Fermentación.**

**5.6. Fermentación**

*Rol responsable: Operarios de cámara*

Se registra el paso de la masa por cámara de fermentación y, si el tipo
de masa lo requiere, por cámara de frío.

**Cómo hacer el registro — Cámara de fermentación**

1.  Entra a la fase Fermentación desde el detalle de la masa. El sistema
    te muestra en qué paso vas: Entrada cámara → Salida cámara → (si
    aplica) Entrada frío → Salida frío.

2.  En "Entrada a Cámara de Fermentación", confirma la hora de entrada
    (por defecto trae la hora actual, editable), y registra Temperatura
    (°C) y Humedad (%) si las tienes a mano.

3.  Haz clic en "🌡️ Registrar Entrada a Cámara".

4.  El sistema calcula y muestra automáticamente la hora de salida
    sugerida, según el tipo de masa.

5.  Cuando la masa esté lista (puede ser antes o después de la hora
    sugerida, según tu criterio), entra de nuevo a la fase, confirma la
    hora real de salida y agrega observaciones si aplica.

6.  Haz clic en "⏱️ Registrar Salida de Cámara" (o "✅ Registrar Salida
    y Completar Fermentación" si el tipo de masa no requiere frío).

**Si el tipo de masa requiere cámara de frío**

1.  Después de la salida de cámara, el sistema te lleva automáticamente
    al paso "❄️ Entrada a Cámara de Frío" — agrega observaciones y haz
    clic en "❄️ Registrar Entrada a Frío".

2.  Cuando corresponda sacarla, confirma la hora real de salida
    (editable, por defecto la hora actual) y haz clic para registrar la
    salida de frío.

**Al completarse todos los pasos que aplican: se desbloquea Horneado.**

**5.7. Horneado**

*Rol responsable: Operarios de horno*

Se registra la cocción final: horno, programa, temperaturas, uso de
damper (vapor) y calidad del resultado.

**Cómo hacer el registro**

1.  Entra a la fase Horneado desde el detalle de la masa.

2.  Selecciona el horno: Rotativo 1, 2, 3 o Piso. (El horno de Piso no
    tiene damper — es el indicado para baguettes y laminados que
    necesitan humedad.)

3.  Selecciona el programa de horneado sugerido para ese tipo de masa
    (el sistema te muestra primero los sugeridos, y también puedes ver
    todos los programas disponibles).

4.  Registra la temperatura inicial real y si se usó damper.

5.  Haz clic para iniciar el horneado.

6.  Durante la cocción, puedes volver a la pantalla para actualizar la
    temperatura media real y los tiempos de apertura/cierre del damper.

7.  Puedes registrar avances parciales por variedad de producto — no es
    necesario esperar a que todo el lote esté listo para reportar.

8.  Al terminar, registra la calidad de color (Perfecto / Claro /
    Oscuro) y de cocción (Perfecto / Crudo / Sobre-cocido), agrega
    observaciones y completa el horneado.

**Al completar todas las variedades: la masa pasa automáticamente a
Empaque.**

**5.8. Empaque**

*Rol responsable: Operarios de empaque*

Última fase: se registra lo empacado, se imprime la etiqueta y se envía
la entrada/salida de inventario a SAP.

**Depende de: Horneado completado. Materiales de empaque configurados en
SAP (grupo de empaque).**

**Cómo hacer el registro**

1.  En el módulo de Empaque puedes ver primero un resumen consolidado
    por variedad/SKU de todo lo que hay que empacar en el día (sumando
    todas las masas activas) — útil para alistar materiales de una sola
    vez.

2.  Entra a la masa específica para empacar. Verás, por cada orden de
    venta (OV), la tabla de productos con las unidades a empacar y los
    materiales de empaque requeridos (bolsas, cajas, etiquetas),
    calculados desde la receta de empaque de SAP.

3.  Registra las unidades y paquetes empacados por producto en la
    casilla correspondiente y haz clic en "Guardar" en esa fila.

4.  Si necesitas imprimir la etiqueta de un producto (información
    INVIMA: peso neto, ingredientes, alérgenos, fecha de vencimiento,
    lote, fabricante), haz clic en el botón "Etiqueta" de esa fila.

5.  Cuando todos los productos de la masa estén registrados, haz clic en
    "Completar empaque".

6.  Si el sistema detecta unidades faltantes frente a lo pedido, te va a
    pedir una observación antes de continuar — escríbela y confirma.

Al completar, el sistema envía automáticamente la entrada y salida de
inventario a SAP, dejando el lote de producción registrado con su fecha
de vencimiento.

**Al completarse: la masa queda marcada como producción completada, con
lote y trazabilidad de principio a fin.**

**6. Preguntas frecuentes**

**¿Por qué tengo que sincronizar BOM e Inventario antes que las Órdenes
de Venta?**

Porque las Órdenes de Venta se agrupan y calculan usando la receta (BOM)
y el stock/lotes disponibles. Si sincronizas las órdenes primero, los
cálculos de ingredientes pueden quedar desactualizados o incompletos.

**¿Por qué una masa aparece marcada como "Repetición"?**

Porque llegó más de una orden de venta para el mismo tipo de masa el
mismo día. El sistema las acumula automáticamente en la misma masa, sin
duplicar, sumando las cantidades.

**¿Qué pasa si una orden de venta se cancela después de sincronizada?**

Si la masa todavía no pasó por pesaje, se puede cancelar desde
Planificación y el sistema libera automáticamente el inventario que
había reservado. Si el pesaje ya se confirmó en SAP, la masa ya no se
puede cancelar desde Orbit — hay que gestionarlo directamente en SAP.

**¿Por qué un producto nuevo no aparece bien agrupado en División, o no
deja aprobar la masa?**

Casi siempre es porque en SAP no se completaron campos como tamaño,
forma, peso de masa dividida, múltiplo divisor, unidades por paquete o
días de vencimiento. Orbit marca el producto con un aviso de "dato
incompleto" y no permite aprobar la masa hasta corregirlo en SAP y
resincronizar (Paso 2, sección 2.2).

**¿Qué hago si el ambiente no responde?**

Repórtalo a Jonathan indicando la hora exacta y qué estabas haciendo.

**7. Glosario rápido**

| **Término**     | **Qué significa**                                                                                                                                        |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Masa            | Agrupación de una o más órdenes de venta del mismo tipo de producto, que se produce como una sola unidad de trabajo.                                     |
| OV              | Orden de Venta — el pedido original que viene de SAP.                                                                                                    |
| BOM             | "Bill of Materials" — la receta de un producto: qué ingredientes y en qué cantidad lleva.                                                                |
| SKU             | Código único de un producto específico en SAP (ej. PANPAQ182).                                                                                           |
| Lote            | Identificador que agrupa una producción específica, usado para trazabilidad y fecha de vencimiento.                                                      |
| FEFO            | "First Expired, First Out" — usar primero el lote que vence más pronto.                                                                                  |
| Merma           | Porcentaje de pérdida esperado en el proceso, usado para calcular cuánto material pedir de más.                                                          |
| Decoración      | Ingrediente que no se pesa en el checklist normal porque se usa después, en fermentación u horneado (ej. semillas, huevo para pintar).                   |
| Dato incompleto | Aviso que muestra Orbit cuando un producto no tiene todos los campos necesarios configurados en SAP — bloquea la aprobación de la masa hasta corregirlo. |

*Documento elaborado por Jonathan Jay Zuniga Perdomo — La Artesa SAS /
Orbit. Versión 4.0, actualizada el 3 de septiembre de 2026. Reemplaza la
versión 3.0 (descriptiva) por una guía de uso paso a paso.*
