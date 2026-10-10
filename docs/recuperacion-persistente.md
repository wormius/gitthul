# Recuperación persistente

GitThul guarda puntos de recuperación para proteger los archivos y el estado Git
que ciertas operaciones pueden cambiar. Puedes revisarlos después de cerrar la
aplicación o de una interrupción, incluidos cambios que todavía no tenían commit.
Cada punto cubre los archivos y el estado que muestra su vista previa.

## Abrir la recuperación

En **Configuración → Recuperación** puedes consultar los puntos guardados, su
repositorio, tamaño y estado. Si hay puntos pendientes de revisar, GitThul avisa
al iniciar. Nunca restaura un punto automáticamente.

Las copias se guardan en la carpeta privada de GitThul, fuera de los repositorios.
Usa **Abrir carpeta de recuperación** para localizarla en tu sistema. En Linux,
con la configuración habitual, es
`~/.local/share/org.gitthul.GitThul/recovery/`.

Cada repositorio o worktree tiene sus propios puntos. Un clon nuevo creado en una
ruta que usaba otro repositorio no hereda automáticamente los puntos anteriores.

## Configurar la conservación

En la misma sección puedes ajustar:

| Opción                           | Valor inicial    |
| -------------------------------- | ---------------- |
| Depuración automática            | Activada         |
| Máximo de puntos por repositorio | 100              |
| Antigüedad máxima                | 30 días          |
| Espacio máximo por repositorio   | 1024 MiB (1 GiB) |

Una operación puede guardar más de un punto, por ejemplo antes y después de
cambiar el repositorio. Por tanto, 100 puntos no equivalen a 100 operaciones.

**Depurar ahora** elimina las copias elegibles que superan tus límites; no cambia
los archivos ni el estado Git del repositorio. Desactivar **Depuración
automática** conserva la posibilidad de depurar manualmente.

La depuración conserva los puntos pendientes, los importados sin finalizar y
los que aún necesitan Deshacer/Rehacer o una vista previa. Por eso los límites
pueden superarse. Las copias incompletas o dañadas también se conservan para que
puedas revisarlas. El límite de espacio se aplica a las copias externas, no al
tamaño del propio repositorio Git.

Si no se puede leer la configuración, la depuración automática queda suspendida
y aparece un aviso. Guarda ajustes válidos antes de volver a activarla.

## Restaurar un punto

1. Selecciona un punto y pulsa **Restaurar…**.
2. Revisa la vista previa. Indica los archivos afectados y si también reemplaza
   el índice de staging y las referencias Git capturadas. Los cambios posteriores
   dentro de ese alcance se sustituirán por el estado guardado.
3. Confirma con **Crear respaldo y restaurar**. GitThul guarda primero un punto
   del estado actual.
4. Si el repositorio cambia después de preparar la vista previa, vuelve a
   revisarla: la restauración se rechaza antes de escribir.

Una restauración completada se añade al historial de la sesión y puede
deshacerse. Si se interrumpe, el respaldo previo queda disponible para recuperar
el estado que se estaba reemplazando después de reiniciar.

Las vistas previas caducan a los quince minutos. Si cancelas, no se restaura el
repositorio; el respaldo creado para la vista previa queda sujeto a la
conservación habitual. Si una copia está incompleta, inaccesible o ya no coincide
con el repositorio, revisa el aviso y sus detalles antes de volver a intentarlo.

## Exportar, importar y eliminar copias

**Exportar archivos…** crea una carpeta nueva en el destino elegido, sin
sobrescribir archivos existentes. Puedes exportar las copias aunque el
repositorio original ya no esté disponible. Para recuperar commits o stashes
también se necesitan los datos Git originales: la exportación no sustituye un
respaldo completo del repositorio.

**Importar puntos existentes** permite elegir un repositorio que conserva puntos
antiguos en `.git/gitthul-recovery`. GitThul comprueba las copias y las incorpora
a su carpeta de recuperación. El origen se conserva y repetir la importación
no duplica puntos idénticos.

**Eliminar copia…** pide confirmación y elimina solo el punto guardado, sin
modificar el repositorio. Una copia eliminada ya no puede recuperarse desde
GitThul. Los puntos en uso por Deshacer/Rehacer o una vista previa no pueden
eliminarse mientras sigan protegidos.

Mover o borrar un repositorio puede impedir restaurar sus puntos directamente.
Las copias externas pueden seguir disponibles para exportarlas y recuperar
archivos manualmente. Los puntos de recuperación tampoco deshacen cambios
fuera del repositorio ni operaciones ya publicadas en un servicio remoto.
