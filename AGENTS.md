# GitThul

GitThul es un cliente gráfico de Git de escritorio, multiplataforma y de código abierto.
Su propósito es hacer visibles el estado real y las operaciones de Git, con una
interfaz clara, terminal integrada y mecanismos de recuperación. La red responde
a acciones del usuario o preferencias explícitas; no introducir telemetría.
No incluye una función de IA dentro de la aplicación.

La búsqueda de actualizaciones consulta únicamente versiones estables publicadas
en GitHub Releases de wormius/gitthul. Se activa manualmente o mediante la
preferencia de consulta al iniciar, desactivada por defecto. No hay canales beta.
Las preferencias antiguas de canal se descartan al normalizar ajustes.
LinkPort.checkRelease no recibe argumentos; el backend compara SemVer y valida
el enlace exacto al tag oficial. Los fallos de red, HTTP o datos se muestran como
errores que permiten reintentar. No descargar, instalar ni reiniciar automáticamente.

UpdateOptInBridge ofrece activar la consulta después de 10 segundos, como máximo
una vez por sesión, sin consultar red. updates.promptDismissed suprime la oferta;
updates.nextPromptAt guarda en milisegundos el siguiente recordatorio. Persistir
un plazo de siete días antes de mostrar el aviso, incluso si se cierra la app sin
responder. Activar guarda la preferencia y usa ReleaseNotificationBridge para la
primera consulta; posponer o cerrar con × aplaza siete días hasta otra apertura.
Desactivar manualmente o restablecer Actualizaciones también suprime propuestas.
Los parches de updates deben completar flush; comprobar de nuevo las preferencias
actuales después de esperas y no mostrar avisos tras desmontar el bridge.
ToastProvider admite varias acciones asíncronas: espera el guardado, evita doble
ejecución y conserva el aviso ante fallos. onDismiss distingue close, timeout,
action y programmatic; una retirada programática nunca cambia la preferencia.

El código propio se distribuye bajo MIT. GitThul™ y su logotipo tienen una política
de marca separada, documentada en TRADEMARKS.md; los avisos de terceros se
conservan. Usar ™ en presentación de marca y reservar ® para un registro
confirmado. Los nombres técnicos, paquetes y rutas no llevan símbolos de marca.
Los textos de licencias de terceros están en THIRD_PARTY_NOTICES.md y licenses/.

## Arquitectura

- Escritorio: Tauri 2; backend Rust; lectura estructurada con gitoxide.
- Escrituras Git, hooks y red: Git CLI, respetando la configuración del usuario.
- Frontend: React 19, TypeScript estricto, Vite 7 y Zustand.
- Listas y grafos: TanStack Virtual; editores y diff: CodeMirror 6.
- Terminal: xterm.js y portable-pty; secretos: keyring del sistema.
- Pruebas: Vitest, Testing Library, jsdom y pruebas Rust con repos temporales.

src/app contiene shell, pestañas, proveedores y acciones globales.
src/features contiene repositorios, GitWorking, Resolver, Terminal y Configuración.
src/core/domain define datos y reglas; src/core/ports, contratos; los adaptadores
mock y Tauri implementan los mismos puertos. src/ui ofrece componentes compartidos
y galería. src/design reúne tokens, temas, variantes, densidad y fuentes locales.
src/i18n contiene los cinco catálogos; src/test, utilidades de pruebas.
src-tauri/src contiene Git, PTY, autenticación, persistencia, watchers y sistema.
src-tauri/capabilities contiene permisos; src-tauri/icons, activos de empaquetado.
src/assets/brand/logo.svg es el maestro del logotipo utilizado por la aplicación.

React consume los puertos de src/core/ports; las llamadas nativas pertenecen a sus
adaptadores Tauri. Los adaptadores mock permiten desarrollar y probar la interfaz
sin repositorios reales. Mantener ese contrato compartido, sin accesos directos
al sistema desde las vistas ni permisos globales del WebView para suplirlo.

## Antes de trabajar

Leer el estado Git, el diff y las instrucciones vigentes. Respetar cambios ajenos
y mantener el alcance solicitado. No deducir funciones actuales de referencias a
fases antiguas en comentarios; contrastarlas con código y pruebas. Identificar los consumidores compartidos y
seguir el contrato completo antes de cambiar una operación.

