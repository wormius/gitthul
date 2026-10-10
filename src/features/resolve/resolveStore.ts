import { create } from 'zustand';

import type {
  BlockText,
  BlockLineSelection,
  LineOrigin,
  ResolutionSide,
  SideChoice,
} from './conflict';

/**
 * En cuál de los tres pasos está la vista — decisión 2 del subplan.
 *
 * Son tres pantallas distintas y no una con modos: de las listas se entra al
 * resolutor, y del resolutor a la comprobación, que es el único sitio desde el
 * que un archivo pasa a Resueltos.
 */
export type ResolveStep = 'lists' | 'resolver' | 'review' | 'resolved';

export interface ResolveState {
  step: ResolveStep;
  encodings: ReadonlyMap<string, string>;
  /** El archivo abierto en el resolutor o en la comprobación, o ninguno. */
  openPath: string | null;
  /** Los archivos marcados en las listas, para las acciones en bloque. */
  selected: ReadonlySet<string>;
  /**
   * Lo elegido en cada bloque del archivo abierto, en el orden de los clics.
   *
   * Vive aquí y no en el componente porque los gestos tienen que alcanzarlo:
   * `Alt+1` y `Alt+2` toman un lado del bloque actual, y `run()` no lleva
   * parámetros. Se vacía al abrir otro archivo — son de ese archivo.
   */
  choices: ReadonlyMap<string, readonly SideChoice[]>;
  blockText: ReadonlyMap<string, BlockText>;
  /**
   * El texto escrito a mano, por ruta — CU-6.
   *
   * Mientras hay entrada aquí, el archivo está **en modo manual**: lo escrito
   * manda sobre los bloques y los tres controles de toma se apagan. Es la
   * respuesta a la pregunta que F3.2 dejó abierta —qué gana cuando alguien
   * edita y después toma otro bloque— y se resuelve sin que nadie pierda nada:
   * volver a los bloques descarta lo escrito, y eso se dice antes de hacerlo.
   */
  manual: ReadonlyMap<string, string>;
  /** Los bloques en conflicto del archivo abierto, en orden. */
  blockIds: readonly string[];
  /** Sobre cuál actúan los tres botones de la cabecera y sus atajos. */
  blockIndex: number;
  /**
   * Lo escrito en el resolutor y todavía sin marcar como resuelto.
   *
   * Es lo que hace que cancelar no cueste nada: volver a abrir el archivo lo
   * encuentra como estaba. **No sobrevive al cierre de la aplicación** —CU-13—:
   * es estado de la vista, no del repositorio, y prometer que está cuando
   * podría no estar es peor que no prometerlo.
   */
  drafts: ReadonlyMap<string, string>;
  /** Procedencia por línea conservada para inspeccionar un resultado preparado. */
  resolutionSources: ReadonlyMap<string, { ours: string; theirs: string }>;
  resolutionOrigins: ReadonlyMap<string, readonly LineOrigin[]>;
  /**
   * Lo que resolvió la máquina, por ruta.
   *
   * Viene de `autoResolve` y solo sirve para marcarlo en la lista: de un
   * `WorkingStatus` se deduce que un archivo ya no está en conflicto, no quién
   * lo sacó de ahí.
   */
  autoResolved: ReadonlySet<string>;
  /**
   * Los que esta operación ya resolvió, que es la lista de Resueltos.
   *
   * No se deduce de `WorkingStatus`: un archivo resuelto queda preparado, y en
   * el stage hay también lo que se preparó antes de que empezara la fusión.
   */
  resolvedPaths: ReadonlySet<string>;
  /** La autoresolución corre una sola vez por operación — CU-2. */
  autoResolveDone: boolean;
  /**
   * Cuántos hay en cada lista.
   *
   * Los publica `ResolveView` en cuanto llega el estado, y los leen los gestos:
   * `run()` no lleva parámetros, así que si una acción se puede o no —aplicar
   * pide que no quede nada en conflicto— tiene que salir de aquí.
   */
  conflictedCount: number;
  resolvedCount: number;
  /**
   * Peticiones de lo que necesita puertos, con su nonce.
   *
   * Mismo patrón que `commitRequest` en `workingStore`: el registro de gestos
   * no conoce `GitPort`, así que deja la intención y la atiende quien sí lo
   * tiene. Las de rutas viajan con ellas porque la selección puede cambiar
   * entre que se pulsa y que se atiende.
   */
  unresolveRequest: { paths: readonly string[]; nonce: number } | null;
  revertRequest: { paths: readonly string[]; nonce: number } | null;
  autoRequest: number;
  keepStagedRequest: number;
  /** «Marcar como resuelto», que es lo único que escribe desde la comprobación. */
  markResolvedRequest: number;
}

