# Búsqueda global

Abre la búsqueda global con **Mod+P**: Ctrl+P en Linux y Windows, Cmd+P en macOS.
Permite encontrar repositorios, referencias, commits, archivos, opciones y
acciones. Cada resultado indica su categoría y repositorio.

La lista inicial muestra hasta diez coincidencias. Prioriza las coincidencias
exactas y los comienzos de palabra; ignora mayúsculas y tildes. Si dos resultados
coinciden por igual, da prioridad al contexto que tienes abierto. Puedes buscar
archivos por su nombre y autores por nombre o correo.

## Elegir el alcance

**Esta vista** es el alcance inicial:

- En GitWorking o una terminal vinculada a un repositorio, busca en el
  repositorio activo: ramas y otras referencias, worktrees, historial, autores,
  SHAs, cambios pendientes y archivos de HEAD. También incluye navegación y
  acciones.
- En Repositorios o una terminal independiente, busca espacios, repositorios,
  worktrees, navegación y acciones.
- En Configuraciones, busca secciones, opciones, navegación y acciones.

**Todo GitThul** añade los demás repositorios y destinos de la aplicación,
incluidos su historial, autores y archivos. Los archivos se buscan en HEAD de la
rama activa de cada repositorio; un archivo que existe solamente en otra rama no
aparece por esa vía. La búsqueda compara nombres, sin leer el contenido de los
archivos.

## Explorar resultados

La lista inicial reparte las coincidencias entre categorías. Usa **Ver Mensajes
de commits**, **Ver Ramas** u otra categoría para explorar sus resultados.
**Mostrar 10 resultados más** amplía la categoría elegida; **Volver a mejores
coincidencias** recupera la lista mixta.

El historial se explora por partes. La primera lista puede no contener todas las
coincidencias de un historial grande. Si quedan datos por explorar, la paleta lo
indica y permite continuar por categoría, incluso cuando todavía no haya
resultados. Mientras busca, aparece un indicador de actividad; un repositorio
inaccesible se muestra con un aviso.

Con la consulta vacía puedes navegar por la aplicación. Usa las flechas para
moverte por la lista; la selección se mantiene cuando llegan nuevos resultados.

## Abrir un resultado

Seleccionar una rama, un tag o un stash abre su contexto o detalle. Para cambiar
de rama o aplicar un stash debes elegir después la acción correspondiente.

Los archivos de la rama activa abren su historial y la versión más reciente.
Elegir otra versión cambia el diff. Los archivos con cambios pendientes abren
el visor de esos cambios. Elegir una opción de Configuraciones abre su sección
y lleva el foco al control.

Para filtrar directamente la vista abierta, utiliza **Mod+F**. Consulta los
[atajos de teclado](atajos.md) para el resto de combinaciones.