README presenta el producto y docs/ contiene exclusivamente ayuda para el usuario
final. Este AGENTS reúne las instrucciones técnicas necesarias para trabajar sobre
el código; mantenerlo actualizado al cambiar contratos o requisitos cruciales.
La documentación extensa de desarrollo, planes y herramientas particulares de
diagnóstico se conserva fuera de este repositorio. No añadir scripts de experimentos
o escenarios manuales a Producto ni convertirlos en requisitos de sus comprobaciones.
Este repositorio debe poder desarrollarse solo con sus archivos y herramientas
documentadas. No introducir dependencias de directorios privados externos.

## Invariantes de Git y privacidad

El repositorio en disco es la fuente de verdad. No deducir éxito de una vista,
banner o estado de interfaz sin comprobar el resultado Git cuando corresponda.
Preservar la serialización por repositorio, la revalidación previa a escrituras y
las protecciones frente a cambios concurrentes, worktrees y pérdida de datos.

No sustituir errores significativos por éxito ni confundir cancelación con fallo.
Cuando cambie un puerto, actualizar dominio, mock, adaptador Tauri, backend y
consumidores afectados. Los secretos recordados usan el llavero; las llaves SSH
privadas permanecen en los archivos seleccionados por el usuario, fuera del repo.
No persistir credenciales efímeras ni incluir secretos o datos reales innecesarios
en registros y fixtures.

La comparación lista diferencias netas mediante GitPort.readDiffFiles con el mismo
DiffSource que readDiff. No formar esa lista uniendo archivos tocados en commits:
historias distintas pueden terminar en árboles idénticos. En range, from=null
representa el árbol vacío para selecciones que incluyen el commit raíz. Los dos
extremos históricos deben fijarse a SHAs antes de listar y abrir sus archivos;
workingRange compara esa revisión con el estado actual completo del árbol de trabajo.

WorkingView invalida las lecturas anteriores al comenzar una escritura. Los avisos
del watcher recibidos durante la operación se acumulan y se consultan al terminar;
una respuesta tardía no puede reemplazar el estado devuelto por stash, POP o Stage.

El diff de un stash usa DiffSource.stash: la instantánea rastreada y el tercer padre
para las rutas sin seguimiento. El visor de archivo lee el blob que resolvió el diff,
también para archivos truncados; no buscar esos archivos en disco ni en el árbol
rastreado del stash. DiffSource.commit conserva la comparación contra el primer padre.

Las pruebas de escritura usan repositorios descartables. No experimentar con
reset, limpieza o recuperación destructiva sobre repositorios del usuario.

La selección de Repositorios usa selectedIds, únicos entre listas y espacios.
selected solo contiene un repositorio si la selección es singular. Filtrar y
recargar descartan los IDs ocultos o retirados. Abrir/olvidar por lotes procesa
los IDs en orden, evita duplicados y conserva los errores por entrada; olvidar
retira entradas del catálogo sin borrar carpetas ni historial de Git.
El arrastre guarda una copia de los repositorios seleccionados al comenzar.
Los lotes se agregan sin retirar membresías anteriores; el arrastre singular
desde una tarjeta conserva su traslado. Agregar o crear un espacio con un lote
persiste miembros y navegación en una sola escritura de LibraryPort.
Quitar repositorios recibe un espacio concreto y elimina solamente sus membresías,
en una escritura. Cada acción afecta a un espacio a la vez.
Los menús de tarjetas reciben el ID de su espacio; no deducir ese destino de
library.view, que puede apuntar a otra zona. El catálogo y las pestañas se conservan.

## Recuperación y persistencia

El historial de Deshacer/Rehacer es de sesión. Las operaciones compuestas usan
checkpoints persistentes; las capturas locales pequeñas siguen en memoria. Mantener
capturas de alcance limitado para operaciones predecibles y completas para terminal,
integraciones, hooks, auto-stash y otras escrituras cuyo alcance no se conoce antes.
Cubrir colisiones con ignorados, flags del índice y los tres padres de un stash.

