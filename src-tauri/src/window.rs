//! Ajustes de la decoración GTK, sin reemplazar su gestión de la ventana.

use gtk::prelude::*;

pub fn compact_native_titlebar(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let native = window.gtk_window()?;
    if native.is_decorated() {
        // En Wayland, Tao envuelve un HeaderBar en un EventBox. En X11 la
        // decoración del gestor no tiene un widget de título que modificar.
        if let Some(titlebar) = native.titlebar() {
            compact_header(&titlebar);
        }
    }
    Ok(())
}

fn compact_header(widget: &gtk::Widget) {
    if let Ok(header) = widget.clone().downcast::<gtk::HeaderBar>() {
        // Es una barra de título simple: no necesita espacio para subtítulo ni
        // la altura reservada por el tema a las cabeceras con controles extra.
        // Usar la disposición del escritorio, en lugar del lado fijo de Tao.
        header.set_decoration_layout(None);
        header.set_has_subtitle(false);
        header.style_context().add_class("default-decoration");
    } else if let Ok(container) = widget.clone().downcast::<gtk::Container>() {
        for child in container.children() {
            compact_header(&child);
        }
    }
}
