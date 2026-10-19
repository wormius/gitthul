# Diff e historial de un archivo

Al abrir un archivo desde Cambios, Staging, un commit o una comparación, la
barra del diff incluye un botón con un reloj para consultar su historial.
El reloj es el primer control de la barra.

En el árbol de un commit, **Todos los archivos** también permite abrir los que
no cambiaron en ese commit. Estos se muestran directamente como archivo, con
el contenido de esa revisión en una sola vista. Los controles de comparación
vuelven al abrir un archivo modificado, con tus ajustes anteriores.

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

Git también registra el permiso de ejecución de los archivos. Por eso un archivo
puede aparecer como modificado aunque su texto sea idéntico. El visor indica si
se añadió o eliminó ese permiso y muestra los modos anterior y nuevo, por ejemplo
`100644 → 100755`. El aviso se conserva al ver el archivo completo o un binario.
**Sin diferencias de texto** indica que no hay líneas distintas con las opciones
actuales del visor; también puede ocurrir al ignorar espacios o en un renombrado.

Si todas las líneas aparecen eliminadas y añadidas con el mismo texto, puede
haber una conversión entre finales de línea `CRLF` y `LF`. Cuando el texto
coincide al normalizarlos y Git registra contenido distinto, el visor explica
esa diferencia. El parche conserva los bytes originales para Stage y Descartar.
La conversión que Git ya normaliza mediante atributos o configuración no se
presenta como un cambio pendiente de finales de línea.

El aviso ámbar también explica otras diferencias que pueden pasar inadvertidas:

- Cambios de la codificación detectada o de la marca BOM. La detección sin BOM
  sigue siendo una estimación; puedes reinterpretar el archivo con el selector.
- Texto Unicode canónicamente equivalente, como una `é` y una `e` seguida de un
  acento combinado. El aviso distingue NFC y NFD; no modifica los caracteres.
- Caracteres invisibles, como un espacio no separable o de ancho cero. El aviso
  muestra el punto de código y las cantidades anterior y nueva, por ejemplo
  `U+200B (0 → 1)`.
- Renombrados y copias, con la ruta anterior y nueva e indicación de si también
  cambió el contenido.

Los cambios de espacios y tabuladores se representan directamente en el diff,
sin aviso adicional. Dentro de los fragmentos modificados, cada espacio aparece
como `␣` y cada tabulador lleva una flecha que abarca el ancho que ocupa. Son
marcas visuales: copiar y preparar conserva los caracteres originales.

La adición o eliminación del salto final tampoco muestra un aviso. Su fila vacía
se numera en el lado correspondiente: por ejemplo, `uno\ndos\ntres` termina en
la línea 3 y `uno\ndos\ntres\n` en la 4. El hueco del otro lado no recibe un
número ni una acción para preparar una línea inexistente de Git.

Los avisos se conservan en Staging, commits, stashes, comparaciones y vista de
archivo completo, incluso cuando «Ignorar cambios de espacios» oculta los hunks.
Si hay varios avisos, su lista se desplaza para dejar espacio al editor. El visor
no confunde texto con errores de decodificación con contenido equivalente.

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
