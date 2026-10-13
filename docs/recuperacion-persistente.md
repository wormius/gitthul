# Respaldos de emergencia y archivos temporales

GitThul administra por separado los archivos temporales que protegen sus
operaciones y los respaldos que permiten recuperar un repositorio perdido.
Encontrarás ambos en **Configuración → Respaldos y caché**.

## Archivos temporales

Las operaciones de GitThul guardan datos internos de recuperación para proteger
el estado local y permitir Deshacer/Rehacer. Estas capturas cubren el alcance de
cada operación; no son puntos de restauración del repositorio completo.

GitThul depura esos datos automáticamente. **Limpiar caché…** permite liberar
manualmente el espacio ocupado por archivos temporales que ya no se necesitan.
Conserva los datos de operaciones activas o sin finalizar y los respaldos de
emergencia. La limpieza no modifica tus repositorios.

## Cuándo se guarda un respaldo

Los respaldos automáticos están activados por defecto. Al abrir un repositorio,
GitThul programa una comprobación en segundo plano. La primera copia se prepara
sin bloquear la apertura de la vista. En las sesiones largas también se comprueba
si corresponde guardar otra versión.

Después del primer respaldo deben pasar al menos 24 horas para guardar otro, y
solo se crea si cambió el repositorio. Abrir y cerrar GitThul varias veces durante
el día no genera una copia por sesión.

La interfaz muestra el estado del respaldo y la fecha del último punto terminado.
Una copia en cola o en curso todavía no es un punto disponible para restaurar.
Si falla una captura, el punto anterior se conserva. Si se detectan respaldos
dañados, GitThul avisa y suspende nuevas capturas y depuración para proteger sus
datos; los puntos independientes sanos siguen disponibles para restaurar.

## Qué incluye

Cada punto terminado contiene los datos Git necesarios para recuperar el historial,
las ramas, los tags, los stashes y el índice de staging, además de los archivos del
árbol de trabajo con seguimiento y los archivos sin seguimiento no ignorados. Los
archivos sin seguimiento ignorados, como una carpeta `node_modules` excluida por `.gitignore`, no
se incluyen. También se conserva la configuración local del repositorio y sus hooks.

Los datos se comprimen y los contenidos iguales se comparten entre puntos para
ahorrar espacio. Cada punto permite restaurar el repositorio completo sin depender
de los objetos Git originales ni de su remoto.

Un worktree se recupera como un repositorio independiente. Los objetos compartidos
con otros repositorios mediante almacenes locales también se incorporan al respaldo.
Los enlaces simbólicos se conservan como enlaces; no se copia el contenido externo
al que apuntan.

Los submódulos inicializados se respaldan con sus propios datos Git y archivos.
También deben estar disponibles los datos necesarios de sus versiones históricas.
Si un submódulo eliminado del proyecto queda fuera de los datos capturados, o
faltan archivos de alguna versión necesaria, GitThul rechaza el nuevo respaldo.
Los repositorios con Git LFS necesitan tener disponibles localmente los objetos de
las versiones guardadas; GitThul no los descarga durante el respaldo.

No se publica un punto completo para repositorios bare, clones superficiales o parciales, submódulos
sin inicializar o repositorios a los que les falten objetos LFS necesarios. También
se rechazan repositorios anidados sin seguimiento, archivos especiales, enlaces
simbólicos dentro de los datos Git y almacenes alternativos definidos mediante
variables de entorno, HTTP o rutas entre comillas. La interfaz indica el fallo y
conserva el último respaldo válido. Las credenciales globales y las llaves SSH
externas al repositorio no forman parte de estos respaldos.

## Espacio y conservación

El **Límite global de espacio** comienza en **1024 MiB (1 GiB)** y se comparte
entre todos los repositorios. Puedes modificarlo en esta sección o desactivar
los respaldos automáticos.

Mientras haya espacio, GitThul conserva hasta 7 versiones diarias, 4 semanales
y 3 mensuales. Un punto puede cubrir más de una categoría y no se duplica por
ese motivo. Se retiran las versiones antiguas para dar lugar a las nuevas.

El último respaldo válido de cada repositorio siempre se conserva, incluso si
dejas de abrirlo, lo olvidas en GitThul o borras su carpeta original. Por eso, al
reducir el límite, los respaldos protegidos pueden ocupar más espacio del permitido.

Si no queda sitio para un nuevo respaldo, GitThul lo indica y suspende esa captura.
Puedes ampliar el límite para que vuelva a realizarse. Un respaldo parcial nunca
se presenta como un punto completo.

## Restaurar un repositorio

1. Abre **Configuración → Respaldos y caché** y busca el repositorio en
   **Puntos de restauración de repositorios**.
2. Revisa la fecha y el tamaño del punto que quieres recuperar.
3. Pulsa **Restaurar en una carpeta nueva…** y confirma el punto elegido.
4. Elige la ubicación para crear la carpeta del repositorio restaurado.

La restauración siempre crea una carpeta nueva. No reemplaza una carpeta existente
ni modifica el repositorio original. Puedes usarla aunque el original y su remoto
ya no existan.

Los respaldos se guardan en los datos privados de GitThul, fuera del repositorio.
Para recuperar un punto, esa carpeta de datos debe seguir disponible. Si se pierde
el disco que contiene tanto el repositorio como los respaldos de GitThul, las
copias locales también se pierden.
