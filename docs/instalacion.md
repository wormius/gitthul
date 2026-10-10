# Instalación y acceso desde el escritorio

Los paquetes publicados están en [GitHub Releases](https://github.com/wormius/gitthul/releases).
Utiliza el correspondiente a tu sistema y arquitectura. La sección
**Configuración → Actualizaciones** muestra la versión
instalada; la [consulta de nuevas versiones](versiones-publicadas.md) todavía
no está disponible.

GitThul necesita Git instalado y disponible en el sistema para ejecutar las
operaciones del repositorio. Para generar llaves SSH desde la aplicación también
necesitas OpenSSH.

## Windows y macOS

En Windows, abre el instalador `.exe` o `.msi` y sigue sus pasos. Después puedes
abrir GitThul desde el menú Inicio y fijarlo a la barra de tareas.

En macOS, abre el `.dmg`, arrastra GitThul a Aplicaciones y ábrelo desde allí.
Puedes conservar su acceso en el Dock.

Elige `aarch64` para Apple Silicon o `x64` para Intel. Los paquetes de Windows
son para x64. En `1.0.0`, Windows no usa un certificado comercial y macOS usa
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
