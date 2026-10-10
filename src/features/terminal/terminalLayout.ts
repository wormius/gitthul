import type {
  TerminalLayout,
  TerminalLayoutNode,
  TerminalPaneDescriptor,
} from '@core/domain/terminal';

export function initialTerminalLayout(cwd: string): TerminalLayout {
  return {
    root: { kind: 'pane', id: 'pane-1', title: null, cwd },
    activePaneId: 'pane-1',
  };
}

export function terminalPanes(node: TerminalLayoutNode): readonly TerminalPaneDescriptor[] {
  return node.kind === 'pane'
    ? [node]
    : [...terminalPanes(node.first), ...terminalPanes(node.second)];
}

export function splitTerminalPane(
  layout: TerminalLayout,
  paneId: string,
  orientation: 'horizontal' | 'vertical',
): TerminalLayout {
  const source = terminalPanes(layout.root).find((pane) => pane.id === paneId);
  if (!source) return layout;

  const paneIds = new Set(terminalPanes(layout.root).map((pane) => pane.id));
  let index = paneIds.size + 1;
  while (paneIds.has(`pane-${String(index)}`)) index += 1;
  const nextId = `pane-${String(index)}`;
  const next: TerminalPaneDescriptor = {
    kind: 'pane',
    id: nextId,
    title: null,
    cwd: source.cwd,
  };
  const root = replaceNode(layout.root, paneId, (current) => ({
    kind: 'split',
    id: `split-${nextId}`,
    orientation,
    ratio: 0.5,
    first: current,
    second: next,
  }));

  return { root, activePaneId: nextId };
}

export function closeTerminalPane(layout: TerminalLayout, paneId: string): TerminalLayout {
  if (layout.root.kind === 'pane') return layout;

  const result = removeNode(layout.root, paneId);
  if (!result.removed) return layout;
  const panes = terminalPanes(result.node);
  const activePaneId =
    layout.activePaneId === paneId
      ? (result.fallbackPaneId ?? panes[0]?.id ?? layout.activePaneId)
      : layout.activePaneId;

  return { root: result.node, activePaneId };
}

export function renameTerminalPane(
  layout: TerminalLayout,
  paneId: string,
  title: string,
): TerminalLayout {
  const normalized = title.trim();
  return {
    ...layout,
    root: replaceNode(layout.root, paneId, (node) =>
      node.kind === 'pane' ? { ...node, title: normalized || null } : node,
    ),
  };
}

export function updateTerminalPaneCwd(
  layout: TerminalLayout,
  paneId: string,
  cwd: string,
): TerminalLayout {
  if (!cwd) return layout;
  const root = replaceNode(layout.root, paneId, (node) =>
    node.kind === 'pane' && node.cwd !== cwd ? { ...node, cwd } : node,
  );
  return root === layout.root ? layout : { ...layout, root };
}

export function resizeTerminalSplit(
  layout: TerminalLayout,
  splitId: string,
  ratio: number,
): TerminalLayout {
  return {
    ...layout,
    root: replaceNode(layout.root, splitId, (node) =>
      node.kind === 'split' ? { ...node, ratio: Math.min(0.9, Math.max(0.1, ratio)) } : node,
    ),
  };
}

export function activateTerminalPane(layout: TerminalLayout, paneId: string): TerminalLayout {
  if (layout.activePaneId === paneId) return layout;
  return terminalPanes(layout.root).some((pane) => pane.id === paneId)
    ? { ...layout, activePaneId: paneId }
    : layout;
}

function replaceNode(
  node: TerminalLayoutNode,
  id: string,
  replace: (node: TerminalLayoutNode) => TerminalLayoutNode,
): TerminalLayoutNode {
  if (node.id === id) return replace(node);
  if (node.kind === 'pane') return node;

  const first = replaceNode(node.first, id, replace);
  const second = replaceNode(node.second, id, replace);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function removeNode(
  node: TerminalLayoutNode,
  paneId: string,
): { node: TerminalLayoutNode; removed: boolean; fallbackPaneId?: string } {
  if (node.kind === 'pane') return { node, removed: false };
  if (node.first.kind === 'pane' && node.first.id === paneId) {
    return { node: node.second, removed: true, fallbackPaneId: terminalPanes(node.second)[0]?.id };
  }
  if (node.second.kind === 'pane' && node.second.id === paneId) {
    return { node: node.first, removed: true, fallbackPaneId: terminalPanes(node.first)[0]?.id };
  }

  const first = removeNode(node.first, paneId);
  if (first.removed) return { ...first, node: { ...node, first: first.node } };
  const second = removeNode(node.second, paneId);
  return second.removed
    ? { ...second, node: { ...node, second: second.node } }
    : { node, removed: false };
}