src-tauri/src/git/recovery_store.rs guarda las copias bajo
app_local_data_dir()/recovery, separadas por gitdir e identidad de instancia.
Resolver gitdir y common-dir mediante Git: un worktree puede tener un archivo .git
y referencias/configuración compartidas. Un repositorio recreado en la misma ruta
no debe heredar automáticamente copias de otra instancia.
Al comprobar pertenencia de un worktree, exigir una ruta absoluta y comparar
también las rutas canónicas existentes. Git puede devolver /private/var en macOS
o una forma distinta de la ruta Windows. Conservar las protecciones de principal,
actual, bloqueo y trabajo pendiente al aceptar un alias del mismo directorio.

Las capturas operativas son internas, con depuración automática predeterminada
(100 puntos, 30 días y 1024 MiB por repositorio); los valores recovery heredados
se validan para conservar configuraciones inválidas, pero no son controles de UI.
Los límites son blandos: nunca eliminar puntos activos, pendientes, parejas
incompletas ni copias referidas por una restauración interrumpida. Ante corrupción
o ambigüedad, conservar el almacén afectado. No depurar refs/gitthul/undo/objects/:
pueden proteger puntos antiguos y otros worktrees. recovery_read y recovery_cleanup
solo sirven al resumen y limpieza manual de caché; no exponer restauración,
importación o exportación de capturas individuales por IPC.

Los respaldos de emergencia son independientes de la caché operativa.
backup_store.rs guarda manifiestos y chunks comprimidos/deduplicados bajo
app_local_data_dir()/backups. Un punto publicado debe ser autónomo: datos Git,
índice, trabajo local y archivos sin seguimiento no ignorados, con worktrees
normalizados a repositorios independientes, objetos alternativos locales,
submódulos inicializados y objetos LFS necesarios. No presentar como completo
un repositorio bare, clone superficial/parcial, submódulo ausente, LFS incompleto o configuración
externa no cubierta. Preservar symlinks como enlaces, sin recorrer sus destinos.
En Windows, codificar las claves relativas del inventario y manifiesto con /
para que rutas recorridas y sintéticas representen una sola entrada. Conservar
la representación nativa de rutas absolutas y destinos de symlinks. La validación
sigue rechazando entradas equivalentes duplicadas. Desactivar hooks al verificar
mediante una carpeta vacía real, nunca un dispositivo NUL. Los fixtures Git usan
un archivo global inexistente de su carpeta en lugar de dispositivos del sistema.
Validar Git y contenido antes de publicar; restaurar exclusivamente en una carpeta
nueva, con rutas de manifiesto verificadas y sin reemplazar destinos existentes.
Una captura no debe ejecutar hooks, contactar al remoto ni mantener un bloqueo de
escritura Git durante toda la copia. Revalidar fuentes para rechazar cambios
concurrentes; cancelar al cambiar política o terminar la aplicación.

BackupSchedulingBridge programa las pestañas abiertas/restauradas sin bloquear
navegación. backup.rs ejecuta una sola tarea con prioridad baja: primera
comprobación tras 30 segundos, luego cada hora en sesiones largas, con mínimo
24 horas entre puntos nuevos y solo cuando hay cambios. La retención 7 diarios,
4 semanales y 3 mensuales comparte un límite GLOBAL de 1024 MiB iniciales;
sujeta a espacio, sin duplicar puntos entre categorías. Proteger indefinidamente
el último punto válido de cada repositorio aunque desaparezca, se olvide o quede
inactivo. La depuración global corre al arrancar y diariamente. Si no cabe una
copia completa, conservar la anterior e informar falta de espacio. La consulta
IPC devuelve metadatos en memoria, sin esperar compresión ni validación de datos.
Mantener un bloqueo de archivo del almacén durante su vida para impedir que otro
proceso elimine temporales de una captura activa. Una configuración ilegible
suspende también la depuración de respaldos hasta guardar una política válida.
Un manifiesto dañado no oculta respaldos independientes sanos; mostrar advertencia
y suspender eliminación/capturas ante contenido ambiguo. Limpiar caché nunca borra
respaldos. Mantener dominio, BackupPort, mock, adaptador Tauri, IPC y cinco idiomas
alineados y comprobar restauración con el repositorio fuente eliminado.

