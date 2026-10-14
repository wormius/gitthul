# Registros y diagnóstico

Los registros ayudan a entender una acción de GitThul y a reportar un problema.
Se guardan localmente; GitThul no los envía a un servidor. Puedes abrir el visor
desde **Configuración → Registros y diagnóstico → Ver registros**.

## Elegir qué registrar

El modo normal guarda avisos, errores y acciones importantes. Activa **Registrar
datos de debug** antes de reproducir un problema para añadir lecturas, tiempos
y otros pasos que ayuden a investigarlo. Desactivarlo detiene las nuevas entradas
de debug y conserva las que ya existen.

| Nivel | Qué significa                                                            | Cuándo se guarda   |
| ----- | ------------------------------------------------------------------------ | ------------------ |
| DEBUG | Pasos rutinarios y detalles para seguir una operación                    | Con debug activado |
| INFO  | Una acción importante completada                                         | Siempre            |
| WARN  | Una situación que necesita atención, como un conflicto o rechazo de push | Siempre            |
| ERROR | Una operación que no pudo completarse                                    | Siempre            |

Un aviso puede indicar que Git protegió cambios locales o que necesitas resolver
un conflicto. Lee el mensaje y la acción de recuperación indicada para conocer
su efecto.

## Buscar y exportar

En el visor puedes filtrar por nivel y ámbito, o buscar texto. Cada entrada puede
mostrar el repositorio, el resultado y la duración; **Datos técnicos** amplía la
información de la operación y su entorno.

Cada fallo conserva su código, el paso que falló, las causas internas disponibles
y un identificador que relaciona la operación con su diagnóstico nativo. Cuando
falla un comando Git, incluye sus argumentos protegidos, el código de salida
y `stderr`; un fallo de disco puede incluir el tipo de error y el código del
sistema. Los errores de JavaScript incluyen la traza disponible.

El fallo también incluye hasta 12 pasos anteriores del mismo repositorio y
operaciones globales, con su resultado y duración. Estos pasos no contienen
mensajes ni contenido de archivos. Esta información se conserva en modo normal;
debug añade las lecturas y resultados rutinarios al historial completo.

Los filtros cambian lo que ves, no lo que se registra. Exportar **avisos y
errores** conserva las incidencias; exportar **todos** incluye también los pasos
retenidos de los demás niveles. La búsqueda y los filtros del visor no recortan
la exportación.

El archivo es JSONL: cada línea es un objeto JSON. La primera línea,
`diagnostic.report`, resume el intervalo de tiempo, los niveles, las sesiones
y hasta 50 grupos de incidencias, con frecuencia, causa y una operación de
ejemplo. El entorno incluye versiones de GitThul y Git; en Linux también la
distribución, glibc y el tipo de sesión gráfica cuando estén disponibles.
Las líneas siguientes contienen las entradas seleccionadas sin eliminar
repeticiones. El formato 3 conserva la lectura de entradas antiguas.

## Reportar un problema

1. Si el problema ya ocurrió, exporta **avisos y errores**.
2. Si necesitas reproducirlo, activa debug antes de repetir los pasos.
3. Exporta **todos** después de reproducirlo para incluir el contexto anterior
   al fallo.
4. Desactiva debug cuando termines el diagnóstico.
5. Revisa el archivo y adjúntalo junto con los pasos, lo que esperabas y lo que
   ocurrió. Indica también la versión de GitThul y el sistema utilizado.

## Privacidad y conservación

GitThul omite mensajes de commit y stash, contenido de archivos, secretos de
credenciales, entrada y salida de la terminal, historial de comandos y contenido
del portapapeles. También elimina patrones conocidos de contraseñas y tokens
de los diagnósticos.
La protección se aplica al capturar, guardar y exportar; también protege las
entradas antiguas durante su lectura. Los argumentos libres que una herramienta
repita en un error se ocultan cuando GitThul conoce el valor original. Los
errores de parsers que contienen datos privados conservan su categoría y etapa
sin copiar esos datos.

Los registros pueden contener rutas locales, nombres de referencias y salida
de Git. Los hooks y otras herramientas pueden escribir información adicional;
revisa el archivo antes de compartirlo, porque no todos los datos sensibles
pueden identificarse automáticamente.

Los mensajes de diagnóstico se conservan en español técnico; los controles del
visor siguen el idioma de la interfaz. El visor muestra hasta las 100 entradas
más recientes que coinciden con sus filtros. Exportar **todos** incluye los
registros que todavía se conservan.

Los archivos rotan al alcanzar aproximadamente 2 MiB y se conserva una rotación
anterior. Por eso las entradas antiguas pueden dejar de estar disponibles. Un
cierre abrupto o un fallo de disco también pueden impedir guardar evidencia.
El reporte indica sus límites de conservación; los recortes, registros ilegibles
y fallos conocidos de almacenamiento se señalan explícitamente. Limpiar registros
también elimina el contexto de operaciones anteriores en memoria.
Los registros ayudan al diagnóstico, pero no sustituyen un respaldo del
repositorio.
