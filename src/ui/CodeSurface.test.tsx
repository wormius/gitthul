import { EditorView } from '@codemirror/view';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CodeSurface } from './CodeSurface';
import * as codeSurface from './codeSurfaceUtils';
import type { CodeSurfaceFoldLabels } from './CodeSurface';

/*
 * Lo que se puede afirmar sobre CodeMirror dentro de jsdom.
 *
 * El editor monta, escribe sus líneas y sus márgenes en el DOM y responde a los
 * eventos, así que todo lo que es contenido y semántica se prueba de verdad. Lo
 * que no existe en jsdom es el diseño: `getBoundingClientRect` da ceros, y
 * CodeMirror decide con eso que no cabe nada, así que **la virtualización de
 * líneas no se puede ejercitar aquí** — con documentos cortos pinta todo y con
 * documentos largos no hay medidas que comprobar. Igual pasa con el ancho de
 * carácter que se remide al cambiar de fuente: se comprueba que el observador
 * pida la medición, no el resultado.
 */

const SAMPLE = [
  'export function resolveTheme(settings) {',
  '  const mode = settings.mode;',
  '',
  '  if (mode === "auto") {',
  '    return system.mode;',
  '  }',
  '',
  '  return mode;',
  '}',
].join('\n');

const FOLD_LABELS: CodeSurfaceFoldLabels = {
  fold: 'Plegar el bloque',
  unfold: 'Desplegar el bloque',
  folded: '…',
};

function renderSurface(props: Partial<Parameters<typeof CodeSurface>[0]> = {}) {
  return render(<CodeSurface value={SAMPLE} label="src/design/theme.ts" {...props} />);
}

const editor = () => screen.getByRole('textbox', { name: 'src/design/theme.ts' });

/**
 * Los números que se ven en el margen izquierdo, en orden.
 *
 * El primero del margen no es una línea: es el separador invisible con el que
 * CodeMirror reserva el ancho del número más largo, y va oculto.
 */
function lineNumbersOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
    .filter((element) => !(element as HTMLElement).style.visibility)
    .map((element) => element.textContent ?? '');
}

