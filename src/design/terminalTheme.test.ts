import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHexColor } from './color';
import { readTerminalTheme } from './terminalTheme';
import { MODES, THEMES } from './theme';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'terminalPalette.css'),
  'utf8',
);

describe('paleta de Terminal', () => {
  it.each(THEMES)('%s tiene una paleta ANSI legible en los dos modos', (theme) => {
    for (const mode of MODES) {
      const selector = `[data-theme='${theme}'][data-mode='${mode}']`;
      const body = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]+)\}/g)].find(
        (match) => match[1]?.split(',').some((value) => value.trim() === selector),
      )?.[2];
      expect(body).toBeDefined();
      const colors: Record<string, string> = {};
      for (const match of body!.matchAll(/--palette-terminal-([a-z-]+): (#[a-f0-9]+);/g)) {
        if (match[1] && match[2]) colors[match[1]] = match[2];
      }
      expect(colors['bg']).toBe(mode === 'light' ? '#fafafa' : '#111111');
      const background = parseHexColor(colors['bg']!)!;
      const minimum = theme === 'contraste' ? 7 : 4.5;
      for (const [name, value] of Object.entries(colors)) {
        if (name === 'bg' || name === 'selection') continue;
        expect(
          contrastRatio(parseHexColor(value)!, background),
          `${theme}/${mode}/${name}`,
        ).toBeGreaterThanOrEqual(minimum);
      }
      expect(
        contrastRatio(parseHexColor(colors['foreground']!)!, parseHexColor(colors['selection']!)!),
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('entrega a xterm el acento de Terminal y todos los colores ANSI', () => {
    const colors = {
      bg: '#111111',
      foreground: '#e2eee9',
      prompt: '#83ecad',
      red: '#ff929a',
      'bright-blue': '#bbd9ff',
      selection: '#303030',
    };
    const computed = {
      backgroundColor: '',
      color: '',
      getPropertyValue: (name: string) =>
        colors[name.replace('--terminal-', '') as keyof typeof colors] ?? '',
    } as CSSStyleDeclaration;
    const result = readTerminalTheme(computed);
    expect(result).toMatchObject({
      background: colors.bg,
      foreground: colors.foreground,
      cursor: colors.prompt,
      cursorAccent: colors.bg,
      red: colors.red,
      brightBlue: colors['bright-blue'],
      selectionBackground: colors.selection,
    });
    expect(Object.keys(result)).toHaveLength(22);
  });
});
