---
name: sql-schema-safety
description: Reglas para escribir o modificar cualquier SQL, migración, trigger o función de base de datos con seguridad. Usar siempre antes de escribir una consulta, crear una migración, o tocar un trigger/función compartida por varias rutas del backend.
---

## Regla 1 — nunca asumir nombres de columna

Antes de escribir cualquier SQL contra una tabla, consultar el schema
real (`\d nombre_tabla` en psql, o el archivo de referencia del schema si
el proyecto tiene uno documentado). No escribir una columna de memoria ni
por analogía con otra tabla parecida — confirmarla contra el schema real
cada vez, incluso si "seguro es así".

## Regla 2 — objetos compartidos necesitan mapeo completo de callers

Antes de tocar un trigger, función, o vista que puede dispararse desde
más de un lugar del código: hacer un grep completo del backend buscando
todos los puntos que lo invocan (directa o indirectamente, por ejemplo
cualquier UPDATE/DELETE sobre una columna que un trigger observa).
Reportar la lista completa de puntos de impacto antes de decidir el
alcance del fix — un bug en un objeto compartido casi nunca afecta un
solo flujo, aunque el síntoma reportado haya venido de uno solo.

## Regla 3 — confirmar el número de migración real antes de crearla

Nunca asumir el siguiente número de migración por continuidad lógica.
Correr `ls` (o el comando equivalente) sobre la carpeta de migraciones en
el ambiente real donde se va a aplicar, y usar el número que sigue al
último realmente presente ahí — no al último que aparece en el repo local
si puede haber diferencias entre ambientes.

## Regla 4 — SELECT de verificación antes de cualquier operación destructiva

Antes de cualquier UPDATE/DELETE fuera de una migración controlada,
correr primero un SELECT que muestre exactamente qué filas van a verse
afectadas, y mostrar ese resultado antes de ejecutar la operación.

## Regla 5 — datos vs esquema

Cambios de datos (UPSERTs, backfills, correcciones puntuales) no
necesitan migración versionada. Cambios de estructura (columnas, tablas,
triggers, funciones, constraints) sí — siempre en un archivo `.sql`
versionado, nunca aplicados a mano sin dejar rastro en el repo.

## Regla 6 — no editar producción directo

Todo cambio de código o de esquema pasa por: escribir localmente → commit
→ push → aplicar en staging → validar → recién ahí, con aprobación
explícita, aplicar en producción. Nunca editar un archivo ni correr una
migración directo sobre el servidor de producción sin ese camino.