Los ajustes y biblioteca usan los directorios de configuración del usuario;
los logs, recovery y backups usan sus directorios de datos. Resolverlos con Tauri, sin rutas
personales fijas ni almacenamiento dentro del repositorio fuente. Una configuración
ilegible suspende la depuración automática y permite arrancar; conservar sus bytes
antes de repararla y mantener la suspensión al escribir otras preferencias.

## Acceso al sistema

Los comandos internos usan `process::command` para ejecutar Git, SSH y sus
auxiliares sin crear ventanas de consola en Windows (`CREATE_NO_WINDOW`).
Conservar los pipes, argumentos y códigos de salida de cada operación. El shell
interactivo usa `portable-pty`/ConPTY y no pasa por esta fábrica.
Al entregar el cwd al shell Windows, usar la forma de unidad o UNC sin prefijo
verbatim solo si resuelve al mismo directorio. Conservar el cwd canónico para
identidad y recovery; esta adaptación no elimina la limitación de CMD con UNC.

Leer la identidad efectiva de Git. Seleccionar un perfil escribe user.name/user.email
en la configuración local o de worktree; no pasar el perfil como autor de todos los
commits. Amend conserva el autor original salvo una acción explícita distinta.

Conservar los credential helpers y useHttpPath del sistema al consultar accesos.
Los accesos propios distinguen repositorio canónico y URL completa. No mezclar
autenticación SSH con firma de commits; quitar una llave del catálogo no borra su
archivo privado. Los auxiliares de autenticación usan credenciales ficticias al probarse.

El PTY ejecuta el shell del usuario; transportar bytes y secuencias ANSI sin reconstruir
comandos. Mantener TERM=xterm-256color, COLORTERM=truecolor y tamaño tomado del PTY.
Leer el portapapeles solo al pegar; Ctrl+C sin selección debe poder interrumpir.
La captura de recuperación y el arranque/cierre del PTY se ejecutan con
spawn_blocking. La terminal muestra progreso mientras prepara la sesión;
cerrarla durante ese periodo cancela su arranque. Conservar la captura completa
antes de abrir el shell y permitir sus respuestas de protocolo durante el inicio.
TerminalPaneTree mantiene los emuladores en una lista estable por pane.id y
mueve sus contenedores mediante portales al árbol de distribución. Dividir,
redimensionar o cerrar un vecino no debe desmontar las sesiones que sobreviven;
solo retirar un panel o cerrar la superficie libera su PTY.
Crear y detener observadores recursivos del repositorio también se ejecuta fuera
del hilo de la ventana, incluido el cambio entre GitWorking y Terminal.
En ConPTY, drenar la salida antes de redimensionar o escribir y mantener la
lectura hasta EOF incluso si se desconecta la UI: el cierre puede emitir un
último frame y bloquear Windows anteriores a 11 24H2 si nadie consume el pipe.
La prueba PTY sin interfaz responde la consulta inicial de cursor que activa
portable-pty con PSEUDOCONSOLE_INHERIT_CURSOR; en la aplicación responde xterm.
Los logs conservan errores útiles y redactan secretos antes de persistir o notificar;
no registrar contenido libre de archivos, credenciales, mensajes de commit, PTY o
portapapeles. Un fallo del logger no cambia el resultado de una operación Git.

## Convenciones

Seguir TypeScript estricto, imports de tipos explícitos, ESLint y Prettier ya
configurados. Seguir el estilo del módulo Rust y comprobar formato con cargo fmt.
Reutilizar puertos y componentes existentes. Mantener cambios funcionales y
refactorizaciones independientes cuando no sean necesarios para la misma tarea.
Conservar package-lock.json y Cargo.lock; no actualizarlos sin una causa del cambio.
Los módulos auxiliares compartidos usan nombres distintos de los componentes,
por ejemplo Menu.tsx y menuUtils.ts. No distinguir módulos únicamente por
mayúsculas o por .ts/.tsx: TypeScript puede resolverlos como el mismo archivo
en los sistemas de archivos habituales de Windows y macOS.

