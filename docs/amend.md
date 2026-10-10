# Modificar el último commit (amend)

Amend reemplaza el último commit, el que señala HEAD. Permite cambiar su mensaje,
incorporar los cambios de staging o hacer ambas cosas. El commit resultante tiene
otro SHA; conserva sus padres y su autor original. La identidad actual de Git se
registra como la de quien realiza la modificación.

## Abrir y enviar amend

1. Selecciona el commit de HEAD y pulsa **Modificar el último commit (amend)**.
   También puedes abrirlo desde su menú contextual, el panel vacío o la búsqueda
   global. Abrir el editor todavía no modifica el commit.
2. Revisa el resumen y la descripción. El resumen admite **72 caracteres** y una
   sola línea; la descripción, **4500 caracteres**. Si el mensaje anterior supera
   esos límites, se recorta al cargarlo. Revisa el texto mostrado antes de enviar.
3. Elige qué incorporar. Por defecto se incluyen los cambios de staging; los
   cambios sin preparar quedan fuera. Marca **Cambiar solo el mensaje** para
   conservar staging sin incorporarlo al commit.
4. Pulsa el botón de envío. Tras completarse, puedes usar Deshacer y Rehacer.

Si hay cambios pendientes, puedes activar amend en la casilla del compositor
habitual. Sin cambios pendientes, el editor ocupa el panel derecho. Desmarcar
amend restaura el borrador de commit nuevo que tenías antes.

## Disponibilidad y cambios externos

Amend solo está disponible para HEAD: no se ofrece en commits anteriores, en un
repositorio sin su primer commit ni durante una integración en curso. Si HEAD
está desacoplado, modifica ese commit.

GitThul vuelve a comprobar HEAD y staging antes de escribir. Si otra aplicación
o una terminal cambiaron HEAD mientras editabas, cancela amend y ábrelo otra vez
para revisar el estado actual.

## Si el commit ya está publicado

Cuando la rama tiene upstream y no tiene commits por delante, el compositor
muestra un aviso de historial publicado. Enviar amend no hace push.

Publicar el commit reemplazado reescribe el historial del remoto. Revisa el flujo
de push con `force-with-lease` y coordina el cambio con quienes compartan la rama.
