import type { TerminalOutputLine } from '@core/domain/terminal';
import type { TerminalCommandPort } from '@core/ports/TerminalPort';

import { wait, type LatencyRange, NO_LATENCY } from './latency';

export interface MockTerminalPortOptions {
  /** Retraso entre líneas de salida. Sin ella el streaming no se ve. */
  lineDelay?: LatencyRange;
}

/**
 * Salida fija por comando. Si alguien añade un comando aquí, la prueba lo
 * ejerce automáticamente — no hay que sincronizar otra tabla.
 */
const COMMAND_TABLE: Record<string, readonly string[]> = {
  'git status': [
    'On branch main',
    "Your branch is up to date with 'origin/main'.",
    '',
    'nothing to commit, working tree clean',
  ],
  'git log --oneline': [
    'a1b2c3d feat: add user authentication',
    'e4f5a6b fix: resolve merge conflict in settings',
    'c7d8e9f refactor: extract validation logic',
    '0a1b2c3 docs: update README with new API',
    'd4e5f6a chore: bump dependencies',
  ],
  'git branch': ['* main', '  develop', '  feature/auth', '  hotfix/login'],
  'git branch -a': [
    '* main',
    '  develop',
    '  feature/auth',
    '  hotfix/login',
    '  remotes/origin/main',
    '  remotes/origin/develop',
  ],
  ls: ['README.md', 'package.json', 'src/', 'docs/', 'node_modules/', '.gitignore'],
  pwd: ['/home/user/projects/my-repo'],
};

/**
 * Terminal falsa: eco y tabla de comandos.
 *
 * Reconoce los comandos de `COMMAND_TABLE` y devuelve su salida fija. `echo`
 * repite sus argumentos. `clear` emite una marca especial que el componente
 * interpreta como «vaciar la pantalla». Todo lo demás da «command not found».
 * El historial se acumula en memoria por sesión.
 */
export function createMockTerminalPort(options: MockTerminalPortOptions = {}): TerminalCommandPort {
  const lineDelay = options.lineDelay ?? NO_LATENCY;
  const sessions = new Map<string, string[]>();

  function history(sessionId: string): string[] {
    let list = sessions.get(sessionId);

    if (!list) {
      list = [];
      sessions.set(sessionId, list);
    }

    return list;
  }

  return {
    kind: 'commands',
    execute(sessionId: string, command: string, signal?: AbortSignal) {
      const trimmed = command.trim();

      history(sessionId).push(trimmed);

      return {
        [Symbol.asyncIterator](): AsyncIterator<TerminalOutputLine> {
          const lines = resolveCommand(trimmed);
          let index = 0;

          return {
            async next() {
              if (signal?.aborted || index >= lines.length) {
                return { done: true, value: undefined };
              }

              if (lineDelay.max > 0) {
                const ms = lineDelay.min + Math.random() * (lineDelay.max - lineDelay.min);

                await wait(ms, signal);
              }

              const line = lines[index]!;

              index += 1;

              return { done: false, value: line };
            },
          };
        },
      };
    },

    getHistory(sessionId: string) {
      return Promise.resolve([...(sessions.get(sessionId) ?? [])]);
    },
  };
}

/**
 * Resuelve un comando en sus líneas de salida.
 *
 * - `clear` → marca especial que el componente interpreta.
 * - `echo <args>` → repite los argumentos.
 * - Tabla de conocidos → salida fija.
 * - Todo lo demás → «command not found».
 */
function resolveCommand(command: string): readonly TerminalOutputLine[] {
  if (command === 'clear') {
    return [{ stream: 'stdout', text: '\x1b[clear]' }];
  }

  if (command.startsWith('echo ')) {
    return [{ stream: 'stdout', text: command.slice(5) }];
  }

  const fixed = COMMAND_TABLE[command];

  if (fixed) {
    return fixed.map((text) => ({ stream: 'stdout', text }));
  }

  const bin = command.split(' ')[0] ?? command;

  return [{ stream: 'stderr', text: `command not found: ${bin}` }];
}
