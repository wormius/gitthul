# Terminal integrada

Abre una terminal con **Mod+Shift+T**: Ctrl+Shift+T en Linux y Windows,
Cmd+Shift+T en macOS. Utiliza el contexto activo o la carpeta seleccionada. Los
comandos se ejecutan en un shell real y pueden modificar los archivos y el estado
Git de esa carpeta.

Durante el inicio aparece **Preparando la terminal…** con una barra de progreso.
En repositorios grandes, la preparación puede tardar mientras se guarda el punto
de recuperación. Puedes seguir usando la aplicación o cerrar la pestaña para
cancelar el arranque. El shell acepta comandos cuando termina la preparación.

El panel de referencias muestra una barra de carga mientras lee y prepara el
historial, y al cargar más commits cuando te acercas al final. Puedes escribir
y ejecutar comandos mientras se prepara el grafo. Si la lectura falla, el panel
muestra el error y ofrece **Reintentar** sin cerrar la terminal.

En el grafo lateral, los commits se representan con anillos huecos, el WIP con
un círculo sólido y los stashes con cuadrados sólidos. Las ramas se distinguen
por sus colores; cambiar de rama no cambia la forma de los commits. Las conexiones
entre commits son continuas. Los enlaces del WIP y los stashes con el historial
son finos y punteados.

En Unix, GitThul abre el shell configurado para tu cuenta. Cuando utilizas zsh,
este carga su configuración habitual, incluidos los plugins de Oh My Zsh. La
terminal admite color y ajusta sus dimensiones al tamaño del panel y de la
fuente.

## Copiar y pegar

El clic derecho abre un menú con **Copiar**, **Pegar** y **Seleccionar todo**.
Selecciona texto para copiarlo. Pegar envía el contenido del portapapeles al shell
sin añadir Enter.

| Sistema         | Copiar                     | Pegar                       |
| --------------- | -------------------------- | --------------------------- |
| Linux y Windows | Ctrl+Shift+C o Ctrl+Insert | Ctrl+Shift+V o Shift+Insert |
| macOS           | Cmd+C                      | Cmd+V                       |

**Ctrl+C** copia cuando hay texto seleccionado; sin selección llega al shell
para interrumpir el comando. **Ctrl+V** en Linux y Windows conserva su función
en el shell.

También puedes abrir el menú con Shift+F10 o la tecla de menú contextual. Al
cerrarlo, el foco vuelve a la terminal. Si la sesión ha terminado, Pegar queda
deshabilitado. Los fallos al acceder al portapapeles aparecen como avisos.

## Buscar y trabajar en el panel

**Mod+F** busca en la salida de la terminal. Puedes redimensionar o dividir el
panel mientras trabajas; el shell recibe el tamaño nuevo.

Los comandos, el autocompletado y las sugerencias dependen de tu shell y su
configuración. Si una sugerencia o el prompt se dibujan incorrectamente, conserva
los pasos que provocan el problema y usa la guía de
[registros y diagnóstico](logs-diagnostico.md) para reportarlo. Los registros de
GitThul no guardan el contenido de la terminal ni tu historial de comandos.
