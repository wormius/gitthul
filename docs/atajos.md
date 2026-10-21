# Atajos de teclado

`Mod` significa Ctrl en Linux y Windows, y Cmd en macOS. Puedes consultar los
atajos en **Configuración → Atajos**; los botones y menús también muestran las
combinaciones disponibles.

## Atajos de la aplicación

| Contexto     | Acción                     | Atajo                                   |
| ------------ | -------------------------- | --------------------------------------- |
| General      | Ir a Repositorios          | Mod+Shift+H                             |
| General      | Abrir terminal             | Mod+Shift+T                             |
| General      | Cerrar pestaña             | Mod+W                                   |
| General      | Pestaña siguiente/anterior | Mod+Alt+→ / Mod+Alt+←                   |
| General      | Búsqueda global            | Mod+P                                   |
| General      | Buscar en la vista actual  | Mod+F                                   |
| General      | Configuraciones            | Mod+,                                   |
| General      | Ayuda                      | F1                                      |
| Repositorios | Abrir carpeta              | Mod+O                                   |
| Repositorios | Crear repositorio          | Mod+N                                   |
| Repositorios | Clonar repositorio         | Mod+Shift+C                             |
| GitWorking   | Crear rama                 | Mod+B                                   |
| GitWorking   | Hacer commit               | Mod+Enter                               |
| GitWorking   | Deshacer/Rehacer           | Mod+Z / Mod+Shift+Z                     |
| GitWorking   | Crear stash                | Mod+Shift+S                             |
| GitWorking   | Fetch/Pull/Push            | Mod+Shift+G / Mod+Shift+P / Mod+Shift+U |
| Resolutor    | Bloque siguiente/anterior  | Alt+N / Alt+P                           |

**Buscar en la vista actual** filtra repositorios cuando estás en Repositorios,
archivos en GitWorking y salida en la terminal. **Abrir terminal** utiliza el
contexto activo o la carpeta seleccionada. La [búsqueda global](busqueda-global.md)
permite encontrar otras acciones sin memorizar un atajo para cada una.

## Al escribir texto

Deshacer y Rehacer dentro de un campo o editor modifican el texto de ese campo.
Fuera de ellos, los atajos de GitWorking actúan sobre el historial de operaciones
del repositorio. Puedes enviar el commit con Mod+Enter desde su resumen o
descripción.

Los diálogos, listas y menús conservan su navegación con Tab, flechas, Enter y
Escape. Las combinaciones de copiar y pegar en la terminal se describen en
[Terminal integrada](terminal.md).

En el visor de diff y en todos los editores de Resolver, **Mod+C** copia el texto
seleccionado y **Mod+A** selecciona todo el texto del panel enfocado. Ambas acciones
también están en su menú contextual. En Resolver puedes copiar desde A, B, el
resultado editable y las vistas de resultado resuelto y revisión, sin cambiar las
decisiones del conflicto.