describe('CodeSurface', () => {
  it('se anuncia con el nombre de lo que enseña', () => {
    renderSurface();

    expect(editor()).toBeInTheDocument();
  });

  it('pinta el texto que recibe, línea a línea', () => {
    const { container } = renderSurface();

    const lines = [...container.querySelectorAll('.cm-line')].map((line) => line.textContent);

    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe('export function resolveTheme(settings) {');
    expect(lines[8]).toBe('}');
  });

  it('numera las líneas desde uno', () => {
    const { container } = renderSurface();

    expect(lineNumbersOf(container).slice(0, 3)).toEqual(['1', '2', '3']);
  });

  it('un hunk suelto empieza a numerar donde le digan', () => {
    const { container } = renderSurface({ firstLineNumber: 128 });

    expect(lineNumbersOf(container).slice(0, 3)).toEqual(['128', '129', '130']);
  });

  it('se puede quitar el margen de números', () => {
    const { container } = renderSurface({ showLineNumbers: false });

    expect(container.querySelector('.cm-lineNumbers')).toBeNull();
  });

  it('es de solo lectura mientras no digan lo contrario', () => {
    renderSurface();

    expect(editor()).toHaveAttribute('contenteditable', 'false');
  });

  it('editable avisa de lo que se escribe', async () => {
    const onChange = vi.fn();

    renderSurface({ readOnly: false, onChange, value: 'uno' });

    await userEvent.click(editor());
    await userEvent.keyboard('!');

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('!');
  });

  it('cambiar el texto desde fuera repinta el visor', () => {
    const { rerender, container } = renderSurface();

    rerender(<CodeSurface value={'otra cosa\ndel todo'} label="src/design/theme.ts" />);

    expect([...container.querySelectorAll('.cm-line')].map((line) => line.textContent)).toEqual([
      'otra cosa',
      'del todo',
    ]);
  });

  it('highlights replacement characters and exposes invisible control bytes', () => {
    const text = 'caf� E\u0000\u0000\u0000 \u0080';
    const { container } = renderSurface({ value: text, encoding: 'windows-1252' });
    expect(container.querySelector('[title="U+FFFD · �"]')).toHaveTextContent('�');
    expect(screen.getAllByTitle('U+0000 · NUL')).toHaveLength(3);
    expect(screen.getByTitle('U+0080')).toHaveTextContent('·');
    expect(
      [...container.querySelectorAll('.cm-specialChar')].map((node) => node.textContent),
    ).toEqual(['·', '·', '·', '·']);
    expect(EditorView.findFromDOM(editor())?.state.doc.toString()).toBe(text);
  });

  it('declara con qué codificación se leyó el texto', () => {
    const { container } = renderSurface({ encoding: 'ISO-8859-1' });

    expect(container.querySelector('[data-encoding="ISO-8859-1"]')).not.toBeNull();
  });

  it('sin rótulos de plegado no hay margen de plegado', () => {
    const { container } = renderSurface();

    expect(container.querySelector('.cm-foldGutter')).toBeNull();
  });

  it('los rótulos de plegado son los que le pasan, no los suyos en inglés', () => {
    renderSurface({ folding: FOLD_LABELS });

    expect(screen.getAllByTitle('Plegar el bloque').length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Fold line')).toBeNull();
  });

  it('la flecha solo aparece donde hay bloque que plegar', () => {
    const { container } = renderSurface({ folding: FOLD_LABELS });

    const gutter = container.querySelector('.cm-foldGutter');
    const arrows = [...(gutter?.querySelectorAll('[title]') ?? [])].map((arrow) =>
      arrow.getAttribute('title'),
    );

    // La firma de la función y el `if`; el resto son líneas sueltas.
    expect(arrows.filter((title) => title === 'Plegar el bloque')).toHaveLength(2);
  });

  it('plegar esconde el bloque y deja el encabezado', async () => {
    const { container } = renderSurface({ folding: FOLD_LABELS });

    const arrow = screen.getAllByTitle('Plegar el bloque')[0];

    expect(arrow).toBeDefined();

    await userEvent.click(arrow!);

    const lines = [...container.querySelectorAll('.cm-line')].map((line) => line.textContent);

    // Quedan el encabezado —con el hueco de lo plegado— y la llave que cierra:
    // plegar desde el final de la línea de la flecha es lo que deja legible de
    // qué era el bloque que se acaba de esconder.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('export function resolveTheme(settings) {');
    expect(lines[1]).toBe('}');
    expect(container.querySelector('.cm-foldPlaceholder')).not.toBeNull();
  });

  it('las líneas marcadas llevan su tono', () => {
    const { container } = renderSurface({
      marks: [
        { line: 4, tone: 'removed' },
        { line: 2, tone: 'added' },
      ],
    });

    const lines = [...container.querySelectorAll('.cm-line')];

    expect(lines[1]?.className).toMatch(/added/);
    expect(lines[3]?.className).toMatch(/removed/);
    expect(lines[0]?.className).not.toMatch(/added|removed/);
  });

  it('una marca fuera del documento se ignora en vez de reventar', () => {
    expect(() => renderSurface({ marks: [{ line: 900, tone: 'added' }] })).not.toThrow();
  });

  it('el resaltado por palabra tiñe solo el tramo, no la línea entera', () => {
    const { container } = renderSurface({
      words: [{ line: 2, start: 8, end: 12, tone: 'added' }],
    });

    const line = [...container.querySelectorAll('.cm-line')][1];
    const span = line?.querySelector('span[class]');

    expect(span?.textContent).toBe('mode');
    expect(line?.className).not.toMatch(/added/);
  });

  it('un tramo que se sale de la línea se recorta en vez de reventar', () => {
    expect(() =>
      renderSurface({ words: [{ line: 1, start: 0, end: 9000, tone: 'removed' }] }),
    ).not.toThrow();
    expect(() =>
      renderSurface({ words: [{ line: 900, start: 0, end: 3, tone: 'removed' }] }),
    ).not.toThrow();
  });

  it('un diff rotula cada línea con lo que le digan, no con una cuenta corrida', () => {
    const { container } = renderSurface({
      value: 'uno\ndos\ntres',
      lineNumberLabels: ['10', '', '11'],
    });

    expect(lineNumbersOf(container)).toEqual(['10', '', '11']);
  });

  it('no incluye la siguiente línea cuando la selección termina en su inicio', () => {
    const onSelectedLines = vi.fn();
    const { container } = renderSurface({ value: 'one\ntwo\nthree', onSelectedLines });
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    act(() => view.dispatch({ selection: { anchor: 0, head: view.state.doc.line(3).from } }));
    expect(onSelectedLines).toHaveBeenLastCalledWith({ from: 1, to: 2 });
    act(() => view.dispatch({ selection: { anchor: view.state.doc.line(3).from, head: 0 } }));
    expect(onSelectedLines).toHaveBeenLastCalledWith({ from: 1, to: 2 });
  });

  it('avisa de qué líneas abarca la selección, para el stage por línea', async () => {
    const onSelectedLines = vi.fn();

    renderSurface({ onSelectedLines });

    // Poner el cursor ya es una selección de una línea: es lo que deja preparar
    // la línea que se acaba de pulsar.
    await userEvent.click(editor());

    expect(onSelectedLines).toHaveBeenCalled();

    const range: unknown = onSelectedLines.mock.calls.at(-1)?.[0];

    expect(range).toMatchObject({ from: 1, to: 1 });
  });

  it('montar y desmontar de seguido no deja nada colgando', () => {
    const { unmount } = renderSurface({ folding: FOLD_LABELS });

    expect(() => {
      unmount();
    }).not.toThrow();

    const second = renderSurface();

    expect(editor()).toBeInTheDocument();
    expect(() => {
      second.unmount();
    }).not.toThrow();
  });

  it('refresca el viewport externo cuando las fuentes terminan de cargar', async () => {
    const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    const forceViewport = vi.spyOn(EditorView.prototype, 'lineBlockAtHeight');
    let finishFonts!: () => void;
    const ready = new Promise<void>((resolve) => {
      finishFonts = resolve;
    });

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready },
    });

    try {
      renderSurface({ fitContent: true });

      forceViewport.mockClear();

      await act(async () => {
        finishFonts();
        await ready;
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });

      expect(forceViewport).toHaveBeenCalledWith(0);
    } finally {
      forceViewport.mockRestore();
      if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('vuelve a medir el editor cuando cambia la variante del tema', async () => {
    const requestMeasure = vi.spyOn(EditorView.prototype, 'requestMeasure');

    try {
      renderSurface();
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });
      requestMeasure.mockClear();

      await act(async () => {
        document.documentElement.dataset['themeVariant'] = 'dense';
        await Promise.resolve();
      });

      expect(requestMeasure).toHaveBeenCalled();
    } finally {
      document.documentElement.removeAttribute('data-theme-variant');
      requestMeasure.mockRestore();
    }
  });

  it('refresca el viewport externo al reutilizar el editor para otro archivo', async () => {
    const forceViewport = vi.spyOn(EditorView.prototype, 'lineBlockAtHeight');
    const { rerender } = renderSurface({ fitContent: true, value: 'archivo anterior' });

    forceViewport.mockClear();
    rerender(
      <CodeSurface
        fitContent
        value={'archivo nuevo\ncon otras líneas\ny otra altura'}
        label="src/design/theme.ts"
      />,
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    expect(forceViewport).toHaveBeenCalledWith(0);
    expect(editor()).toHaveTextContent('archivo nuevo');
    forceViewport.mockRestore();
  });
});

