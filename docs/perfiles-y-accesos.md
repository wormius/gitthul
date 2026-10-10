# Perfiles y acceso a remotos

Los perfiles guardan nombre, correo y avatar. Puedes administrarlos en **Git,
perfiles y llaves** y seleccionar uno en el compositor para usar esa identidad
en el repositorio actual. El compositor también refleja la identidad configurada
en Git al abrir el repositorio y cuando cambia esa configuración.

Seleccionar un perfil cambia la identidad local de Git; no modifica los commits
anteriores. Al [enmendar el último commit](amend.md), se conservan su nombre y
correo de autor originales. En repositorios con worktrees, la identidad puede
ser compartida entre ellos o específica de cada worktree, según su configuración
Git.

## Elegir el acceso de un remoto

En el menú del remoto, abre **Editar el remoto** y elige:

- **Configuración del sistema**, para utilizar los accesos que Git ya usa en tu
  equipo.
- Un usuario/token de GitThul, para un remoto HTTPS.
- Una llave de GitThul, para un remoto SSH.

Si las direcciones de fetch y push son diferentes, puedes configurar sus accesos
por separado. Un acceso específico de GitThul tiene prioridad sobre el del
sistema para ese repositorio y remoto.

Cuando una operación HTTPS necesita credenciales, abre un diálogo. Introduce el
acceso y confirma para continuar; cancelar cancela la operación. Si el acceso
es rechazado, puedes introducirlo nuevamente. Al clonar, **Reintentar** conserva
la URL y el destino elegidos.

**Recordar para este repositorio** guarda el secreto en el llavero del sistema
después de que Git lo acepte. Si el llavero no está disponible, puedes continuar
sin recordarlo. **Olvidar acceso de GitThul** vuelve a utilizar la configuración
del sistema.

Los accesos recordados por GitThul se asocian al repositorio local y a la URL
remota completa. Otro clon o worktree tiene una asociación distinta. Cambiar la
URL no reutiliza un token guardado para el destino anterior. Los tokens que
introduces en GitThul no se guardan como accesos globales de Git.

## Registrar o generar una llave SSH

1. Abre **Git, perfiles y llaves**.
2. Registra una llave privada existente que tenga su archivo `.pub` al lado, o
   genera una llave Ed25519. Puedes proteger la llave nueva con una contraseña;
   generar sin contraseña requiere elegirlo explícitamente.
3. Copia la llave pública mostrada y regístrala en tu proveedor Git.
4. Selecciona la llave para el repositorio y remoto que la utilizarán.

Copiar la llave pública no la registra automáticamente en GitHub u otro servicio.
La llave privada permanece en disco. Quitar una llave del catálogo conserva sus
archivos y elimina sus asociaciones en GitThul.

Si un remoto SSH rechaza el acceso, el diálogo permite seleccionar o generar una
llave. También puedes cambiar explícitamente ese remoto a una URL HTTPS. La
contraseña de una llave y la confirmación de confianza en un servidor SSH se
solicitan durante la operación, cuando corresponda.

Las llaves de esta sección sirven para acceder a remotos. Las firmas GPG/SSH de
commits quedan fuera de este catálogo.

## Privacidad

GitThul guarda los secretos recordados en el llavero del sistema; no los incluye
en sus ajustes ni en las URLs de los remotos. Los perfiles contienen tu identidad
de commit, pero elegir uno no inicia sesión automáticamente en un proveedor Git.
