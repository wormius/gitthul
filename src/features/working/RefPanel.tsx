import { useState } from 'react';

import { localBranches, stashName } from '@core/domain/refs';
import type { Branch, RefsSnapshot } from '@core/domain/refs';
import type { Repository } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { CollapsibleRail, type RailSection } from '@ui/CollapsibleRail';
import { ContextMenu } from '@ui/ContextMenu';
import { Skeleton } from '@ui/Skeleton';
import { Tree } from '@ui/Tree';
import type { TreeNode } from '@ui/treeUtils';

import {
  localBranchMenu,
  remoteBranchMenu,
  remoteMenu,
  sectionHeaderMenu,
  stashMenu,
  tagMenu,
  worktreeMenu,
  type MenuBuildContext,
} from './contextMenus';
import type { DragRef } from './integration';
import { integrationOffer } from './integration';
import { RefIcon } from './RefIcon';
import { RefList } from './RefList';
import { RefRow } from './RefRow';
import { branchTree, remoteBranchLeafName, remoteGroups } from './refs';
import { RepoHeader } from './RepoHeader';
import styles from './RefPanel.module.css';
import type { SectionCollapse } from './useSectionCollapse';
import { useWorkingStore } from './workingStore';

const SECTION_KEYS = ['locals', 'remotes', 'tags', 'stashes', 'worktrees'] as const;
const NO_EXPANDED_REFS: ReadonlySet<string> = new Set();
const keepRefsCollapsed = () => {};

interface RefPanelProps {
  repository: Repository;
  refs: RefsSnapshot;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  sections: SectionCollapse;
  menuContext: MenuBuildContext;
  /** Lleva el foco del grafo al nodo de una referencia — «Ir a su nodo». */
  onGoToHead: () => void;
}

function remoteRootId(remoteName: string): string {
  return `remote:${remoteName}`;
}

/**
 * El panel izquierdo: `RepoHeader` fijo encima de las cinco secciones
 * colapsables — CU-3. Es el contenido de `CollapsibleRail`, que es lo que le
 * da su modo rail cuando el panel entero se pliega.
 *
 * Desde F2.4 cada fila trae su menú contextual —rama local, rama remota, tag,
 * guardado, worktree y remoto son seis de los catorce— y cada cabecera de
 * sección el suyo. El arrastre sigue siendo de F2.7.
 */