## Diseño e internacionalización

Usar tokens de src/design y patrones de src/ui; no añadir colores literales o
controles inconsistentes. Respetar temas, variantes, densidades y fuentes locales.
Comprobar teclado, foco, accesibilidad, paneles estrechos y edición de texto segura.
Los atajos no deben interceptar entrada normal ni composición de texto. No comunicar
un estado solo por color; mantener foco visible y contraste verificable.

El grafo de Terminal usa anillos para todos los commits. WIP es un círculo sólido
y stash un cuadrado sólido; las ramas se distinguen por tono. Las conexiones entre
commits son continuas; los enlaces WIP/stash son finos y punteados. Conservar el
dibujante compartido y la simbología especial al ajustar su paleta. El motor
conserva el tipo de cada enlace hasta el nodo de llegada; HEAD continúa hacia
sus padres con enlaces de rama normales.
Terminal usa DataGrid para compartir los anchos entre cabeceras y filas;
el separador Grafo/Mensaje reparte el espacio dentro del panel y recuerda
el ajuste mediante PaneStorage. No añadir una barra horizontal al grafo.
El progreso del grafo ocupa el espacio bajo el filtro mediante posición absoluta;
su aparición y desaparición no debe alterar la geometría de cabeceras ni filas.

Todo texto de la interfaz de usuario del producto usa i18n. Las muestras internas
de la galería conservan su convención actual; no requieren una traducción global
por esta reorganización. Mantener es-MX, es-ES, en, de y fr coherentes en claves,
parámetros, etiquetas, ayuda y menús. Usar terminología habitual de Git en cada
comunidad lingüística. Redactar cada idioma a partir del significado de la operación,
sin traducir mecánicamente desde español. Conservar términos reconocibles como
commit, stash, rebase, merge, fetch, pull, push, diff, tag, HEAD, upstream y worktree
cuando su comunidad los utiliza. Distinguir autor/committer, Stage/árbol de trabajo,
autenticación/firma y cancelar/rechazar/fallar. Los parámetros deben concordar entre
los cinco catálogos; src/i18n/i18n.test.ts comprueba claves, vacíos y placeholders.

## Desarrollo y validación

Las herramientas seleccionadas son Node.js 20.20.2 (en .nvmrc), npm 10.8.2 y
Rust/Cargo 1.97.0 (en rust-toolchain.toml), además de Git y las dependencias nativas
de Tauri 2 para la plataforma. rust-version = 1.89 declara el límite del grafo
y de File::try_lock para la exclusión del almacén entre procesos,
sin afirmar que se haya certificado como mínimo efectivo en todos los sistemas.
Python y Bash sirven a herramientas externas opcionales, no a las comprobaciones
ordinarias. OpenSSH proporciona ssh y ssh-keygen para los remotos y las funciones
de llaves SSH de la aplicación.
build.rs incorpora windows-common-controls.manifest mediante /MANIFESTINPUT
también a los ejecutables de pruebas Windows, como hace Tauri en su propio
workspace. En MSVC, WindowsAttributes::new_without_app_manifest conserva los
recursos de icono/versión y evita duplicar el manifiesto en resource.lib y el
enlazador. Evitar atributos con comillas anidadas en /MANIFESTDEPENDENCY: el
enlazador puede dividirlos en argumentos de archivos. Los recursos del binario
Tauri no alcanzan por sí solos los tests de la
librería. Los fixtures comparan rutas canónicas. Las pruebas de bytes no UTF-8
se ejecutan en todas las plataformas; los fixtures con nombres no UTF-8 en disco
excluyen macOS porque APFS/HFS+ rechaza esos nombres antes de que intervenga Git.
Los fixtures con bytes LF usan core.autocrlf=false o atributos eol=lf propios;
no dependen de la conversión global del runner Windows. Los nombres con tab o
salto de línea se prueban en disco únicamente donde el sistema los admite;
Windows conserva cobertura con nombres Unicode y espacios. Los IDs de recovery
del contrato usan / en todas las plataformas, incluidos los fixtures.
Al crear o clonar, usar el nombre de destino relativo al padre ya validado y
establecido como cwd. Git for Windows rechaza los destinos canónicos con prefijo
verbatim; conservar las rutas canónicas para identidad y comprobaciones de seguridad.

