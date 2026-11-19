# Resolver conflictos

Cuando una operación deja archivos en conflicto, abre un archivo de la lista
**En conflicto** para comparar las dos versiones arriba y construir el resultado
abajo. Los encabezados identifican las ramas o revisiones de cada lado.

Las partes compatibles se incorporan automáticamente. Cada bloque pendiente
permite tomar líneas, un lado completo o ambos lados en el orden elegido.
También puedes escribir en el resultado. Los controles de bloque anterior y
siguiente recorren los bloques conflictivos aunque estén fuera de la pantalla.

El alineado conserva las partes idénticas dentro de los cambios, incluso cuando
ambas ramas crearon el archivo por separado o escribieron contenido común nuevo.
En cambios extensos con muchas repeticiones puede haber varias alineaciones
posibles; revisa el resultado antes de guardarlo.

## Archivos de Windows y finales de línea

LF y CRLF se alinean por el contenido de cada línea. Una conversión de
terminadores no convierte por sí sola todo el archivo en un bloque conflictivo.
GitThul conserva los terminadores de las partes incorporadas y de las líneas
elegidas; abrir el editor no convierte el archivo completo.

Si una rama cambia el terminador y la otra modifica esa misma línea, el bloque
localizado sigue requiriendo una decisión. Añadir o quitar el salto final también
puede entrar en conflicto con contenido agregado al final del archivo.

## Cancelar y guardar

**Cancelar** vuelve a las listas y conserva en esta sesión las selecciones, el
texto escrito y el bloque activo. Puedes abrir otro archivo y regresar. Si las
versiones del conflicto cambian externamente, las decisiones anteriores dejan
de aplicarse. Cambiar la codificación requiere confirmar el descarte cuando hay
decisiones pendientes. Estos borradores no sobreviven al cierre de la aplicación.

Cuando no queden bloques pendientes, **Marcar como resuelto** escribe el resultado
y lo prepara en el Stage. Si falla, el resolutor conserva el trabajo para corregir
el problema y reintentar. Tras resolver los archivos, puedes terminar la operación
Git desde las listas. **Abortar** cancela la operación según el estado real del
repositorio; la recuperación de un stash automático tiene su propio alcance,
descrito en la [guía de recuperación](recuperacion-persistente.md).

## Archivos que requieren otro recorrido

Los binarios, archivos que superan el límite del editor y conflictos con una
versión eliminada ofrecen conservar una versión completa.

Los enlaces simbólicos también se resuelven eligiendo una versión completa, para
conservar el enlace. Para un conflicto de submódulo, vuelve a las listas, resuélvelo
desde la terminal y después márcalo como resuelto. El editor de texto no reemplaza
estos tipos especiales por archivos normales.
