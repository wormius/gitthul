import { useState } from 'react';

import { Banner } from '../Banner';
import { Breadcrumb } from '../Breadcrumb';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { CommandPalette, type CommandGroup } from '../CommandPalette';
import { ContextMenu } from '../ContextMenu';
import { Counter } from '../Counter';
import { Dialog } from '../Dialog';
import { Dropdown } from '../Dropdown';
import { EmptyState } from '../EmptyState';
import { ErrorPanel } from '../ErrorPanel';
import { IconButton } from '../IconButton';
import type { MenuEntry } from '../menu';
import { Popover } from '../Popover';
import { Toolbar } from '../Toolbar';
import { Tooltip } from '../Tooltip';
import { useToast } from '../useToast';
import styles from './OverlayGallery.module.css';

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

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const commitMenu: MenuEntry[] = [
  {
    key: 'cherry',
    label: 'Cherry-pick de 3 commits sobre main',
    shortcut: 'Ctrl+Mayús+C',
    onSelect: () => undefined,
  },
  { key: 'revert', label: 'Revertir main a a1b2c3d', danger: true, onSelect: () => undefined },
  { key: 'sep-1', kind: 'separator' },
  {
    key: 'create',
    kind: 'submenu',
    label: 'Crear desde a1b2c3d',
    items: [
      { key: 'branch', label: 'Crear rama desde a1b2c3d', onSelect: () => undefined },
      { key: 'tag', label: 'Crear tag en a1b2c3d', onSelect: () => undefined },
    ],
  },
  { key: 'sep-2', kind: 'separator' },
  { key: 'copy', label: 'Copiar a1b2c3d', shortcut: 'Ctrl+C', onSelect: () => undefined },
  {
    key: 'blocked',
    label: 'Fusionar main dentro de main',
    disabled: true,
    onSelect: () => undefined,
  },
];

const columnsMenu: MenuEntry[] = [
  { key: 'author', label: 'Autor', checked: true, onSelect: () => undefined },
  { key: 'date', label: 'Fecha', checked: true, onSelect: () => undefined },
  { key: 'sha', label: 'SHA', checked: false, onSelect: () => undefined },
];

// Casos de lectura: destino al final, referencias sin espacios y submenús largos.
const longBranch = 'origin/feature/desktop-primitives-example';
const longLabelsMenu: MenuEntry[] = [
  {
    key: 'close-space',
    label: 'Cerrar todas las pestañas con repos de Herramientas de desarrollo',
    onSelect: () => undefined,
  },
  {
    key: 'merge',
    label: `Fusionar ${longBranch} dentro de feature/refactorizacion-del-cliente-de-escritorio`,
    description: `Integra los cambios de ${longBranch} en la rama actual.`,
    onSelect: () => undefined,
  },
  {
    key: 'disabled',
    label: `Borrar ${longBranch}`,
    disabled: true,
    onSelect: () => undefined,
  },
  {
    key: 'create',
    kind: 'submenu',
    label: `Crear desde ${longBranch}`,
    items: [
      {
        key: 'worktree',
        label: `Crear un worktree con ${longBranch}`,
        shortcut: 'Ctrl+Mayús+W',
        onSelect: () => undefined,
      },
    ],
  },
];

const searchGroups: CommandGroup[] = [
  {
    key: 'repos',
    label: 'Repositorios',
    items: [
      {
        key: 'gitthul',
        label: 'gitthul',
        description: '~/Espacios/gitthul',
        onSelect: () => undefined,
      },
    ],
  },
  {
    key: 'branches',
    label: 'Ramas',
    items: [
      {
        key: 'main',
        label: 'Checkout de main',
        description: 'Rama activa',
        onSelect: () => undefined,
      },
      {
        key: 'dev',
        label: 'Checkout de dev',
        description: '3 commits por delante',
        onSelect: () => undefined,
      },
    ],
  },
  {
    key: 'actions',
    label: 'Acciones',
    items: [
      { key: 'pull', label: 'Pull de origin/main', shortcut: 'Ctrl+P', onSelect: () => undefined },
    ],
  },
];

const breadcrumbItems = [
  { key: 'root', label: 'gitthul', onSelect: () => undefined },
  { key: 'src', label: 'src', onSelect: () => undefined },
  { key: 'ui', label: 'ui', onSelect: () => undefined },
  { key: 'gallery', label: 'gallery', onSelect: () => undefined },
  { key: 'file', label: 'OverlayGallery.tsx' },
];

/**
 * Demo de los primitivos de F0.5, la que verifica lo que la fase promete: que
 * los flotantes se colocan contra los bordes de la ventana y que abrirlos no
 * mueve nada de lo que hay debajo. Se prueba estrechando la ventana y abriendo
 * los menús pegados a cada borde.
 */
