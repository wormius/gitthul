import { useMemo, useState } from 'react';

import { Badge } from '../Badge';
import { CollapsibleRail, type RailSection } from '../CollapsibleRail';
import { Counter } from '../Counter';
import type { DataGridColumn } from '../dataGridUtils';
import { DataGrid } from '../DataGrid';
import { DataGridCell } from '../DataGridCell';
import { DataGridRow } from '../DataGridRow';
import { Heatmap } from '../Heatmap';
import { SplitPane } from '../SplitPane';
import { SyncScroll } from '../SyncScroll';
import { SyncScrollPane } from '../SyncScrollPane';
import { Tree } from '../Tree';
import { VirtualList } from '../VirtualList';
import {
  demoActivity,
  demoCommits,
  demoTree,
  OURS_LINES,
  THEIRS_LINES,
  type DemoCommit,
} from './structureFixtures';
import styles from './StructureGallery.module.css';

const COMMIT_COUNT = 100_000;
const GRAPH_CONTENT_WIDTH = 320;

const columns: readonly DataGridColumn[] = [
  { key: 'refs', header: 'Rama/Tag', name: 'Rama o tag', width: 130, minWidth: 80 },
  {
    key: 'graph',
    header: 'Grafo',
    name: 'Grafo',
    width: 120,
    minWidth: 60,
    hideable: false,
    contentWidth: GRAPH_CONTENT_WIDTH,
  },
  { key: 'subject', header: 'Mensaje', name: 'Mensaje', width: 320, grow: true },
  { key: 'author', header: 'Autor', name: 'Autor', width: 110, minWidth: 70 },
  { key: 'date', header: 'Fecha', name: 'Fecha', width: 110, minWidth: 90 },
  { key: 'sha', header: 'SHA', name: 'SHA', width: 90, minWidth: 70, align: 'end' },
];

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5 3.5v9M5 6.5c0 2 6 1 6 3M11 3.5v3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 8.2V3.5c0-.6.4-1 1-1h4.7l5.3 5.3-5.7 5.7L2.5 8.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="5.6" cy="5.6" r="1" fill="currentColor" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * Trazo de mentira del grafo, solo para que la columna tenga algo que recortar.
 *
 * El motor de verdad llega en F2.3 y va sobre canvas; aquí basta con ocupar
 * ancho para poder comprobar que el scroll horizontal es de la columna y no
 * arrastra al resto de la tabla.
 */
function FakeLanes({ lane }: { lane: number }) {
  return (
    <svg
      className={styles.lanes}
      viewBox={`0 0 ${String(GRAPH_CONTENT_WIDTH)} 24`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <line
          key={index}
          x1={12 + index * 22}
          y1={0}
          x2={12 + index * 22}
          y2={24}
          stroke={`var(--graph-branch-${String(index + 1)})`}
          strokeWidth="2"
        />
      ))}
      <circle
        cx={12 + lane * 22}
        cy={12}
        r="4.5"
        fill="var(--surface-app)"
        stroke={`var(--graph-branch-${String(lane + 1)})`}
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Demo de los primitivos de F0.6, y la que verifica lo que la fase promete:
 * cien mil filas que se desplazan sin tirones, la cabecera quieta fuera del
 * scroll, el reparto de los paneles recordado entre recargas y un mapa de calor
 * que al estrechar la ventana pierde semanas por la izquierda sin mover nunca la
 * columna de la derecha.
 */
