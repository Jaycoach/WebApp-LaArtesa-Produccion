---
name: secrets-hygiene-in-tests
description: Reglas para manejar contraseñas y credenciales en cualquier script, test, o archivo versionado en git. Usar siempre que se escriba un script de prueba que involucre login, cambio de contraseña, tokens, API keys, o cualquier credencial — y antes de reportar una tarea como validada si tocó autenticación.
---

## Regla 1 — nunca hardcodear una contraseña real

Ningún script, test, migración, o archivo versionado puede contener una
contraseña real: reportada por un usuario, vista en un log de producción,
o de una cuenta real de cualquier ambiente. Aplica incluso a scripts que
"solo reproducen un bug puntual" — sin excepción.

## Regla 2 — las contraseñas de prueba se generan en runtime

Nunca escribir un password de prueba como literal en el archivo, ni
siquiera uno claramente inventado. Generarlo en el momento de ejecución
(`openssl rand -base64 12` o equivalente del lenguaje que corresponda).

## Regla 3 — los tests de validación se escriben contra la regla real, no contra un ejemplo puntual

Si el objetivo es probar "la validación acepta caracteres especiales" o
"rechaza contraseñas cortas", el script debe leer o replicar la regla
real del validador del proyecto y generar casos programáticamente que
cumplan/incumplan esa regla — no comparar contra un password de ejemplo
fijo. Un test atado a un valor puntual es frágil además de ser un riesgo
de filtración.

## Regla 4 — nunca reproducir en un test una contraseña real reportada por un usuario

Ni siquiera como caso de regresión. Generar un valor sintético con las
mismas propiedades estructurales que se necesiten probar.

## Regla 5 — enmascarar salida sensible

La salida de cualquier script que pueda incluir un password u otra
credencial (en el payload de un request, por ejemplo) se filtra antes de
imprimirse — mostrar solo los campos relevantes para el assert (status,
success, mensaje de error), nunca el body crudo sin filtrar. Al hashear
contraseñas en un script de shell, pasarlas por stdin, nunca como
argumento de línea de comandos (queda visible en `ps`).

## Regla 6 — grep de sanidad antes de reportar validado

Antes de reportar cualquier tarea que tocó autenticación/contraseñas como
VALIDADO, correr un grep sobre los archivos tocados buscando patrones de
contraseña/credencial en texto plano, y confirmar en el reporte que se
corrió — no asumirlo.

## Regla 7 — si se encuentra una violación en un commit ya hecho

Reportarlo explícitamente al dueño del proyecto en el resumen final,
incluso si no es parte del alcance de la tarea actual. No corregirlo en
silencio ni ignorarlo.