export interface ResolveActions {
  setEncoding: (path: string, encoding: string) => void;
  /** Relee los bytes desde cero después de confirmar el descarte de las decisiones. */
  restartWithEncoding: (path: string, encoding: string) => void;
  openFile: (path: string) => void;
  openResolved: (path: string) => void;
  closeFile: () => void;
  goToReview: () => void;
  backToResolver: () => void;
  setSelected: (selected: ReadonlySet<string>) => void;
  setBlockIds: (ids: readonly string[]) => void;
  setManual: (path: string, text: string) => void;
  /** Vuelve a los bloques: lo escrito a mano se descarta. */
  clearManual: (path: string) => void;
  /** Toma un lado en el bloque actual, o lo quita si ya estaba tomado. */
  take: (side: SideChoice) => void;
  /** Añade líneas concretas de uno o varios bloques al resultado. */
  addLines: (side: ResolutionSide, selections: readonly BlockLineSelection[]) => void;
  /** Marca o desmarca una línea concreta sin depender de una selección de texto. */
  setLine: (
    side: ResolutionSide,
    blockId: string,
    index: number,
    selected: boolean,
    lineCount: number,
  ) => void;
  /** Marca o desmarca un lado completo de un bloque. */
  setBlockSide: (side: ResolutionSide, blockId: string, selected: boolean) => void;
  setBlockText: (blockId: string, text: string, resolved?: boolean) => void;
  /** Marca o desmarca ese lado en todos los bloques del archivo. */
  setAllSide: (side: ResolutionSide, selected: boolean) => void;
  setBlockIndex: (index: number) => void;
  nextBlock: () => void;
  previousBlock: () => void;
  setDraft: (
    path: string,
    content: string,
    origins?: readonly LineOrigin[],
    sources?: { ours: string; theirs: string },
  ) => void;
  clearDraft: (path: string) => void;
  markAutoResolved: (paths: readonly string[]) => void;
  markResolved: (paths: readonly string[]) => void;
  restoreResolved: (paths: readonly string[]) => void;
  unmarkResolved: (paths: readonly string[]) => void;
  setAutoResolveDone: (done: boolean) => void;
  setCounts: (counts: { conflicted: number; resolved: number }) => void;
  requestUnresolve: (paths: readonly string[]) => void;
  requestRevert: (paths: readonly string[]) => void;
  requestAuto: () => void;
  requestKeepStaged: () => void;
  requestMarkResolved: () => void;
  clearUnresolveRequest: () => void;
  clearRevertRequest: () => void;
  /** Vacía lo efímero; GitWorking refleja aparte las rutas resueltas en la sesión ligera. */
  unload: () => void;
}

function freshState(): ResolveState {
  return {
    step: 'lists',
    encodings: new Map(),
    openPath: null,
    selected: new Set(),
    choices: new Map(),
    blockText: new Map(),
    manual: new Map(),
    blockIds: [],
    blockIndex: 0,
    drafts: new Map(),
    resolutionOrigins: new Map(),
    resolutionSources: new Map(),
    autoResolved: new Set(),
    resolvedPaths: new Set(),
    autoResolveDone: false,
    conflictedCount: 0,
    resolvedCount: 0,
    unresolveRequest: null,
    revertRequest: null,
    autoRequest: 0,
    keepStagedRequest: 0,
    markResolvedRequest: 0,
  };
}

/**
 * El estado de Resolver que no vive en ningún componente.
 *
 * Vive aparte de `workingStore` aunque Resolver sea un estado de GitWorking:
 * lo que hay aquí solo existe mientras el repositorio tenga conflictos, y
 * mezclarlo con el store de la vista obligaría a limpiar seis campos más en su
 * `unload()` para algo que el 99 % del tiempo está vacío.
 */
