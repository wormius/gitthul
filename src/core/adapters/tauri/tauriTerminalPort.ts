import type { TerminalExit, TerminalPtyPort } from '@core/ports/TerminalPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type ChannelFactory = (handler: (data: number[] | ArrayBuffer) => void) => Promise<unknown>;
type CwdChannelFactory = (handler: (cwd: string) => void) => Promise<unknown>;
type ExitChannelFactory = (handler: (exit: TerminalExit) => void) => Promise<unknown>;

async function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

async function tauriChannel(handler: (data: number[] | ArrayBuffer) => void): Promise<unknown> {
  const { Channel } = await import('@tauri-apps/api/core');
  return new Channel(handler);
}

async function tauriCwdChannel(handler: (cwd: string) => void): Promise<unknown> {
  const { Channel } = await import('@tauri-apps/api/core');
  return new Channel(handler);
}

async function tauriExitChannel(handler: (exit: TerminalExit) => void): Promise<unknown> {
  const { Channel } = await import('@tauri-apps/api/core');
  return new Channel(handler);
}

/** Transporte nativo de Terminal: Tauri mueve bytes, xterm interpreta la terminal. */
export function createTauriTerminalPort(
  call: Invoke = tauriInvoke,
  makeChannel: ChannelFactory = tauriChannel,
  makeCwdChannel: CwdChannelFactory = tauriCwdChannel,
  makeExitChannel: ExitChannelFactory = tauriExitChannel,
): TerminalPtyPort {
  return {
    kind: 'pty',
    async createSession(request) {
      const onData = await makeChannel((data) => {
        request.onData(data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data));
      });
      const onCwd = await makeCwdChannel((cwd) => request.onCwd?.(cwd));
      const onExit = await makeExitChannel((exit) => request.onExit?.(exit));
      await call('terminal_create_session', {
        sessionId: request.sessionId,
        cwd: request.cwd,
        cols: request.cols,
        rows: request.rows,
        onData,
        onCwd,
        onExit,
      });
    },
    async write(sessionId, data) {
      await call('terminal_write', { sessionId, data });
    },
    async resize(sessionId, cols, rows) {
      await call('terminal_resize', { sessionId, cols, rows });
    },
    async closeSession(sessionId) {
      await call('terminal_close_session', { sessionId });
    },
  };
}
