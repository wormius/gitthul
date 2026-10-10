import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_USER_COLOR } from '@design/userColor';
import { I18nProvider } from '@i18n/I18nProvider';

import { AvatarPicker } from './AvatarPicker';

const CUSTOM_COLOR = DEFAULT_USER_COLOR.replaceAll('8', '7');

function renderPicker(glyph: string | null = 'dog') {
  const onGlyphChange = vi.fn();
  const onToneChange = vi.fn();
  const onColorChange = vi.fn();
  render(
    <I18nProvider initialLocale="es-MX">
      <AvatarPicker
        name="Ada Lovelace"
        seed="ada@example.test"
        glyph={glyph}
        tone={4}
        color={DEFAULT_USER_COLOR}
        onGlyphChange={onGlyphChange}
        onToneChange={onToneChange}
        onColorChange={onColorChange}
      />
    </I18nProvider>,
  );
  return { onGlyphChange, onToneChange, onColorChange };
}

function Harness() {
  const [glyph, setGlyph] = useState<string | null>('dog');
  const [tone, setTone] = useState(4);
  const [color, setColor] = useState<string | null>(null);
  return (
    <AvatarPicker
      name="Ada Lovelace"
      seed="ada@example.test"
      glyph={glyph}
      tone={tone}
      color={color}
      onGlyphChange={setGlyph}
      onToneChange={setTone}
      onColorChange={setColor}
    />
  );
}

describe('AvatarPicker', () => {
  it('opens the saved drawing category and keeps the selection while browsing', async () => {
    const handlers = renderPicker();
    const user = userEvent.setup();
    const animals = screen.getByRole('tab', { name: 'Animales' });
    expect(animals).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Perro' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: 'Plantas' }));
    expect(screen.queryByRole('button', { name: 'Perro' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciales' })).toBeVisible();
    await user.click(animals);
    expect(screen.getByRole('button', { name: 'Perro' })).toHaveAttribute('aria-pressed', 'true');
    expect(handlers.onGlyphChange).not.toHaveBeenCalled();
    expect(handlers.onToneChange).not.toHaveBeenCalled();
    expect(handlers.onColorChange).not.toHaveBeenCalled();
  });

  it('opens legacy festive drawings in Festividades', () => {
    renderPicker('ghost');
    expect(screen.getByRole('tab', { name: 'Festividades' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Fantasma' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('supports roving tab focus, automatic activation and wrapping without choosing a drawing', async () => {
    const handlers = renderPicker(null);
    const user = userEvent.setup();
    const symbols = screen.getByRole('tab', { name: 'Símbolos' });
    symbols.focus();
    await user.keyboard('{ArrowRight}');
    const animals = screen.getByRole('tab', { name: 'Animales' });
    expect(animals).toHaveFocus();
    expect(animals).toHaveAttribute('aria-selected', 'true');
    expect(animals).toHaveAttribute('tabindex', '0');
    expect(symbols).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Abstractos' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(symbols).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Abstractos' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(symbols).toHaveFocus();
    expect(symbols).toHaveAttribute('aria-selected', 'true');
    expect(handlers.onGlyphChange).not.toHaveBeenCalled();
    expect(handlers.onToneChange).not.toHaveBeenCalled();
    expect(handlers.onColorChange).not.toHaveBeenCalled();
  });

  it('updates the preview and drawing samples with the selected color, then restores a theme tone', async () => {
    render(
      <I18nProvider initialLocale="es-MX">
        <Harness />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    const preview = screen.getByRole('img', { name: 'Ada Lovelace' });
    fireEvent.change(screen.getByLabelText('Color personalizado'), {
      target: { value: CUSTOM_COLOR },
    });
    expect(preview).toHaveStyle({ '--avatar-color': CUSTOM_COLOR });
    expect(screen.getByRole('button', { name: 'Perro' }).querySelector('[role="img"]')).toHaveStyle(
      {
        '--avatar-color': CUSTOM_COLOR,
      },
    );

    await user.click(screen.getByRole('tab', { name: 'Plantas' }));
    const cactus = screen.getByRole('button', { name: 'Cactus' });
    await user.click(cactus);
    expect(cactus).toHaveAttribute('aria-pressed', 'true');
    expect(preview.querySelector('svg')).toBeInTheDocument();
    expect(preview.querySelector('svg')?.innerHTML).toBe(cactus.querySelector('svg')?.innerHTML);
    expect(preview).toHaveStyle({ '--avatar-color': CUSTOM_COLOR });

    expect(screen.getAllByRole('button', { name: /^Color \d+$/ })).toHaveLength(16);
    await user.click(screen.getByRole('button', { name: 'Color 8' }));
    expect(screen.getByRole('button', { name: 'Color 8' })).toHaveAttribute('aria-pressed', 'true');
    expect(preview).not.toHaveAttribute('data-custom-color');
    expect(cactus.querySelector('[role="img"]')).not.toHaveAttribute('data-custom-color');
  });

  it('keeps initials available outside every category and restores the automatic preview', async () => {
    render(
      <I18nProvider initialLocale="es-MX">
        <Harness />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Abstractos' }));
    expect(
      within(screen.getByRole('tabpanel')).queryByRole('button', { name: 'Iniciales' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Iniciales' }));
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
    expect(screen.getByRole('button', { name: 'Iniciales' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Abstractos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