it('mantiene el checkbox en un lado sin líneas reales', async () => {
  const onToggle = vi.fn();
  renderSurface({
    blockControls: [
      {
        id: 'empty',
        line: 1,
        spacerRows: 2,
        spacerBeforeLine: true,
        label: 'Bloque vacío',
        onToggle,
      },
    ],
  });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Bloque vacío' }));
  expect(onToggle).toHaveBeenCalledWith(true);
});

it.each(['bloque', 'línea'] as const)(
  'conserva el control de %s durante un clic aunque el padre se repinte',
  async (kind) => {
    const user = userEvent.setup();
    const previousToggle = vi.fn();
    const nextToggle = vi.fn();
    const props = (onToggle: (checked: boolean) => void) => ({
      value: 'inicio\ncambio\nfin',
      label: 'src/design/theme.ts',
      lineControls: [{ line: 2, label: 'Agregar línea', checked: false, onToggle }],
      blockControls: [{ id: 'c1', line: 2, label: 'Agregar bloque', onToggle }],
    });
    const { rerender } = renderSurface(props(previousToggle));
    const control = screen.getByRole(kind === 'bloque' ? 'checkbox' : 'button', {
      name: kind === 'bloque' ? 'Agregar bloque' : 'Agregar línea',
    });
    await user.pointer({ target: control, keys: '[MouseLeft>]' });
    rerender(<CodeSurface {...props(nextToggle)} />);
    expect(control.isConnected).toBe(true);
    await user.pointer({ target: control, keys: '[/MouseLeft]' });
    expect(nextToggle).toHaveBeenCalledExactlyOnceWith(true);
    expect(previousToggle).not.toHaveBeenCalled();
  },
);

