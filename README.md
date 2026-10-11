<div align="center">

# GitThul™

**Cliente gráfico de Git multiplataforma, de código abierto y claro.**

Linux · Windows · macOS — MIT

</div>

## Qué es

GitThul es una aplicación de escritorio que vuelve visibles el estado y las operaciones reales de
Git. Combina una experiencia gráfica completa con una terminal integrada, de modo que tanto el
trabajo cotidiano como las operaciones complejas pueden realizarse sin perder contexto.

La versión actual es **1.0.1**. No incluye telemetría ni una función de IA. Las conexiones de red
ocurren por acciones del usuario, como clonar, fetch, pull, push o abrir un enlace confirmado,
y por la consulta de versiones al iniciar si activas esa opción, desactivada por defecto.

## Funcionalidad actual

- Biblioteca de repositorios con recientes, favoritos, búsqueda, Espacios, apertura, creación,
  clonación y localización.
- Grafo e historial reales, ramas locales y remotas, tags, stashes, worktrees conocidos y
  selección contextual.
- Creación y apertura de worktrees, bloqueo/desbloqueo y eliminación sin forzar cambios locales.
- Estado, diff, stage y unstage, descarte, commits, amend y comparación de cambios.
- Creación, edición y eliminación de referencias; checkout, fetch, pull, push y varios remotos.
- Merge, rebase, cherry-pick, revert, reset, reflog, stash, deshacer/rehacer y resolución de
  conflictos.
- Terminal PTY con xterm.js, paneles divididos, sesiones por pestaña, búsqueda, enlaces seguros y
  grafo contextual del repositorio actual.
- Ajustes persistentes, siete temas con variantes Original, Minimalist y Dense en claro/oscuro,
  tres densidades, fuentes locales y cinco idiomas.
- Perfiles y cuentas Git con secretos almacenados únicamente en el llavero del sistema.
- Registros rotados, avisos de operación e historial de sesión.

Siguen pendientes mover y reparar worktrees, la administración completa de identidades, firmas GPG/SSH,
submódulos, Git LFS, bisect, blame y otras capacidades especializadas.

## Deshacer y rehacer

Los botones **Deshacer** y **Rehacer** de GitWorking (Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z)
recorren las operaciones recuperables de la sesión. Al pasar el puntero muestran la operación
siguiente. Los atajos dentro de los editores conservan su función de edición de texto.

Puedes recuperar cambios de preparación, descarte, commits, ramas, stashes e
integraciones como merge o rebase. Una nueva operación registrada invalida Rehacer.
Deshacer un commit normal conserva sus cambios preparados. Rehacer restaura el
resultado guardado sin volver a ejecutar hooks ni contactar al remoto.

Al terminar una sesión de terminal iniciada en un repositorio, se registra un paso
para volver al estado local de ese repositorio al abrir la sesión. La recuperación
no cubre efectos fuera del repositorio, archivos ignorados ausentes de la copia ni
acciones realizadas en servicios remotos. Los cambios posteriores incompatibles
pueden impedir restaurar un punto. Un push publicado limita Deshacer: corregir
historia compartida requiere Revertir y un nuevo push explícito.

El historial de los botones es de sesión. Las operaciones compuestas conservan
puntos en disco, en el directorio de datos de GitThul y separados por repositorio
y worktree. En **Configuración → Recuperación** puedes consultarlos después de
reiniciar, restaurarlos con vista previa y respaldo del estado actual, exportarlos
e importar las copias antiguas.

La depuración automática aplica límites de cantidad, antigüedad y espacio. Los
puntos activos y las operaciones pendientes están protegidos y pueden superar
esos límites. Las copias contienen datos locales y necesitan espacio en disco;
no sustituyen un respaldo completo del repositorio. Consulta la
[guía de recuperación](docs/recuperacion-persistente.md) para conocer el alcance,
los límites y las opciones de conservación.

## Instalación y ayuda

Los paquetes publicados están en [GitHub Releases](https://github.com/wormius/gitthul/releases).
Consulta las [notas de 1.0.1](docs/releases/1.0.1.md) y la
[guía de instalación](docs/instalacion.md) para elegir el paquete de tu sistema.
Revisa las [dependencias](docs/instalacion.md#dependencias), incluido Git instalado
y disponible en el sistema.

Puedes [reportar un problema](https://github.com/wormius/gitthul/issues) indicando
la versión, el sistema y los pasos para reproducirlo. Evita incluir credenciales
o datos privados de tus repositorios.

La [documentación de uso](docs/README.md) explica las funciones de la aplicación:

- [Atajos](docs/atajos.md) y [búsqueda](docs/busqueda-global.md).
- [Terminal integrada](docs/terminal.md) y [modificar el último commit](docs/amend.md).
- [Perfiles y accesos](docs/perfiles-y-accesos.md).
- [Registros y diagnóstico](docs/logs-diagnostico.md).
- [Puntos de recuperación](docs/recuperacion-persistente.md).
- [Avisos de versiones](docs/versiones-publicadas.md).

En **Configuración → Actualizaciones** puedes buscar versiones estables publicadas
en GitHub Releases y activar la consulta al iniciar. Si hay una versión más reciente,
GitThul ofrece un enlace para descargarla e instalarla fuera de la aplicación.

## Licencia

[MIT](LICENSE). Copyright © 2026 GitThul.

## Marca

GitThul™ y su logotipo se utilizan como marcas no registradas del proyecto. El símbolo ™
identifica ese uso de marca; no afirma que exista un registro.

La licencia MIT no concede derechos de marca. El uso del nombre o del logotipo no debe sugerir
que una versión derivada es oficial, está afiliada al proyecto o cuenta con su respaldo sin
autorización.

Política completa: [TRADEMARKS](TRADEMARKS.md). Las dependencias y fuentes mantienen
sus licencias según [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).
