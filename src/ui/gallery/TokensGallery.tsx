import { COLOR_TOKENS, MEASURE_TOKENS } from '@design/tokenCatalog';
import { useTheme } from '@design/useTheme';

import { ToastProvider } from '@ui/ToastProvider';

import { ContrastReport } from './ContrastReport';
import { ControlsGallery } from './ControlsGallery';
import { DragGallery } from './DragGallery';
import { GalleryControls } from './GalleryControls';
import { GraphBranchSpecimen } from './GraphBranchSpecimen';
import { OverlayGallery } from './OverlayGallery';
import { ShellGallery } from './ShellGallery';
import { StructureGallery } from './StructureGallery';
import { TerminalGallery } from './TerminalGallery';
import { TokenSwatchList } from './TokenSwatchList';
import { TypeSpecimen } from './TypeSpecimen';
import { SyntaxPaletteGallery } from './SyntaxPaletteGallery';
import { ViewerGallery } from './ViewerGallery';
import styles from './TokensGallery.module.css';

/**
 * Galería del sistema de diseño, en `/dev/tokens`.
 *
 * Es la herramienta de verificación de F0.3: cambiar tema, modo, densidad y las
 * dos escalas de fuente aquí arriba tiene que repintar todo lo de abajo sin
 * recargar. A partir de F0.4 esta misma página recibe una sección por primitivo
 * con su demo y su prueba de no-desplazamiento por hover.
 *
 * La sección de superposición de F0.5 vive dentro de su propio `ToastProvider`
 * porque la galería no monta el shell, que es quien lo provee de verdad. La de
 * estructura de F0.6 escribe los tamaños de sus paneles en el almacén por
 * defecto, así que recargar la página los devuelve donde estaban. Y la de shell
 * de F0.7 pinta sus barras con pestañas de mentira, sin tocar la tienda: es lo
 * que permite tener a la vista los cuatro tipos de pestaña a la vez.
 *
 * La de arrastre de F0.12 es la única que **no se puede dar por verificada
 * aquí**: el WebKit de la ventana nativa reparte los eventos de arrastre de otra
 * manera que el navegador de desarrollo, así que lo que se ve en `/dev/tokens`
 * hay que volver a verlo en `npm run tauri dev`.
 *
 * La de visores de F0.13 es la que prueba que el tema de CodeMirror es CSS y no
 * JavaScript: cambiar arriba el tema, la densidad o la fuente de visores tiene
 * que repintar el editor sin remontarlo y sin perder lo que estuviera plegado.
 */
export function TokensGallery() {
  const { resolved, settings } = useTheme();

  return (
    <main className={styles.gallery}>
      <header className={styles.header}>
        <h1 className={styles.heading}>
          Tokens
          <span className={styles.subtitle}>
            {resolved.theme} · {resolved.themeVariant} · {resolved.mode} · {settings.density}
          </span>
        </h1>
        <GalleryControls />
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Sintaxis · todos los temas</h2>
          <SyntaxPaletteGallery />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Superficies y estados</h2>

          <div className={styles.surfaces}>
            <div className={styles.card}>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Fila normal, con hover</span>
                <span className={styles.rowMeta}>a1b2c3d</span>
              </div>
              <div className={`${styles.row} ${styles.rowSelected}`}>
                <span className={styles.rowLabel}>Fila seleccionada</span>
                <span className={styles.rowMeta}>e4f5a6b</span>
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.states}>
                <span className={`${styles.chip} ${styles.chipSuccess}`}>Sin conflictos</span>
                <span className={`${styles.chip} ${styles.chipWarning}`}>3 sin publicar</span>
                <span className={`${styles.chip} ${styles.chipDanger}`}>Push rechazado</span>
                <span className={`${styles.chip} ${styles.chipInfo}`}>Rebase en curso</span>
                <span className={`${styles.chip} ${styles.chipAccent}`}>main</span>
                <span className={`${styles.chip} ${styles.chipDisabled}`}>Deshabilitado</span>
              </div>
              <button type="button" className={styles.accentButton}>
                Fusionar dev dentro de main
              </button>
            </div>
          </div>

          {COLOR_TOKENS.map((group) => (
            <TokenSwatchList key={group.title} group={group} />
          ))}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Ramas del grafo</h2>
          <GraphBranchSpecimen />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Tipografía</h2>
          <TypeSpecimen />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Controles</h2>
          <ControlsGallery />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Superposición y navegación</h2>
          <ToastProvider regionLabel="Avisos de GitThul" dismissLabel="Cerrar el aviso">
            <OverlayGallery />
          </ToastProvider>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Estructura y datos</h2>
          <StructureGallery />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Arrastre</h2>
          <DragGallery />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Visores</h2>
          <ViewerGallery />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Terminal nativa</h2>
          <ToastProvider regionLabel="Avisos de la terminal" dismissLabel="Cerrar el aviso">
            <TerminalGallery />
          </ToastProvider>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Shell</h2>
          <ShellGallery />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Medidas</h2>
          {MEASURE_TOKENS.map((group) => (
            <TokenSwatchList key={group.title} group={group} />
          ))}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contraste</h2>
          <ContrastReport />
        </section>
      </div>
    </main>
  );
}
