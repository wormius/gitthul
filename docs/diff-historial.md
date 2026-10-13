# Diff e historial de un archivo

Al abrir un archivo desde Cambios, Staging, un commit o una comparación, la
barra del diff incluye un botón con un reloj para consultar su historial.
El reloj es el primer control de la barra.

Al estrechar el panel, la barra oculta primero el origen de la comparación
(por ejemplo, **En el commit** y su SHA). Si hace falta más espacio, muestra
la ruta y el origen arriba, y mueve todos los controles juntos a una fila
inferior: las opciones quedan centradas y cerrar permanece a la derecha.

El historial aparece en el panel derecho y la comparación actual permanece
abierta. Si estás viendo un commit, su versión se señala en el historial; en
una comparación entre commits se toma la versión del extremo final cuando
aparece entre los cambios del archivo.

Pulsa una versión del historial para abrir su diff. Puedes volver a pulsar el
reloj para cerrar solo el historial, o cerrar el diff y conservar la lista de
versiones. El botón también está disponible al ver el archivo completo y para
archivos binarios.

Al seleccionar dos revisiones, la lista muestra los archivos que difieren entre
sus versiones finales, igual que `git diff <origen> <destino>`. Dos ramas pueden
tener commits distintos y mostrar **Sin diferencias** si su contenido es igual.
Los recuentos de commits describen su historial, no diferencias de archivos.

Al seleccionar varios commits consecutivos que forman una cadena de primeros
padres, el diff combinado compara desde el padre del primero hasta el último.
En las demás selecciones se comparan los dos extremos. Si el diff combinado
incluye el commit inicial, empieza en el árbol vacío. Los cambios intermedios
que se deshicieron no aparecen como diferencias. Las comparaciones con WIP
muestran el efecto neto hasta los archivos actuales, incluidos los archivos
nuevos que Git no ignora.
