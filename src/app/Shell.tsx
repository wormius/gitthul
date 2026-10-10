import { AboutPanel } from './overlays/AboutPanel';
import { GlobalSearch } from './overlays/GlobalSearch';
import { LogsOverlay } from './overlays/LogsOverlay';
import { NotificationHistoryOverlay } from './overlays/NotificationHistoryOverlay';
import { ShellBottomBar } from './ShellBottomBar';
import { ViewRouter } from './views/ViewRouter';
import styles from './Shell.module.css';

/**
 * El contenido de la ventana nativa: vista y barra inferior.
 *
 * Solo la fila de la vista crece, de modo que la barra
 * inferior nunca se va de la pantalla por muchas pestañas que haya —la tira
 * desplaza en horizontal dentro de su hueco— y ninguna vista puede empujarla.
 *
 * Las superposiciones se montan aquí y no dentro de las vistas: Configuraciones,
 * los registros y la búsqueda global son del shell y siguen alcanzables sea lo
 * que sea que la pestaña activa esté enseñando, incluido un repositorio con
 * conflictos, que bloqueará su vista pero no la ventana.
 */
export function Shell() {
  return (
    <div className={styles.shell}>
      <main className={styles.view}>
        <ViewRouter />
      </main>

      <ShellBottomBar />

      <GlobalSearch />
      <LogsOverlay />
      <NotificationHistoryOverlay />
      <AboutPanel />
    </div>
  );
}
