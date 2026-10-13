# Versión instalada y actualizaciones

Abre **Configuración → Actualizaciones** para consultar la versión instalada
de GitThul y pulsa **Buscar ahora** para buscar una versión estable más reciente
en [GitHub Releases](https://github.com/wormius/gitthul/releases).
También puedes pulsar **GitThul y su versión** en la barra inferior para abrir
directamente esta sección; abrirla no inicia una búsqueda.

La búsqueda considera únicamente versiones estables publicadas del repositorio
oficial de GitThul. No hay un canal Beta.

Si hay una nueva versión, la sección muestra su número y aparece un aviso con
**Abrir descargas**. Ese botón abre la página de esa versión en el navegador del
sistema. Elige el paquete para tu sistema y sigue la guía de
[instalación](instalacion.md). GitThul no descarga ni instala paquetes automáticamente.
La barra inferior muestra junto a la versión un icono de actualización con **+1**.
El indicador permanece durante la sesión aunque cierres el aviso o falle una
nueva consulta. Una búsqueda que confirme que no hay una versión más reciente
lo retira.

Puedes activar **Buscar actualizaciones al arrancar** para realizar una consulta
al iniciar la aplicación. Esta opción está desactivada por defecto.
**Restablecer** vuelve a desactivarla.

Si la búsqueda al arrancar está desactivada y todavía no has elegido qué hacer,
GitThul muestra una sugerencia unos segundos después de abrir la aplicación.
El aviso permite seguir trabajando y aparece como máximo una vez por sesión.

- **Activar** guarda tu elección, busca una nueva versión en ese momento y
  habilita las consultas al arrancar en las siguientes sesiones.
- **Recordarme en una semana** guarda una fecha para volver a sugerirlo. El aviso
  reaparece en una apertura posterior, cuando hayan pasado siete días. Cerrar
  el aviso con **×** también lo pospone una semana.
- **No volver a sugerirlo** conserva la búsqueda automática desactivada y evita
  nuevas sugerencias.

Si desactivas manualmente la búsqueda al arrancar en Configuración, GitThul
tampoco vuelve a sugerir que la actives. **Restablecer** también respeta esa
decisión. Puedes cambiar el ajuste o usar
**Buscar ahora** cuando quieras. Aceptar la sugerencia solo autoriza buscar
versiones; GitThul no descarga, instala ni reinicia automáticamente.

Si la versión instalada es igual o posterior a la última versión estable
publicada, la sección indica que no hay una versión estable más reciente.
Reemplazar los paquetes de una publicación sin cambiar su número, por ejemplo
`1.0.0`, no cuenta como una versión nueva.

Si todavía no hay versiones estables publicadas, la sección lo indica por separado.
Si falla la conexión, GitHub limita las consultas o la respuesta no puede leerse,
se muestra un error y puedes reintentar con **Buscar ahora**. Un fallo de consulta
no confirma que tengas la versión más reciente.
