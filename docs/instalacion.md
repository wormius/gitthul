# Instalación y acceso desde el escritorio

Los paquetes publicados están en [GitHub Releases](https://github.com/wormius/gitthul/releases).
Utiliza el correspondiente a tu sistema y arquitectura. La sección
**Configuración → Actualizaciones** muestra la versión instalada y permite
[consultar nuevas versiones estables](versiones-publicadas.md). La consulta al
iniciar es opcional y está desactivada por defecto.

## Dependencias

Antes de abrir GitThul, revisa los requisitos de tu sistema. Los paquetes publicados
incluyen la aplicación compilada: para utilizarlos no necesitas instalar Node.js,
Rust ni herramientas de desarrollo.

| Dependencia                         | Cuándo se necesita                                                                | Cómo se obtiene                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git**                             | Para ejecutar las operaciones de los repositorios en todos los sistemas.          | Se instala en el sistema. Los paquetes DEB y RPM lo declaran como dependencia; el AppImage y los instaladores de Windows y macOS requieren que lo instales por separado.                      |
| **Microsoft Edge WebView2 Runtime** | Para mostrar la interfaz en Windows.                                              | El instalador comprueba su presencia y, si falta, intenta descargarlo e instalarlo. En ese caso necesita conexión a internet.                                                                 |
| **GTK 3 y WebKitGTK 4.1**           | Para mostrar la interfaz en Linux.                                                | El gestor de paquetes resuelve las dependencias del DEB o RPM. El AppImage incorpora estas bibliotecas.                                                                                       |
| **FUSE**                            | Para ejecutar normalmente el AppImage en Linux.                                   | Lo proporciona el sistema. Si no está disponible, puedes usar la alternativa de extracción descrita más abajo.                                                                                |
| **OpenSSH: `ssh` y `ssh-keygen`**   | Para acceder a remotos mediante SSH y crear o comprobar llaves SSH desde GitThul. | Se instala el cliente OpenSSH; no hace falta instalar un servidor SSH.                                                                                                                        |
| **Llavero del sistema**             | Para guardar contraseñas o tokens desde GitThul.                                  | Windows y macOS usan sus almacenes de credenciales. En Linux se necesita un servicio compatible con Secret Service, como GNOME Keyring, disponible y desbloqueado en la sesión de escritorio. |

GitThul busca `git`, `ssh` y `ssh-keygen` en el `PATH`: la lista de carpetas donde
el sistema busca los programas. Después de instalar estas herramientas, cierra
GitThul por completo y vuelve a abrirlo para que reciba el entorno actualizado.

### Windows

Instala [Git for Windows](https://git-scm.com/install/windows). Durante la
instalación, permite usar Git desde la línea de comandos y aplicaciones de
terceros, para que GitThul pueda encontrarlo. Si ya tienes WinGet, también puedes
instalarlo desde PowerShell:

```powershell
winget install --id Git.Git -e --source winget
```

Para utilizar SSH, comprueba que `ssh` y `ssh-keygen` estén disponibles desde
PowerShell. Si faltan, instala **Cliente OpenSSH** desde las características
opcionales de Windows; consulta las
[instrucciones de Microsoft](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse).

Si la instalación de WebView2 falla o necesitas preparar un equipo sin conexión,
puedes obtener el instalador independiente desde
[Microsoft Edge WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### macOS

Una opción para instalar Git es usar las herramientas de línea de comandos de
Apple. Abre Terminal y ejecuta:

```bash
xcode-select --install
```

Si ya utilizas Homebrew, otra opción es `brew install git`. Consulta las
[opciones de instalación de Git para macOS](https://git-scm.com/install/mac).
OpenSSH suele estar disponible en el sistema; compruébalo si vas a utilizar SSH.
La interfaz utiliza el componente web de macOS y no requiere instalar WebView2.

### Linux

Instala Git con el gestor de paquetes de tu distribución. Por ejemplo:

```bash
# Debian, Ubuntu y derivadas
sudo apt install git

# Fedora
sudo dnf install git
```

Si vas a utilizar SSH, instala también el cliente correspondiente:

```bash
# Debian, Ubuntu y derivadas
sudo apt install openssh-client

# Fedora
sudo dnf install openssh-clients
```

En otras distribuciones, consulta las
[opciones de instalación de Git para Linux](https://git-scm.com/install/linux)
y los paquetes del cliente OpenSSH de tu distribución.

Para DEB y RPM, utiliza el gestor de paquetes para instalar el archivo descargado
y resolver sus dependencias. En Debian y Ubuntu, el DEB declara
`libgtk-3-0` y `libwebkit2gtk-4.1-0`, además de Git. En distribuciones que usan RPM,
los nombres de los paquetes pueden variar: se requieren GTK 3 y WebKitGTK 4.1.

El AppImage incorpora sus bibliotecas gráficas, pero necesita un entorno de
escritorio y los componentes básicos del sistema. Git y el cliente SSH se obtienen
del sistema. Si usas un escritorio mínimo y quieres guardar secretos desde
GitThul, configura también un llavero compatible con Secret Service.

### Comprobar las herramientas

Abre una terminal nueva, o PowerShell en Windows, y ejecuta:

```bash
git --version
```

Debe mostrar una versión de Git. Si aparece «comando no encontrado» o «no se
reconoce», instala Git o revisa su disponibilidad en el `PATH`.

Para SSH, comprueba también `ssh -V`. Puedes verificar la ubicación de ambas
herramientas con estos comandos:

```powershell
# Windows: PowerShell
Get-Command ssh, ssh-keygen
```

```bash
# macOS y Linux
command -v ssh ssh-keygen
```

Si las herramientas funcionan en una terminal externa pero GitThul no las
encuentra, revisa el `PATH` de la sesión desde la que abres la aplicación. Una
configuración que solo se carga al abrir tu shell puede no llegar a las
aplicaciones del menú de escritorio. Reinicia la sesión si los cambios del
entorno todavía no se han aplicado.

Si GitThul no puede guardar credenciales, comprueba que el llavero esté disponible
y desbloqueado. Consulta también la guía de [perfiles y accesos](perfiles-y-accesos.md).

## Windows y macOS

En Windows, abre el instalador `.exe` o `.msi` y sigue sus pasos. Después puedes
abrir GitThul desde el menú Inicio y fijarlo a la barra de tareas.

En macOS, abre el `.dmg`, arrastra GitThul a Aplicaciones y ábrelo desde allí.
Puedes conservar su acceso en el Dock.

Elige `aarch64` para Apple Silicon o `x64` para Intel. Los paquetes de Windows
son para x64. En `1.2.0`, Windows no usa un certificado comercial y macOS usa
firma ad hoc, sin notarización de Apple; el sistema puede mostrar avisos o
impedir su apertura según su política de seguridad.

Cada release incluye `SHA256SUMS.txt` para comprobar las sumas SHA-256 de las
descargas. Esa comprobación detecta diferencias respecto al archivo publicado;
no sustituye una firma digital.

## Linux: DEB y RPM

Instala el archivo `.deb` o `.rpm` con el gestor de paquetes de tu distribución.
Después abre **GitThul** desde el menú de aplicaciones. Puedes fijarlo al dock o
a la barra de tareas de tu escritorio.

Si GitThul ya estaba abierto durante la instalación, ciérralo y vuelve a abrirlo
para utilizar la versión nueva.

## Linux: AppImage

Guarda el AppImage en una carpeta estable, dale permiso de ejecución desde las
propiedades del archivo y ábrelo. Es portable: ejecutarlo no añade por sí solo
un acceso al menú de aplicaciones ni instala iconos en el escritorio.

Puedes usar una herramienta de integración de AppImage para importar el acceso
y los iconos incluidos. Conserva el archivo en su ruta elegida para que el
acceso siga funcionando.

### Si el AppImage no puede usar FUSE

Si al abrirlo aparece un error de FUSE, consulta la
[guía de FUSE de AppImage](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)
para tu distribución. Como alternativa, ejecuta el archivo desde la carpeta
donde lo guardaste, sustituyendo el nombre si es distinto:

```bash
./GitThul_1.2.0_amd64.AppImage --appimage-extract-and-run
```

Esta opción extrae los archivos temporalmente, ejecuta la aplicación y limpia
la extracción al cerrarla. Requiere espacio temporal y puede tardar más en
arrancar. Las demás dependencias, como Git, siguen siendo necesarias.

### Integración manual del AppImage

Si prefieres crear el acceso manualmente, extrae el AppImage desde una carpeta
temporal con este comando, sustituyendo la ruta por la de tu archivo:

```bash
/RUTA/ABSOLUTA/GitThul.AppImage --appimage-extract
```

La extracción crea `squashfs-root`. Utiliza su archivo `GitThul.desktop` y los
iconos incluidos:

1. Copia el lanzador como `org.gitthul.GitThul.desktop` a
   `~/.local/share/applications/`. Si has personalizado `XDG_DATA_HOME`, utiliza
   su subcarpeta `applications`.
2. Edita `Exec` para que contenga la ruta absoluta del AppImage entre comillas.
   Añade `TryExec` con esa ruta absoluta sin comillas. En rutas con caracteres
   especiales, respeta el formato de los archivos `.desktop`.
3. Copia los iconos de `squashfs-root/usr/share/icons/hicolor/` a
   `~/.local/share/icons/hicolor/`, conservando subcarpetas y nombres. Si usas
   `XDG_DATA_HOME`, utiliza su subcarpeta `icons/hicolor`. Mantén `Icon=gitthul`
   en el lanzador.
4. Si tu escritorio dispone de `update-desktop-database`, úsalo para actualizar
   el menú. Puedes actualizar los iconos con
   `gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor`, usando la ruta
   correspondiente si cambiaste `XDG_DATA_HOME`.
5. Abre GitThul desde el menú y fija ese acceso al dock o a la barra de tareas.

El nombre `org.gitthul.GitThul.desktop` permite al escritorio asociar la ventana
con el lanzador. Si mueves o renombras el AppImage, actualiza `Exec` y `TryExec`.
