import type { ITheme } from '@xterm/xterm';

/** Xterm recibe la misma paleta que el prompt, la salida y las vistas previas. */
export function readTerminalTheme(computed: CSSStyleDeclaration): ITheme {
  const token = (name: string, fallback: string) =>
    computed.getPropertyValue(`--terminal-${name}`).trim() || fallback;
  const background = token('bg', computed.backgroundColor);
  const foreground = token('foreground', computed.color);

  return {
    background,
    foreground,
    cursor: token('prompt', foreground),
    cursorAccent: background,
    selectionBackground: token('selection', background),
    selectionForeground: foreground,
    black: token('black', foreground),
    red: token('red', foreground),
    green: token('green', foreground),
    yellow: token('yellow', foreground),
    blue: token('blue', foreground),
    magenta: token('magenta', foreground),
    cyan: token('cyan', foreground),
    white: token('white', foreground),
    brightBlack: token('bright-black', foreground),
    brightRed: token('bright-red', foreground),
    brightGreen: token('bright-green', foreground),
    brightYellow: token('bright-yellow', foreground),
    brightBlue: token('bright-blue', foreground),
    brightMagenta: token('bright-magenta', foreground),
    brightCyan: token('bright-cyan', foreground),
    brightWhite: token('bright-white', foreground),
  };
}