export function RefPanel({
  repository,
  refs,
  collapsed,
  onCollapsedChange,
  sections: sectionCollapse,
  menuContext,
  onGoToHead,
}: RefPanelProps) {
  const { t } = useI18n();
  const { collapsed: sectionsCollapsed, toggle } = sectionCollapse;
  const { actions } = menuContext;
  const openActionPreview = useWorkingStore((s) => s.openActionPreview);
  const refColors = useWorkingStore((s) => s.refColors);
  /*
   * Lo señalado con un clic vive en el store porque los gestos de `checkout`,
   * borrar rama y borrar tag no reciben parámetros: solo alcanzan lo que él
   * sabe. Señalar **lleva además el foco a su nodo del grafo** —el punto 15 de
   * los pendientes de interfaz—: es la mitad de la marca que no se ve, porque
   * la fila señalada no se pinta (ver `RefRow.module.css`), y lo que sí se ve
   * es la tabla saltando al commit de esa rama. Si el commit todavía no está
   * paginado, la tabla no salta y no pasa nada más: está decidido así en
   * `CommitTable`.
   */
  const selectedRef = useWorkingStore((s) => s.selectedRef);
  const setSelectedRef = useWorkingStore((s) => s.setSelectedRef);
  const selectedCommits = useWorkingStore((s) => s.selectedCommits);
  const setSelectedCommits = useWorkingStore((s) => s.setSelectedCommits);
  const headBranch = refs.head.branch;

  /**
   * Al soltar una referencia sobre otra en el panel: se abre la vista previa
   * de integración — F2.7.
   */
  const handleDrop = (source: DragRef, target: DragRef) => {
    if (headBranch === null) return;
    if (integrationOffer(source, target) === null) return;

    openActionPreview({ kind: 'merge', source, target, headBranch });
  };

  const groups = remoteGroups(refs);
  const remoteBranchById = new Map(
    groups.flatMap((group) => group.branches.map((branch) => [branch.id, branch] as const)),
  );
  const remoteByRootId = new Map(
    groups.map((group) => [remoteRootId(group.remote.name), group.remote] as const),
  );

  // Un remoto arranca desplegado — CU-3: «un solo remoto es un árbol con una
  // sola rama abierta». Vive en memoria y no en `SettingsPort`: es la forma del
  // árbol, no una preferencia que valga la pena recordar entre arranques.
  const [expandedRemotes, setExpandedRemotes] = useState<ReadonlySet<string>>(
    () => new Set(groups.map((group) => remoteRootId(group.remote.name))),
  );

  const remoteNodes: TreeNode[] = groups.map((group) => ({
    id: remoteRootId(group.remote.name),
    label: group.remote.name,
    children: branchTree(group.branches, {
      nameOf: (branch) => remoteBranchLeafName(branch, group.remote),
    }),
  }));

  const locals = localBranches(refs);
  // Repositorio recién creado: sin commits todavía no hay un objeto `Branch`
  // que crear —`branches` viene vacío—, pero `HEAD` ya nombra la rama inicial y
  // la sección 3 del subplan pide enseñarla igual.
  const localRows: readonly Branch[] =
    locals.length > 0
      ? locals
      : refs.head.branch
        ? [
            {
              id: `virtual:${refs.head.branch}`,
              name: refs.head.branch,
              kind: 'local',
              tip: refs.head.sha,
              ahead: 0,
              behind: 0,
              isHead: true,
            },
          ]
        : [];

  const localBranchById = new Map(localRows.map((branch) => [branch.id, branch] as const));
  const localNodes: TreeNode[] = branchTree(localRows);
  const tagById = new Map(refs.tags.map((tag) => [tag.id, tag] as const));
  const tagNodes: TreeNode[] = refs.tags.map((tag) => ({ id: tag.id, label: tag.name }));
  const stashById = new Map<string, (typeof refs.stashes)[number]>(
    refs.stashes.map((stash) => [`stash:${String(stash.index)}`, stash] as const),
  );
  const stashNodes: TreeNode[] = refs.stashes.map((stash) => ({
    id: `stash:${String(stash.index)}`,
    label: stash.message,
  }));
  const worktreeById = new Map(
    refs.worktrees.map((worktree) => [worktree.path, worktree] as const),
  );
  const worktreeNodes: TreeNode[] = refs.worktrees.map((worktree) => ({
    id: worktree.path,
    label: worktree.name,
  }));

  const selectLocal = (branch: Branch) => {
    setSelectedRef({
      kind: 'localBranch',
      name: branch.name,
      isHead: branch.isHead,
      target: branch.tip,
    });
    setSelectedCommits(new Set([branch.tip]));
    actions.goToNode(branch.tip);
  };

  const selectRemote = (branch: Branch) => {
    setSelectedRef({
      kind: 'remoteBranch',
      name: branch.name,
      isHead: false,
      target: branch.tip,
      remote: branch.remote,
    });
    setSelectedCommits(new Set([branch.tip]));
    actions.goToNode(branch.tip);
  };

  // Las carpetas de ramas locales arrancan desplegadas: quien tiene `fix/a` y
  // `fix/b` espera verlas sin un clic extra.
  const [expandedLocals, setExpandedLocals] = useState<ReadonlySet<string>>(() => {
    const folders = new Set<string>();

    const collectFolders = (nodes: readonly TreeNode[]) => {
      for (const node of nodes) {
        if (node.children) {
          folders.add(node.id);
          collectFolders(node.children);
        }
      }
    };

    collectFolders(localNodes);

    return folders;
  });

  const sections: RailSection[] = [
    {
      key: 'locals',
      label: t('working.refPanel.locals'),
      icon: <RefIcon kind="local" />,
      count: localRows.length,
      collapsed: sectionsCollapsed.locals,
      onToggleCollapsed: () => {
        toggle('locals');
      },
      menu: sectionHeaderMenu(menuContext, 'locals'),
      menuLabel: t('working.menu.section.label', { section: t('working.refPanel.locals') }),
      collapseLabel: t('working.refPanel.collapseSection', {
        section: t('working.refPanel.locals'),
      }),
      expandLabel: t('working.refPanel.expandSection', { section: t('working.refPanel.locals') }),
      children: (
        <RefList
          label={t('working.refPanel.locals')}
          count={localRows.length}
          empty={t('working.refPanel.emptyLocals')}
          invalidDrop
        >
          <Tree
            className={styles.tree}
            label={t('working.refPanel.locals')}
            nodes={localNodes}
            expanded={expandedLocals}
            onExpandedChange={setExpandedLocals}
            selectionMode="single"
            selected={
              selectedRef?.kind === 'localBranch'
                ? new Set(
                    localRows
                      .filter((branch) => branch.name === selectedRef.name)
                      .map((branch) => branch.id),
                  )
                : NO_EXPANDED_REFS
            }
            onSelectedChange={(next) => {
              const id = [...next][0];
              const branch = id ? localBranchById.get(id) : undefined;
              if (branch) selectLocal(branch);
            }}
            onActivate={(row) => {
              const branch = localBranchById.get(row.id);
              if (branch && !branch.isHead) {
                actions.checkout({ kind: 'branch', name: branch.name }, branch.name);
              }
            }}
            autoHeight
            renderNode={(row) => {
              const branch = localBranchById.get(row.id);

              if (branch) {
                return (
                  <RefRow
                    kind={branch.isHead ? 'activeBranch' : 'local'}
                    label={row.label}
                    nestedInTree
                    ahead={branch.upstream ? branch.ahead : undefined}
                    behind={branch.upstream ? branch.behind : undefined}
                    menu={localBranchMenu(menuContext, branch)}
                    menuLabel={t('working.menu.branch.label', { branch: branch.name })}
                    drag={{ kind: 'branch', name: branch.name }}
                    colorIndex={refColors.get(branch.name)}
                    onDrop={(source) => {
                      handleDrop(source, { kind: 'branch', name: branch.name });
                    }}
                    selected={
                      selectedRef?.kind === 'localBranch' && selectedRef.name === branch.name
                    }
                    onSelect={() => {
                      selectLocal(branch);
                    }}
                    onActivate={() => {
                      if (!branch.isHead) {
                        actions.checkout({ kind: 'branch', name: branch.name }, branch.name);
                      }
                    }}
                  />
                );
              }

              // Nodo carpeta: solo el rótulo, sin acción.
              return <span className={styles.folderLabel}>{row.label}</span>;
            }}
          />
        </RefList>
      ),
    },
    {
      key: 'remotes',
      label: t('working.refPanel.remotes'),
      icon: <RefIcon kind="remote" />,
      count: groups.length,
      collapsed: sectionsCollapsed.remotes,
      onToggleCollapsed: () => {
        toggle('remotes');
      },
      menu: sectionHeaderMenu(menuContext, 'remotes'),
      menuLabel: t('working.menu.section.label', { section: t('working.refPanel.remotes') }),
      collapseLabel: t('working.refPanel.collapseSection', {
        section: t('working.refPanel.remotes'),
      }),
      expandLabel: t('working.refPanel.expandSection', { section: t('working.refPanel.remotes') }),
      children: (
        <RefList
          label={t('working.refPanel.remotes')}
          count={groups.length}
          empty={t('working.refPanel.emptyRemotes')}
          invalidDrop
        >
          <Tree
            className={styles.tree}
            label={t('working.refPanel.remotesTree')}
            nodes={remoteNodes}
            expanded={expandedRemotes}
            onExpandedChange={setExpandedRemotes}
            selectionMode="single"
            selected={
              selectedRef?.kind === 'remoteBranch'
                ? new Set(
                    groups
                      .flatMap((group) => group.branches)
                      .filter((branch) => branch.name === selectedRef.name)
                      .map((branch) => branch.id),
                  )
                : NO_EXPANDED_REFS
            }
            onSelectedChange={(next) => {
              const id = [...next][0];
              const branch = id ? remoteBranchById.get(id) : undefined;
              if (branch) selectRemote(branch);
            }}
            onActivate={(row) => {
              const branch = remoteBranchById.get(row.id);
              if (!branch) return;
              const remoteName = branch.remote ?? branch.name.split('/')[0] ?? branch.name;
              const shortName = branch.name.startsWith(`${remoteName}/`)
                ? branch.name.slice(remoteName.length + 1)
                : branch.name;
              const local = refs.branches.find(
                (candidate) =>
                  candidate.kind === 'local' &&
                  (candidate.upstream === branch.name || candidate.name === shortName),
              );
              actions.activateRemoteBranch(branch, local);
            }}
            autoHeight
            renderNode={(row) => {
              const branch = remoteBranchById.get(row.id);

              if (branch) {
                return (
                  <RefRow
                    kind="remote"
                    label={row.label}
                    nestedInTree
                    ahead={branch.ahead}
                    behind={branch.behind}
                    menu={remoteBranchMenu(menuContext, branch)}
                    menuLabel={t('working.menu.branch.label', { branch: branch.name })}
                    drag={{ kind: 'branch', name: branch.name }}
                    colorIndex={refColors.get(branch.name)}
                    onDrop={(source) => {
                      handleDrop(source, { kind: 'branch', name: branch.name });
                    }}
                    selected={
                      selectedRef?.kind === 'remoteBranch' && selectedRef.name === branch.name
                    }
                    onSelect={() => {
                      selectRemote(branch);
                    }}
                    onActivate={() => {
                      const remoteName = branch.remote ?? branch.name.split('/')[0] ?? branch.name;
                      const shortName = branch.name.startsWith(`${remoteName}/`)
                        ? branch.name.slice(remoteName.length + 1)
                        : branch.name;
                      const local = refs.branches.find(
                        (candidate) =>
                          candidate.kind === 'local' &&
                          (candidate.upstream === branch.name || candidate.name === shortName),
                      );
                      actions.activateRemoteBranch(branch, local);
                    }}
                  />
                );
              }

              const remote = remoteByRootId.get(row.id);

              if (remote) {
                return (
                  <ContextMenu
                    items={remoteMenu(menuContext, remote)}
                    label={t('working.menu.remote.label', { remote: remote.name })}
                  >
                    <span className={styles.remoteRoot}>{row.label}</span>
                  </ContextMenu>
                );
              }

              // Nodo carpeta intermedio (p. ej. `fix` en `fix/push-rechazado`).
              return <span className={styles.folderLabel}>{row.label}</span>;
            }}
          />
        </RefList>
      ),
    },
    {
      key: 'tags',
      label: t('working.refPanel.tags'),
      icon: <RefIcon kind="tag" />,
      count: refs.tags.length,
      collapsed: sectionsCollapsed.tags,
      onToggleCollapsed: () => {
        toggle('tags');
      },
      menu: sectionHeaderMenu(menuContext, 'tags'),
      menuLabel: t('working.menu.section.label', { section: t('working.refPanel.tags') }),
      collapseLabel: t('working.refPanel.collapseSection', { section: t('working.refPanel.tags') }),
      expandLabel: t('working.refPanel.expandSection', { section: t('working.refPanel.tags') }),
      children: (
        <RefList
          label={t('working.refPanel.tags')}
          count={refs.tags.length}
          empty={t('working.refPanel.emptyTags')}
          invalidDrop
        >
          <Tree
            className={styles.tree}
            label={t('working.refPanel.tags')}
            nodes={tagNodes}
            expanded={NO_EXPANDED_REFS}
            onExpandedChange={keepRefsCollapsed}
            selectionMode="single"
            selected={
              selectedRef?.kind === 'tag'
                ? new Set(
                    refs.tags.filter((tag) => tag.name === selectedRef.name).map((tag) => tag.id),
                  )
                : NO_EXPANDED_REFS
            }
            onSelectedChange={(next) => {
              const id = [...next][0];
              const tag = id ? tagById.get(id) : undefined;
              if (!tag) return;
              setSelectedRef({
                kind: 'tag',
                name: tag.name,
                isHead: false,
                target: tag.target,
              });
              setSelectedCommits(new Set([tag.target]));
              actions.goToNode(tag.target);
            }}
            onActivate={(row) => {
              const tag = tagById.get(row.id);
              if (tag) actions.goToNode(tag.target);
            }}
            autoHeight
            renderNode={(row) => {
              const tag = tagById.get(row.id);
              if (!tag) return row.label;
              return (
                <RefRow
                  kind="tag"
                  label={tag.name}
                  nestedInTree
                  menu={tagMenu(menuContext, tag)}
                  menuLabel={t('working.menu.tag.label', { tag: tag.name })}
                  drag={{ kind: 'tag', name: tag.name }}
                  colorIndex={refColors.get(tag.name)}
                  onDrop={(source) => {
                    handleDrop(source, { kind: 'tag', name: tag.name });
                  }}
                  selected={selectedRef?.kind === 'tag' && selectedRef.name === tag.name}
                />
              );
            }}
          />
        </RefList>
      ),
    },
    {
      key: 'stashes',
      label: t('working.refPanel.stashes'),
      icon: <RefIcon kind="stash" />,
      count: refs.stashes.length,
      collapsed: sectionsCollapsed.stashes,
      onToggleCollapsed: () => {
        toggle('stashes');
      },
      menu: sectionHeaderMenu(menuContext, 'stashes'),
      menuLabel: t('working.menu.section.label', { section: t('working.refPanel.stashes') }),
      collapseLabel: t('working.refPanel.collapseSection', {
        section: t('working.refPanel.stashes'),
      }),
      expandLabel: t('working.refPanel.expandSection', { section: t('working.refPanel.stashes') }),
      children: (
        <RefList
          label={t('working.refPanel.stashes')}
          count={refs.stashes.length}
          empty={t('working.refPanel.emptyStashes')}
        >
          <Tree
            className={styles.tree}
            label={t('working.refPanel.stashes')}
            nodes={stashNodes}
            expanded={NO_EXPANDED_REFS}
            onExpandedChange={keepRefsCollapsed}
            selectionMode="single"
            selected={new Set([...selectedCommits].filter((id) => id.startsWith('stash:')))}
            onSelectedChange={(next) => {
              const id = [...next][0];
              const stash = id ? stashById.get(id) : undefined;
              if (!stash || !id) return;
              setSelectedCommits(new Set([id]));
              actions.goToNode(stash.sha);
            }}
            autoHeight
            renderNode={(row) => {
              const stash = stashById.get(row.id);
              if (!stash) return row.label;
              return (
                <RefRow
                  kind="stash"
                  label={row.label}
                  nestedInTree
                  menu={stashMenu(menuContext, stash)}
                  menuLabel={t('working.menu.stash.label', { stash: stashName(stash) })}
                  selected={selectedCommits.has(row.id)}
                />
              );
            }}
          />
        </RefList>
      ),
    },
    {
      key: 'worktrees',
      label: t('working.refPanel.worktrees'),
      icon: <RefIcon kind="worktree" />,
      count: refs.worktrees.length,
      collapsed: sectionsCollapsed.worktrees,
      onToggleCollapsed: () => {
        toggle('worktrees');
      },
      menu: sectionHeaderMenu(menuContext, 'worktrees'),
      menuLabel: t('working.menu.section.label', { section: t('working.refPanel.worktrees') }),
      collapseLabel: t('working.refPanel.collapseSection', {
        section: t('working.refPanel.worktrees'),
      }),
      expandLabel: t('working.refPanel.expandSection', {
        section: t('working.refPanel.worktrees'),
      }),
      children: (
        <RefList
          label={t('working.refPanel.worktrees')}
          count={refs.worktrees.length}
          empty={t('working.refPanel.emptyWorktrees')}
          onWorktreeDrop={(branch) => {
            actions.createWorktree(branch);
          }}
        >
          <Tree
            className={styles.tree}
            label={t('working.refPanel.worktrees')}
            nodes={worktreeNodes}
            expanded={NO_EXPANDED_REFS}
            onExpandedChange={keepRefsCollapsed}
            selectionMode="single"
            selected={
              new Set(
                refs.worktrees
                  .filter((worktree) => selectedCommits.has(worktree.head))
                  .map((worktree) => worktree.path),
              )
            }
            onSelectedChange={(next) => {
              const id = [...next][0];
              const worktree = id ? worktreeById.get(id) : undefined;
              if (!worktree) return;
              setSelectedCommits(new Set([worktree.head]));
              actions.goToNode(worktree.head);
            }}
            onActivate={(row) => {
              const worktree = worktreeById.get(row.id);
              if (worktree && !worktree.missing) actions.openWorktree(worktree);
            }}
            autoHeight
            renderNode={(row) => {
              const worktree = worktreeById.get(row.id);
              if (!worktree) return row.label;
              return (
                <RefRow
                  kind="worktree"
                  label={worktree.name}
                  nestedInTree
                  menu={worktreeMenu(menuContext, worktree)}
                  menuLabel={t('working.menu.worktree.label', { worktree: worktree.name })}
                  selected={selectedCommits.has(worktree.head)}
                />
              );
            }}
          />
        </RefList>
      ),
    },
  ];

  return (
    <CollapsibleRail
      label={t('working.refPanel.label', { repo: repository.name })}
      sections={sections}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      collapseLabel={t('working.refPanel.collapse')}
      expandLabel={t('working.refPanel.expand')}
      collapseControlInHeader
      header={
        <RepoHeader
          repository={repository}
          head={refs.head}
          onGoToHead={onGoToHead}
          onCopy={actions.copy}
          onToggle={() => onCollapsedChange(true)}
        />
      }
      collapsedHeader={
        <RepoHeader
          repository={repository}
          head={refs.head}
          onGoToHead={onGoToHead}
          onCopy={actions.copy}
          collapsed
          onToggle={() => onCollapsedChange(false)}
        />
      }
    />
  );
}

/** El esqueleto de las cinco secciones — fila «Panel izquierdo» de la sección 3. */
export function RefPanelSkeleton() {
  const { t } = useI18n();

  return (
    <div className={styles.skeletons} role="status" aria-label={t('working.refPanel.loading')}>
      {SECTION_KEYS.map((key) => (
        <div key={key} className={styles.skeletonSection}>
          <Skeleton variant="text" style={{ width: '40%' }} />
          <Skeleton variant="block" style={{ height: 'var(--row-height)' }} />
          <Skeleton variant="block" style={{ height: 'var(--row-height)' }} />
        </div>
      ))}
    </div>
  );
}
