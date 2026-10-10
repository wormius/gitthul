import type { TerminalLayout, TerminalLayoutNode } from './terminal';

export const SESSION_VERSION = 1;

export interface SessionResolution {
  /** Identifica la operación Git a la que pertenecen las rutas. */
  operation: string;
  /** Solo rutas; el contenido se vuelve a leer del repositorio. */
  paths: readonly string[];
}

export interface SessionWorkingSurface {
  kind: 'working';
  repoId: string;
  repoName: string;
  repoPath: string;
  branch: string;
  worktreeOf?: string;
  resolution?: SessionResolution;
}

export interface SessionTerminalSurface {
  kind: 'terminal';
  cwd: string;
  layout?: TerminalLayout;
}

export type SessionSurface = SessionWorkingSurface | SessionTerminalSurface;

export interface SessionContext {
  repository: SessionWorkingSurface | null;
  cwd: string | null;
}

export interface SessionTab {
  id: string;
  surface: SessionSurface;
  context: SessionContext;
}

/** Solo descriptores recuperables; nunca instancias, consultas, PTY ni estado de carga. */
export interface SessionSnapshot {
  version: typeof SESSION_VERSION;
  tabs: readonly SessionTab[];
  activeId: string | null;
}

export const EMPTY_SESSION: SessionSnapshot = {
  version: SESSION_VERSION,
  tabs: [],
  activeId: null,
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function resolution(value: unknown): SessionResolution | null {
  const raw = record(value);
  const operation = text(raw['operation']);
  if (!operation || !Array.isArray(raw['paths'])) return null;

  const paths = [
    ...new Set(
      raw['paths'].filter(
        (path): path is string => typeof path === 'string' && path !== '' && !path.includes('\0'),
      ),
    ),
  ].slice(0, 10_000);

  return paths.length > 0 ? { operation, paths } : null;
}

function workingSurface(value: unknown): SessionWorkingSurface | null {
  const raw = record(value);
  if (raw['kind'] !== 'working') return null;

  const repoId = text(raw['repoId']);
  const repoName = text(raw['repoName']);
  const repoPath = text(raw['repoPath']);
  const branch = text(raw['branch']);
  if (!repoId || !repoName || !repoPath || !branch) return null;

  const worktreeOf = text(raw['worktreeOf']);
  const savedResolution = resolution(raw['resolution']);
  return {
    kind: 'working',
    repoId,
    repoName,
    repoPath,
    branch,
    ...(worktreeOf ? { worktreeOf } : {}),
    ...(savedResolution ? { resolution: savedResolution } : {}),
  };
}

function surface(value: unknown): SessionSurface | null {
  const raw = record(value);
  if (raw['kind'] === 'working') return workingSurface(raw);
  if (raw['kind'] === 'terminal') {
    const cwd = text(raw['cwd']);
    if (!cwd) return null;
    const layout = normalizeTerminalLayout(raw['layout']);
    return { kind: 'terminal', cwd, ...(layout ? { layout } : {}) };
  }
  return null;
}

function normalizeTerminalLayout(value: unknown): TerminalLayout | null {
  const raw = record(value);
  const ids = new Set<string>();
  const paneIds = new Set<string>();
  let count = 0;

  const node = (candidate: unknown, depth: number): TerminalLayoutNode | null => {
    if (depth > 12 || count >= 32) return null;
    const item = record(candidate);
    const id = text(item['id']);
    if (!id || ids.has(id)) return null;
    ids.add(id);
    count += 1;

    if (item['kind'] === 'pane') {
      const cwd = text(item['cwd']);
      if (!cwd) return null;
      const title = text(item['title']);
      paneIds.add(id);
      return { kind: 'pane', id, title, cwd };
    }
    if (item['kind'] !== 'split') return null;
    const orientation = item['orientation'];
    const ratio = item['ratio'];
    if (
      (orientation !== 'horizontal' && orientation !== 'vertical') ||
      typeof ratio !== 'number' ||
      !Number.isFinite(ratio)
    ) {
      return null;
    }
    const first = node(item['first'], depth + 1);
    const second = node(item['second'], depth + 1);
    if (!first || !second) return null;
    return {
      kind: 'split',
      id,
      orientation,
      ratio: Math.min(0.9, Math.max(0.1, ratio)),
      first,
      second,
    };
  };

  const root = node(raw['root'], 0);
  const activePaneId = text(raw['activePaneId']);
  if (!root || !activePaneId || !paneIds.has(activePaneId)) return null;
  return { root, activePaneId };
}

function context(value: unknown, current: SessionSurface): SessionContext {
  const raw = record(value);
  const repository = workingSurface(raw['repository']);

  if (current.kind === 'working') {
    return { repository: current, cwd: current.repoPath };
  }

  return { repository, cwd: current.cwd };
}

function tab(value: unknown): SessionTab | null {
  const raw = record(value);
  const id = text(raw['id']);
  const history = Array.isArray(raw['history'])
    ? raw['history'].map(surface).filter((item): item is SessionSurface => item !== null)
    : [];
  const current = surface(raw['surface']) ?? history.at(-1) ?? null;
  if (!id || !current) return null;

  return {
    id,
    surface: current,
    context: context(raw['context'], current),
  };
}

/** Recupera todo lo válido y descarta entradas corruptas o ids repetidos. */
export function normalizeSession(value: unknown): SessionSnapshot {
  const raw = record(value);
  const values = Array.isArray(raw['tabs']) ? raw['tabs'] : [];
  const ids = new Set<string>();
  const tabs: SessionTab[] = [];

  for (const value of values) {
    const candidate = tab(value);
    if (!candidate || ids.has(candidate.id)) continue;
    ids.add(candidate.id);
    tabs.push(candidate);
  }

  const requestedActive = text(raw['activeId']);
  return {
    version: SESSION_VERSION,
    tabs,
    activeId: requestedActive && ids.has(requestedActive) ? requestedActive : null,
  };
}