export const useResolveStore = create<ResolveState & ResolveActions>((set) => ({
  ...freshState(),

  setEncoding: (path, encoding) => {
    set((state) => ({ encodings: new Map(state.encodings).set(path, encoding) }));
  },

  restartWithEncoding: (path, encoding) => {
    set((state) => {
      const manual = new Map(state.manual);
      manual.delete(path);
      return {
        encodings: new Map(state.encodings).set(path, encoding),
        choices: new Map(),
        blockText: new Map(),
        manual,
        blockIds: [],
        blockIndex: 0,
      };
    });
  },

  openFile: (openPath) => {
    // Las decisiones son del archivo que se abre, no de la sesión.
    set({
      openPath,
      step: 'resolver',
      choices: new Map(),
      blockText: new Map(),
      blockIds: [],
      blockIndex: 0,
    });
  },

  openResolved: (openPath) => {
    set({ openPath, step: 'resolved' });
  },

  closeFile: () => {
    set({ openPath: null, step: 'lists' });
  },

  goToReview: () => {
    set({ step: 'review' });
  },

  backToResolver: () => {
    set({ step: 'resolver' });
  },

  setSelected: (selected) => {
    set({ selected });
  },

  setManual: (path, text) => {
    set((state) => ({ manual: new Map(state.manual).set(path, text) }));
  },

  clearManual: (path) => {
    set((state) => {
      const manual = new Map(state.manual);

      manual.delete(path);

      return { manual };
    });
  },

  setBlockIds: (blockIds) => {
    set((state) => ({
      blockIds,
      blockIndex: Math.min(state.blockIndex, Math.max(0, blockIds.length - 1)),
    }));
  },

  /*
   * Tomar un lado suma, y volver a tomarlo resta — CU-5. «Sin contenido» no
   * suma: es la decisión de que ahí no va nada, así que sustituye a lo que
   * hubiera.
   */
  take: (side) => {
    set((state) => {
      const id = state.blockIds[state.blockIndex];

      if (id === undefined) return {};

      const current = state.choices.get(id) ?? [];
      const withoutLinesFromSide =
        side === 'ours' || side === 'theirs'
          ? current.filter((choice) => !choice.startsWith(`${side}:`))
          : current;
      const next =
        side === 'none'
          ? ['none' as const]
          : withoutLinesFromSide.includes(side)
            ? withoutLinesFromSide.filter((choice) => choice !== side)
            : [...withoutLinesFromSide.filter((choice) => choice !== 'none'), side];

      const choices = new Map(state.choices);

      if (next.length === 0) choices.delete(id);
      else choices.set(id, next);

      return {
        choices,
        // Un cursor colocado en un hueco aún no aporta una línea al resultado.
        blockText: new Map(
          [...state.blockText].filter(([id, draft]) => draft.resolved || !choices.has(id)),
        ),
      };
    });
  },

  addLines: (side, selections) => {
    set((state) => {
      if (selections.length === 0) return {};

      const choices = new Map(state.choices);

      for (const selection of selections) {
        const current = choices.get(selection.blockId) ?? [];

        // El lado completo ya contiene todas sus líneas; volver a agregarlas no
        // debe duplicarlas. Una selección concreta sí sustituye «sin contenido».
        if (current.includes(side)) continue;

        const next = current.filter((choice) => choice !== 'none');

        for (const choice of selection.choices) {
          if (!next.includes(choice)) next.push(choice);
        }

        if (next.length > 0) choices.set(selection.blockId, next);
      }

      return {
        choices,
        // Un cursor colocado en un hueco aún no aporta una línea al resultado.
        blockText: new Map(
          [...state.blockText].filter(([id, draft]) => draft.resolved || !choices.has(id)),
        ),
      };
    });
  },

  setLine: (side, blockId, index, selected, lineCount) => {
    set((state) => {
      const choices = new Map(state.choices);
      const current = choices.get(blockId) ?? [];
      const line = `${side}:${index}` as const;
      let next = current.filter((choice) => choice !== 'none');

      // Un lado entero y sus líneas sueltas son dos representaciones de la
      // misma decisión. Al desmarcar una línea se expande primero el lado para
      // conservar seleccionadas todas las demás.
      if (next.includes(side)) {
        next = next.filter((choice) => choice !== side);
        next.push(
          ...Array.from({ length: lineCount }, (_, lineIndex) => `${side}:${lineIndex}` as const),
        );
      }

      next = selected
        ? next.includes(line)
          ? next
          : [...next, line]
        : next.filter((choice) => choice !== line);

      if (next.length === 0) choices.delete(blockId);
      else choices.set(blockId, next);

      return {
        choices,
        // Un cursor colocado en un hueco aún no aporta una línea al resultado.
        blockText: new Map(
          [...state.blockText].filter(([id, draft]) => draft.resolved || !choices.has(id)),
        ),
      };
    });
  },

  setBlockText: (blockId, text, resolved = true) => {
    set((state) => ({ blockText: new Map(state.blockText).set(blockId, { text, resolved }) }));
  },

  setBlockSide: (side, blockId, selected) => {
    set((state) => {
      const choices = new Map(state.choices);
      const current = choices.get(blockId) ?? [];
      const withoutSide = current.filter(
        (choice) => choice !== side && !choice.startsWith(`${side}:`) && choice !== 'none',
      );
      const next = selected ? [...withoutSide, side] : withoutSide;

      if (next.length === 0) choices.delete(blockId);
      else choices.set(blockId, next);

      return {
        choices,
        // Un cursor colocado en un hueco aún no aporta una línea al resultado.
        blockText: new Map(
          [...state.blockText].filter(([id, draft]) => draft.resolved || !choices.has(id)),
        ),
      };
    });
  },

  setAllSide: (side, selected) => {
    set((state) => {
      const choices = new Map(state.choices);

      for (const blockId of state.blockIds) {
        const current = choices.get(blockId) ?? [];
        const withoutSide = current.filter(
          (choice) => choice !== side && !choice.startsWith(`${side}:`) && choice !== 'none',
        );
        const next = selected ? [...withoutSide, side] : withoutSide;

        if (next.length === 0) choices.delete(blockId);
        else choices.set(blockId, next);
      }

      return {
        choices,
        // Un cursor colocado en un hueco aún no aporta una línea al resultado.
        blockText: new Map(
          [...state.blockText].filter(([id, draft]) => draft.resolved || !choices.has(id)),
        ),
      };
    });
  },

  setBlockIndex: (index) => {
    set((state) => ({
      blockIndex: Math.max(0, Math.min(index, Math.max(0, state.blockIds.length - 1))),
    }));
  },

  nextBlock: () => {
    set((state) => ({
      blockIndex: Math.min(state.blockIndex + 1, Math.max(0, state.blockIds.length - 1)),
    }));
  },

  previousBlock: () => {
    set((state) => ({ blockIndex: Math.max(0, state.blockIndex - 1) }));
  },

  setDraft: (path, content, origins, sources) => {
    set((state) => ({
      drafts: new Map(state.drafts).set(path, content),
      resolutionSources: sources
        ? new Map(state.resolutionSources).set(path, sources)
        : state.resolutionSources,
      resolutionOrigins:
        origins === undefined
          ? state.resolutionOrigins
          : new Map(state.resolutionOrigins).set(path, origins),
    }));
  },

  clearDraft: (path) => {
    set((state) => {
      const drafts = new Map(state.drafts);
      const resolutionOrigins = new Map(state.resolutionOrigins);
      const resolutionSources = new Map(state.resolutionSources);

      drafts.delete(path);
      resolutionOrigins.delete(path);
      resolutionSources.delete(path);

      return { drafts, resolutionOrigins, resolutionSources };
    });
  },

  markAutoResolved: (paths) => {
    set((state) => ({
      autoResolved: new Set([...state.autoResolved, ...paths]),
      resolvedPaths: new Set([...state.resolvedPaths, ...paths]),
    }));
  },

  markResolved: (paths) => {
    set((state) => ({ resolvedPaths: new Set([...state.resolvedPaths, ...paths]) }));
  },

  restoreResolved: (paths) => {
    set({ resolvedPaths: new Set(paths) });
  },

  unmarkResolved: (paths) => {
    set((state) => {
      const resolvedPaths = new Set(state.resolvedPaths);
      const autoResolved = new Set(state.autoResolved);

      for (const path of paths) {
        resolvedPaths.delete(path);
        autoResolved.delete(path);
      }

      return { resolvedPaths, autoResolved };
    });
  },

  setAutoResolveDone: (autoResolveDone) => {
    set({ autoResolveDone });
  },

  setCounts: ({ conflicted, resolved }) => {
    set({ conflictedCount: conflicted, resolvedCount: resolved });
  },

  requestUnresolve: (paths) => {
    set((state) => ({
      unresolveRequest: { paths, nonce: (state.unresolveRequest?.nonce ?? 0) + 1 },
    }));
  },

  requestRevert: (paths) => {
    set((state) => ({
      revertRequest: { paths, nonce: (state.revertRequest?.nonce ?? 0) + 1 },
    }));
  },

  requestAuto: () => {
    set((state) => ({ autoRequest: state.autoRequest + 1 }));
  },

  requestKeepStaged: () => {
    set((state) => ({ keepStagedRequest: state.keepStagedRequest + 1 }));
  },

  requestMarkResolved: () => {
    set((state) => ({ markResolvedRequest: state.markResolvedRequest + 1 }));
  },

  clearUnresolveRequest: () => {
    set({ unresolveRequest: null });
  },

  clearRevertRequest: () => {
    set({ revertRequest: null });
  },

  unload: () => {
    set(freshState());
  },
}));