export function OverlayGallery() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const filtered = query
    ? searchGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            item.label.toLowerCase().includes(query.toLowerCase()),
          ),
        }))
        .filter((group) => group.items.length > 0)
    : searchGroups;

  return (
    <div className={styles.groups}>
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Menús</h3>
        <div className={styles.row}>
          <ContextMenu
            items={commitMenu}
            label="Acciones del commit a1b2c3d"
            description="3 commits seleccionados"
            className={styles.contextRegion}
          >
            <button type="button" className={styles.fakeRow}>
              a1b2c3d · Clic derecho o tecla de menú
            </button>
          </ContextMenu>
          <Dropdown label="Ordenar por" items={columnsMenu} />
          <Dropdown label="Etiquetas largas" items={longLabelsMenu} />
          <Dropdown label="Más acciones" items={commitMenu} icon={<BranchIcon />} hideLabel />
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Flotantes</h3>
        <div className={styles.row}>
          <Tooltip content="Traer los cambios de origin/main sin aplicarlos">
            <IconButton icon={<DownloadIcon />} aria-label="Fetch" />
          </Tooltip>
          {/* Anticipo de `RefLabelCluster`, que nace en F2.4: las ramas y tags
              que comparten commit se colapsan a una etiqueta con `+N` y el resto
              sale en flotante al hacer hover. Aquí se arma con `Chip` y
              `Counter` — las píldoras definitivas serán `RefLabel`, de dominio. */}
          <button
            type="button"
            ref={setPopoverAnchor}
            className={styles.refLabel}
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            onMouseEnter={() => {
              setPopoverOpen(true);
            }}
            onClick={() => {
              setPopoverOpen((value) => !value);
            }}
          >
            <span className={styles.refIcon} aria-hidden="true">
              <BranchIcon />
            </span>
            main
            <Counter value={3} prefix="+" />
          </button>
          <Popover
            open={popoverOpen}
            anchor={popoverAnchor}
            onClose={() => {
              setPopoverOpen(false);
            }}
            label="Ramas y tags en a1b2c3d"
            autoFocus={false}
            className={styles.cluster}
          >
            <Chip icon={<BranchIcon />} selected onSelect={() => undefined}>
              main
            </Chip>
            <Chip icon={<BranchIcon />} onSelect={() => undefined}>
              origin/main
            </Chip>
            <Chip onSelect={() => undefined}>v1.2.3</Chip>
            <Chip onSelect={() => undefined}>myfix</Chip>
          </Popover>
          <Toolbar
            label="Acciones de GitWorking"
            overflow={{ label: 'Más acciones de GitWorking', items: columnsMenu }}
          >
            <IconButton icon={<DownloadIcon />} aria-label="Fetch" />
            <IconButton icon={<BranchIcon />} aria-label="Nueva rama" />
          </Toolbar>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Modales</h3>
        <div className={styles.row}>
          <Button
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Borrar la rama dev
          </Button>
          <Button
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            Búsqueda global
          </Button>
          <Button
            onClick={() => {
              toast.show({
                message: 'Cambios llevados de main a dev',
                variant: 'success',
                action: { label: 'Deshacer', onAction: () => undefined },
              });
            }}
          >
            Lanzar aviso
          </Button>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Avisos, rutas y vacíos</h3>
        <div className={styles.column}>
          <Breadcrumb label="Ruta del archivo" items={breadcrumbItems} />
          <Breadcrumb
            label="Ruta del archivo, plegada"
            items={breadcrumbItems}
            maxVisible={3}
            overflowLabel="Tramos ocultos de la ruta"
          />
          <Banner
            variant="warning"
            title="Hay un rebase de dev sobre main a medias"
            actions={<Button size="sm">Continuar el rebase</Button>}
            onDismiss={() => undefined}
            dismissLabel="Descartar el aviso"
          >
            Quedan 2 de 5 commits por aplicar.
          </Banner>
          <ErrorPanel
            title="No se pudo publicar main"
            cause="origin/main tiene 2 commits que tú no tienes."
            fixes={[
              {
                key: 'fetch',
                label: 'Traer origin/main y reintentar',
                onSelect: () => undefined,
                primary: true,
              },
              { key: 'force', label: 'Forzar la publicación de main', onSelect: () => undefined },
            ]}
            output={'! [rejected] main -> main (fetch first)\nerror: failed to push some refs'}
            outputLabel="Salida de git"
          />
          <EmptyState
            title="Todavía no hay stashes en gitthul"
            description="Guarda cambios sin comprometerlos y aparecerán aquí."
            actions={<Button variant="primary">Guardar los cambios de main</Button>}
          />
        </div>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        title="Borrar la rama dev"
        description="dev tiene 3 commits que no están en main. Si la borras, se pierden."
        closeLabel="Cerrar"
        footer={
          <>
            <Button
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDialogOpen(false);
                toast.show({
                  message: 'Rama dev borrada',
                  variant: 'danger',
                  action: { label: 'Deshacer', onAction: () => undefined },
                });
              }}
            >
              Borrar dev
            </Button>
          </>
        }
      >
        <p className={styles.dialogText}>
          Los commits siguen en el reflog durante 90 días, así que deshacer sigue siendo posible.
        </p>
      </Dialog>

      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
        label="Búsqueda global"
        searchLabel="Buscar en GitThul"
        placeholder="Repos, ramas, commits, acciones…"
        query={query}
        onQueryChange={setQuery}
        groups={filtered}
        emptyLabel="Sin resultados"
        emptyDescription="Prueba con el nombre de una rama o un SHA."
      />
    </div>
  );
}