it('actualiza la selección de una línea conservando el botón enfocado y el callback vigente', async () => {
  const firstToggle = vi.fn();
  const latestToggle = vi.fn();
  const { rerender } = renderSurface({
    value: 'cambio',
    lineControls: [{ line: 1, label: 'Agregar línea', checked: false, onToggle: firstToggle }],
  });
  const control = screen.getByRole('button', { name: 'Agregar línea' });
  act(() => control.focus());
  rerender(
    <CodeSurface
      value="cambio"
      label="src/design/theme.ts"
      lineControls={[{ line: 1, label: 'Quitar línea', checked: true, onToggle: latestToggle }]}
    />,
  );
  expect(screen.getByRole('button', { name: 'Quitar línea' })).toBe(control);
  expect(control).toHaveFocus();
  expect(control).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard(' ');
  expect(latestToggle).toHaveBeenCalledExactlyOnceWith(false);
  expect(firstToggle).not.toHaveBeenCalled();
});

it('declara la altura de los espacios fuera de pantalla antes de medirlos', () => {
  renderSurface({
    value: Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n'),
    blockControls: [
      {
        id: 'far',
        line: 1500,
        spacerRows: 300,
        spacerBeforeLine: true,
        anchorOnly: true,
        label: 'bloque lejano',
      },
    ],
  });
  const view = EditorView.findFromDOM(editor())!;
  const heights: number[] = [];
  for (const decorations of view.state.facet(EditorView.decorations)) {
    if (typeof decorations === 'function') continue;
    decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      const widget = (decoration.spec as { widget?: { estimatedHeight: number } }).widget;
      if (widget && widget.estimatedHeight > 0) heights.push(widget.estimatedHeight);
    });
  }
  expect(heights).toEqual([6000]);
});

it('reutiliza el resaltado al desplazar o seleccionar y lo actualiza al editar', () => {
  const highlight = vi.spyOn(codeSurface, 'syntaxSpans');
  const { rerender } = renderSurface({ language: 'script', readOnly: false });
  const view = EditorView.findFromDOM(editor())!;
  const initialCalls = highlight.mock.calls.length;
  expect(initialCalls).toBeGreaterThan(0);
  const decorations = view.state.facet(EditorView.decorations);

  act(() => {
    // Las actualizaciones de ventana consultan esta faceta repetidamente.
    for (let index = 0; index < 20; index += 1) {
      for (const source of view.state.facet(EditorView.decorations)) {
        if (typeof source === 'function') source(view);
      }
      view.dispatch({ selection: { anchor: index } });
    }
  });
  expect(highlight).toHaveBeenCalledTimes(initialCalls);
  expect(view.state.facet(EditorView.decorations)).toBe(decorations);

  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'const n = 42;' } });
  });
  expect(highlight).toHaveBeenLastCalledWith('const n = 42;', 'script');
  expect(view.state.facet(EditorView.decorations)).not.toBe(decorations);
  expect(editor().querySelector('span[class*="syntaxNumber"]')).toHaveTextContent('42');

  rerender(<CodeSurface value="return 7;" label="src/design/theme.ts" language="compiled" />);
  expect(highlight).toHaveBeenLastCalledWith('return 7;', 'compiled');
  expect(editor().querySelector('span[class*="syntaxNumber"]')).toHaveTextContent('7');
  highlight.mockRestore();
});

describe('long lines', () => {
  it('restores the full original document when word wrap is enabled', () => {
    const source = 'x'.repeat(1_500_000);
    const { container, rerender } = renderSurface({ value: source, longLineLabel: 'Enable wrap' });
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    expect(view.state.doc.length).toBeLessThan(11_000);
    expect(view.state.doc.toString()).toContain('Enable wrap');
    rerender(
      <CodeSurface label="src/design/theme.ts" value={source} longLineLabel="Enable wrap" wrap />,
    );
    expect(view.state.doc.toString()).toBe(source);
    expect(view.contentDOM).toHaveClass('cm-lineWrapping');
  });
  it('never truncates editable documents', () => {
    const source = 'x'.repeat(12_000);
    const { container } = renderSurface({
      value: source,
      readOnly: false,
      longLineLabel: 'Enable wrap',
    });
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
    expect(view.state.doc.toString()).toBe(source);
  });
});
