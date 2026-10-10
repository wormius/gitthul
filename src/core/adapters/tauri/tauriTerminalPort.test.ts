import { describe, expect, it, vi } from 'vitest';

import { createTauriTerminalPort } from './tauriTerminalPort';

describe('createTauriTerminalPort', () => {
  it('crea la sesión con canal de bytes y conserva escritura, resize y cierre', async () => {
    const call = vi.fn(() => Promise.resolve(undefined));
    let receive: ((data: number[] | ArrayBuffer) => void) | undefined;
    let receiveCwd: ((cwd: string) => void) | undefined;
    let receiveExit:
      ((exit: { code: number; signal: string | null; success: boolean }) => void) | undefined;
    const channel = { channel: 'terminal' };
    const cwdChannel = { channel: 'cwd' };
    const exitChannel = { channel: 'exit' };
    const port = createTauriTerminalPort(
      call,
      (handler) => {
        receive = handler;
        return Promise.resolve(channel);
      },
      (handler) => {
        receiveCwd = handler;
        return Promise.resolve(cwdChannel);
      },
      (handler) => {
        receiveExit = handler;
        return Promise.resolve(exitChannel);
      },
    );
    const onData = vi.fn();
    const onCwd = vi.fn();
    const onExit = vi.fn();

    await port.createSession({
      sessionId: 'terminal-1',
      cwd: '/repo',
      cols: 96,
      rows: 28,
      onData,
      onCwd,
      onExit,
    });
    receive?.([27, 91, 51, 49, 109]);
    receiveCwd?.('/repo/packages/app');
    receiveExit?.({ code: 7, signal: null, success: false });
    await port.write('terminal-1', 'git status\r');
    await port.resize('terminal-1', 120, 36);
    await port.closeSession('terminal-1');

    expect(onData).toHaveBeenCalledWith(Uint8Array.from([27, 91, 51, 49, 109]));
    expect(onCwd).toHaveBeenCalledWith('/repo/packages/app');
    expect(onExit).toHaveBeenCalledWith({ code: 7, signal: null, success: false });
    expect(call.mock.calls).toEqual([
      [
        'terminal_create_session',
        {
          sessionId: 'terminal-1',
          cwd: '/repo',
          cols: 96,
          rows: 28,
          onData: channel,
          onCwd: cwdChannel,
          onExit: exitChannel,
        },
      ],
      ['terminal_write', { sessionId: 'terminal-1', data: 'git status\r' }],
      ['terminal_resize', { sessionId: 'terminal-1', cols: 120, rows: 36 }],
      ['terminal_close_session', { sessionId: 'terminal-1' }],
    ]);
  });

  it('acepta el ArrayBuffer binario que Tauri usa para mensajes pequeños', async () => {
    let receive: ((data: number[] | ArrayBuffer) => void) | undefined;
    const port = createTauriTerminalPort(
      () => Promise.resolve(undefined),
      (handler) => {
        receive = handler;
        return Promise.resolve({});
      },
      () => Promise.resolve({}),
      () => Promise.resolve({}),
    );
    const onData = vi.fn();
    await port.createSession({ sessionId: 's', cwd: '', cols: 80, rows: 24, onData });

    receive?.(Uint8Array.from([195, 177]).buffer);

    expect(onData).toHaveBeenCalledWith(Uint8Array.from([195, 177]));
  });
});
