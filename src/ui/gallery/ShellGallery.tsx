import { useState } from 'react';
import { APP_VERSION } from '@app/metadata';

import { BottomBar } from '../BottomBar';
import { IconButton } from '../IconButton';
import { StatusMessage, type StatusTone } from '../StatusMessage';
import type { TabDescriptor } from '../Tab';
import { TabStrip } from '../TabStrip';
import { TitleBar } from '../TitleBar';
import { WindowFrame, type ResizeEdge } from '../WindowFrame';
import styles from './ShellGallery.module.css';

const TONES: readonly StatusTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];

function Dot() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const INITIAL_TABS: readonly TabDescriptor[] = [
  {
    id: 'repos',
    label: 'Repositorios',
    closeLabel: 'Cerrar la pestaña Repositorios',
    icon: <Dot />,
  },
  {
    id: 'gitthul',
    label: 'gitthul',
    hint: 'rama main',
    closeLabel: 'Cerrar la pestaña gitthul',
    icon: <Dot />,
  },
  {
    id: 'worktree',
    label: 'gitthul',
    hint: 'worktree de gitthul, rama f0-7-shell',
    closeLabel: 'Cerrar la pestaña gitthul',
    icon: <Dot />,
  },
  { id: 'terminal', label: 'Terminal', closeLabel: 'Cerrar la pestaña Terminal', icon: <Dot /> },
];

/**
 * Los primitivos de F0.7 fuera del shell.
 *
 * Aquí se comprueba a mano que el hover de la pestaña no altera su contenido y
 * que reordenar arrastrando funcione con el ratón de verdad. La tira de aquí es
 * de mentira y no habla con la tienda del shell: es la única forma de tener
 * cuatro pestañas de todos los tipos a la vez.
 */
export function ShellGallery() {
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeId, setActiveId] = useState('gitthul');
  const [maximized, setMaximized] = useState(false);
  const [resizing, setResizing] = useState<ResizeEdge | null>(null);

  const reorder = (id: string, toIndex: number) => {
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.id === id);
      const moved = current[from];

      if (!moved) return current;

      const rest = current.filter((tab) => tab.id !== id);

      return [...rest.slice(0, toIndex), moved, ...rest.slice(toIndex)];
    });
  };

  return (
    <div className={styles.groups}>
      <section className={styles.group}>
        <h3 className={styles.groupTitle}>
          TitleBar
          <span className={styles.hint}>
            controles por plataforma; la zona libre arrastra la ventana
          </span>
        </h3>

        <div className={styles.stage}>
          <TitleBar
            label="Barra de título de ejemplo"
            title="gitthul"
            detail="rama main"
            brand={<span className={styles.brand}>GitThul</span>}
            maximized={maximized}
            labels={{
              minimize: 'Minimizar la ventana',
              maximize: 'Maximizar la ventana',
              restore: 'Restaurar el tamaño de la ventana',
              close: 'Cerrar la ventana',
            }}
            onMinimize={() => undefined}
            onToggleMaximize={() => {
              setMaximized((value) => !value);
            }}
            onClose={() => undefined}
          />
        </div>

        <div className={styles.stage}>
          <TitleBar
            label="Barra de título al estilo de macOS"
            title="linux"
            detail="rama master"
            maximized={false}
            controlsSide="start"
            controlsOrder={['close', 'minimize', 'maximize']}
            labels={{
              minimize: 'Minimizar la ventana',
              maximize: 'Maximizar la ventana',
              restore: 'Restaurar el tamaño de la ventana',
              close: 'Cerrar la ventana',
            }}
            onMinimize={() => undefined}
            onToggleMaximize={() => undefined}
            onClose={() => undefined}
          />
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>
          WindowFrame
          <span className={styles.hint}>
            acerca el puntero a los bordes del recuadro: cada uno tiene su cursor. En la ventana son
            los ocho bordes de la ventana, y desaparecen al maximizar
          </span>
        </h3>

        <div className={`${styles.stage} ${styles.windowStage}`}>
          <WindowFrame
            enabled={!maximized}
            onResizeStart={(edge) => {
              setResizing(edge);
            }}
          />
          <span className={styles.hint}>
            {maximized
              ? 'Maximizada: sin asas'
              : `Último borde agarrado: ${resizing ?? 'ninguno todavía'}`}
          </span>
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>
          BottomBar, TabStrip y Tab
          <span className={styles.hint}>
            arrastra para reordenar; el hover revela los iconos sin desplazar nada
          </span>
        </h3>

        <div className={styles.stage}>
          <BottomBar
            label="Barra inferior de ejemplo"
            launchers={
              <>
                <IconButton icon={<Dot />} aria-label="Ir a Repositorios" />
                <IconButton icon={<Dot />} aria-label="Nueva pestaña de terminal" />
              </>
            }
            status={<StatusMessage tone="info" message="Traído dev dentro de main: 3 commits" />}
            utilities={
              <>
                <span className={styles.hint}>GitThul {APP_VERSION}</span>
                <IconButton icon={<Dot />} aria-label="Búsqueda global" />
                <IconButton icon={<Dot />} aria-label="Configuraciones" />
              </>
            }
          >
            <TabStrip
              label="Pestañas abiertas de ejemplo"
              tabs={tabs}
              activeId={activeId}
              onActivate={setActiveId}
              onClose={(id) => {
                setTabs((current) => current.filter((tab) => tab.id !== id));
              }}
              onReorder={reorder}
            />
          </BottomBar>
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={styles.groupTitle}>
          StatusMessage
          <span className={styles.hint}>el tono se lee por color y por el anillo</span>
        </h3>

        <div className={styles.stack}>
          {TONES.map((tone) => (
            <StatusMessage
              key={tone}
              tone={tone}
              message={`Fusionar dev dentro de main — tono ${tone}`}
              detail="usó rebase porque no habías publicado"
            />
          ))}
          <StatusMessage message="Trayendo de origin" busy busyLabel="Trayendo de origin" />
        </div>
      </section>
    </div>
  );
}