export function StructureGallery() {
  const commits = useMemo(() => demoCommits(COMMIT_COUNT), []);
  const activity = useMemo(() => demoActivity(), []);

  const [railCollapsed, setRailCollapsed] = useState(false);
  const [selectedCommits, setSelectedCommits] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedFiles, setSelectedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['src/ui']));
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);

  const railSections: readonly RailSection[] = [
    {
      key: 'local',
      label: 'Locales',
      icon: <BranchIcon />,
      children: (
        <ul className={styles.refList}>
          <li className={styles.refRow}>
            main <Badge variant="accent">activa</Badge>
          </li>
          <li className={styles.refRow}>dev</li>
          <li className={styles.refRow}>f0.6-primitivos</li>
        </ul>
      ),
    },
    {
      key: 'tags',
      label: 'Tags',
      icon: <TagIcon />,
      children: (
        <ul className={styles.refList}>
          <li className={styles.refRow}>v0.1.0</li>
          <li className={styles.refRow}>v0.0.9</li>
        </ul>
      ),
    },
    {
      key: 'stashes',
      label: 'Stashes',
      icon: <BoxIcon />,
      children: (
        <ul className={styles.refList}>
          <li className={styles.refRow}>WIP en dev</li>
        </ul>
      ),
    },
  ];

  return (
    <div className={styles.groups}>
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>
          Paneles, rail y tabla
          <span className={styles.hint}>
            {COMMIT_COUNT.toLocaleString('es-MX')} commits · el reparto sobrevive a la recarga ·
            doble clic en un divisor para plegar
          </span>
        </h3>

        <div className={styles.stage}>
          <SplitPane
            orientation="horizontal"
            label="Ancho del panel de referencias"
            storageId="galeria.referencias"
            defaultRatio={0.26}
            minFirst={60}
            minSecond={280}
            collapsible="first"
            collapsed={railCollapsed}
            onCollapsedChange={setRailCollapsed}
            // Plegado, el panel se queda con el ancho de la tira de iconos: la
            // que desaparece del todo es la de detalles, no esta.
            collapsedSize="content"
            first={
              <CollapsibleRail
                label="Referencias de gitthul"
                sections={railSections}
                collapsed={railCollapsed}
                onCollapsedChange={setRailCollapsed}
                collapseLabel="Colapsar el panel de referencias"
                expandLabel="Desplegar el panel de referencias"
              />
            }
            second={
              <SplitPane
                orientation="vertical"
                label="Alto del panel de detalles"
                storageId="galeria.detalles"
                defaultRatio={0.62}
                minFirst={140}
                minSecond={80}
                collapsible="second"
                collapsed={detailsCollapsed}
                onCollapsedChange={setDetailsCollapsed}
                first={
                  <DataGrid
                    columns={columns}
                    label="Commits de gitthul"
                    rowCount={commits.length}
                    storageId="galeria.commits"
                    columnsMenuLabel="Columnas de la tabla de commits"
                    columnScrollLabel="Desplazamiento horizontal del grafo"
                  >
                    <VirtualList<DemoCommit>
                      items={commits}
                      getKey={(commit) => commit.sha}
                      label="Commits de gitthul"
                      semantics="rowgroup"
                      rowHeight={26}
                      selectionMode="multiple"
                      selected={selectedCommits}
                      onSelectedChange={setSelectedCommits}
                      renderRow={(commit, context) => (
                        <DataGridRow index={context.index} selected={context.selected}>
                          <DataGridCell columnKey="refs">
                            {context.index === 0 && (
                              <>
                                <Badge variant="accent">main</Badge>
                                <Counter value={2} prefix="+" />
                              </>
                            )}
                          </DataGridCell>
                          <DataGridCell columnKey="graph">
                            <FakeLanes lane={commit.lane} />
                          </DataGridCell>
                          <DataGridCell columnKey="subject">{commit.subject}</DataGridCell>
                          <DataGridCell columnKey="author">{commit.author}</DataGridCell>
                          <DataGridCell columnKey="date">{commit.date}</DataGridCell>
                          <DataGridCell columnKey="sha">
                            <code className={styles.sha}>{commit.sha}</code>
                          </DataGridCell>
                        </DataGridRow>
                      )}
                    />
                  </DataGrid>
                }
                second={
                  <div className={styles.details}>
                    <h4 className={styles.detailsTitle}>
                      Archivos cambiados
                      <span className={styles.hint}>
                        {selectedFiles.size} de 6 seleccionados · doble clic en el divisor para
                        plegar
                      </span>
                    </h4>
                    <Tree
                      nodes={demoTree}
                      label="Archivos cambiados"
                      expanded={expanded}
                      onExpandedChange={setExpanded}
                      selectionMode="multiple"
                      selected={selectedFiles}
                      onSelectedChange={setSelectedFiles}
                      renderNode={(row) => (
                        <>
                          <span className={styles.treeLabel}>{row.label}</span>
                          {row.hasChildren && !row.expanded && <Counter value={row.leafCount} />}
                        </>
                      )}
                    />
                  </div>
                }
              />
            }
          />
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>
          Mapa de calor
          <span className={styles.hint}>
            estrecha la ventana: se pierden semanas por la izquierda, nunca la de la derecha
          </span>
        </h3>
        <Heatmap
          days={activity}
          label="Actividad de gitthul en el último año"
          end="2026-07-26"
          describeDay={(cell) => `${cell.date}: ${String(cell.value)} commits`}
          legend={{ lessLabel: 'Menos', moreLabel: 'Más' }}
        />
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>
          Scroll sincronizado
          <span className={styles.hint}>mueve cualquiera de los dos paneles</span>
        </h3>
        <SyncScroll axis="both">
          <div className={styles.syncStage}>
            <SyncScrollPane label="Versión de main">
              <pre className={styles.code}>{OURS_LINES.join('\n')}</pre>
            </SyncScrollPane>
            <SyncScrollPane label="Versión de dev">
              <pre className={styles.code}>{THEIRS_LINES.join('\n')}</pre>
            </SyncScrollPane>
          </div>
        </SyncScroll>
      </div>
    </div>
  );
}