Instalar con npm ci. npm run dev usa mocks fuera de Tauri; npm run tauri dev
ejecuta el escritorio. El puerto fijo es 5183 y la galería está en /dev/tokens.

Desde la raíz: npm run typecheck, npm run lint, npm run format:check,
npm test y npm run build. Desde src-tauri: cargo fmt --all -- --check,
cargo check --locked y cargo test --locked.
La aplicación nativa se construye con npm run tauri build -- --no-bundle;
npm run tauri build crea paquetes locales según src-tauri/tauri.conf.json.
Los activos, lanzadores, fuentes y avisos de licencias se resuelven desde este
repositorio. Los binarios empaquetados funcionan sin Vite ni carpetas privadas.

.github/workflows/ci.yml valida versiones, SHA-256 y cobertura de avisos,
frontend y Rust en Linux x64, Windows x64 y macOS Intel/Apple Silicon. Sus
acciones se fijan por commit; contrastar las revisiones upstream al actualizarlas.
La versión Node sigue .nvmrc y Rust sigue rust-toolchain.toml. Los lockfiles son
obligatorios: npm ci, cargo --locked y tauri build pasando -- --locked a Cargo.
El CLI Tauri está fijado en 2.12.1 por las correcciones del empaquetador AppImage
para Mesa reciente y módulos GIO. Al actualizarlo, conservar las comprobaciones
del paquete: no incluir libwayland-client, no forzar X11 y cargar módulos GIO
del AppImage. CI genera y comprueba el AppImage en cada ejecución Linux, aunque
los demás instaladores se generen solo para Release. Verificar el arranque nativo
en un Linux reciente además de construir en el runner de compatibilidad Ubuntu 22.04.

.github/workflows/release.yml se activa con tags vX.Y.Z o manualmente con un tag
existente. Resuelve su commit, exige coincidencia con la versión y notas en
docs/releases/X.Y.Z.md, y reutiliza CI para construir todos los instaladores.
Solo tras pasar todos los jobs crea una release borrador con sumas SHA-256.
No modifica una release ya publicada. El token automático de GitHub basta;
contents:write se concede únicamente al job que prepara el borrador.
Windows no tiene certificado comercial; macOS usa firma ad hoc, sin notarización.
Revisar instalación nativa, avisos y fuentes de bibliotecas adicionales de AppImage
antes de publicar el borrador. No confundir compilación con pruebas de instalación.

Ejecutar las comprobaciones pertinentes al cambio y las requeridas para cerrar
su alcance. Las pruebas mock/browser no demuestran integración Git o conducta
nativa. Para cambios visuales, inspeccionar geometría renderizada y variantes
afectadas; para comportamiento de plataforma, probar en esa plataforma.

Para comprobar independencia, usar una copia o clon descartable con almacén Git
propio, sin alternates, symlinks privados, node_modules, dist, target ni gen heredados.
Instalar dependencias y construir desde sus archivos, con herramientas de sistema.
Comparar contenido, índice y referencias con Git CLI cuando se validen escrituras.
Usar remotos bare locales para comprobaciones de red; no sustituirlas por cuentas
o repositorios personales. Los scripts de escenarios particulares son opcionales
y ninguna validación ordinaria de Producto puede depender de su ubicación externa.

## Entrega de cambios

Explicar el problema, el comportamiento resultante, la validación y los límites
reales. Actualizar contratos y documentación de comportamiento junto al código.
No registrar bitácoras personales, secretos o artefactos generados en el producto.
Conservar una historia comprensible y commits acordes al alcance solicitado.
Las ramas de agentes usan codex/ salvo indicación humana distinta. Mantener la
documentación de uso junto al comportamiento; los registros de ejecución y criterios
detallados de investigación quedan fuera del producto.

La creación de un repositorio local no autoriza publicación, push, releases ni
distribución externa. Las pruebas ignoradas que necesitan red o un repositorio
externo solo se ejecutan cuando ese alcance esté autorizado.
