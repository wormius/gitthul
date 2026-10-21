# Aplicar archivos de un stash

Selecciona un stash en GitWorking para ver sus archivos en el panel derecho.
Selecciona un archivo, o varios con **Ctrl/Cmd + clic** o **Shift + clic**,
y abre el menú contextual sobre la selección. La opción de aplicar los archivos
seleccionados indica cuántos archivos incluye. En la vista de árbol también
puedes abrir el menú de una carpeta para aplicar sus archivos.

Los cambios se aplican al árbol de trabajo y aparecen en WIP. El Stage conserva
su contenido anterior y el stash permanece en la lista, de modo que puedes
aplicar otros archivos después. Puedes conservar cambios locales en otros
archivos. **Deshacer** revierte la aplicación parcial y **Rehacer** la repite.

La selección admite archivos modificados, nuevos, eliminados, binarios y archivos
sin seguimiento guardados en el stash. Al aplicar un archivo renombrado, se
incluyen su ruta anterior y su ruta nueva.

Los archivos seleccionados deben estar libres de cambios locales, tanto en Stage
como en el árbol de trabajo. Si uno de ellos está modificado, el parche no puede
aplicarse o un archivo existente ocupa el destino de uno nuevo, GitThul rechaza
la selección completa. Revisa tus cambios antes de volver a intentarlo. Aplicar
la misma selección otra vez puede producir ese aviso si los cambios ya están
presentes.

La aplicación parcial no inicia una resolución de conflictos y no está disponible
durante otra operación Git o con conflictos pendientes. Los cambios de referencia
de submódulos requieren la aplicación completa del stash. Esta acción tampoco
retira el stash; **POP** continúa siendo una operación sobre el stash completo.
