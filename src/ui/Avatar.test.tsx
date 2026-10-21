import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AVATAR_DARK_INK, AVATAR_LIGHT_INK, DEFAULT_USER_COLOR } from '@design/userColor';

import { expectNoHoverShift } from '../test/noShift';
import { Avatar } from './Avatar';
import { AVATAR_CATEGORIES, AVATAR_GLYPHS, avatarGlyph } from './avatarGlyphs';

describe('Avatar', () => {
  it('genera iniciales de nombre y apellido', () => {
    render(<Avatar name="Ada Lovelace" />);

    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
  });

  it('usa la imagen cuando se da una', () => {
    render(<Avatar name="Ada Lovelace" src="https://example.test/ada.png" />);

    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveAttribute(
      'src',
      'https://example.test/ada.png',
    );
  });

  it('es determinista: la misma semilla siempre elige el mismo color', () => {
    const { container: a } = render(<Avatar name="Ada Lovelace" email="ada@example.test" />);
    const { container: b } = render(<Avatar name="Ada Lovelace" email="ada@example.test" />);

    expect(a.firstElementChild?.className).toBe(b.firstElementChild?.className);
  });

  it('pinta símbolos y personajes con curvas y detalles sólidos del mismo color', () => {
    const { container: symbol } = render(<Avatar name="Cohete" glyph="rocket" />);
    const { container: character } = render(<Avatar name="Perro" glyph="dog" />);

    for (const container of [symbol, character]) {
      expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
      expect(container.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
      expect(container.querySelector('svg')).toHaveAttribute('stroke-linecap', 'round');
      expect(container.querySelector('svg')).not.toHaveAttribute('shape-rendering');
    }
    expect(character.querySelector('g[fill="currentColor"]')).toBeInTheDocument();
  });

  it('conserva las elecciones antiguas dentro de un catálogo sin IDs repetidos', () => {
    const legacy = [
      'terminal',
      'branch',
      'rocket',
      'book',
      'flask',
      'gear',
      'star',
      'heart',
      'bolt',
      'cloud',
      'globe',
      'key',
      'lock',
      'moon',
      'sun',
      'anchor',
      'flame',
      'droplet',
      'mountain',
      'compass',
      'music',
      'camera',
      'coffee',
      'crown',
      'shield',
      'alien',
      'robot',
      'astronaut',
      'cat',
      'dog',
      'fox',
      'rabbit',
      'bear',
      'frog',
      'owl',
      'penguin',
      'duck',
      'fish',
      'octopus',
      'crab',
      'snail',
      'dino',
      'bug',
      'feather',
      'lion',
      'panda',
      'koala',
      'elephant',
      'turtle',
      'whale',
      'butterfly',
      'leaf',
      'flower',
      'sunflower',
      'tulip',
      'rose',
      'cactus',
      'sprout',
      'tree',
      'palm',
      'mushroom',
      'clover',
      'fern',
      'ghost',
      'skull',
      'wizard',
      'pumpkin',
      'gift',
      'cake',
      'balloon',
      'party',
      'santa',
      'snowflake',
      'lantern',
      'cube',
      'gem',
      'orbit',
      'spiral',
      'mosaic',
      'prism',
      'infinity',
      'waves',
      'knot',
      'mandala',
      'comet',
    ];

    expect(AVATAR_GLYPHS).toHaveLength(128);
    expect(new Set(AVATAR_GLYPHS.map(({ id }) => id)).size).toBe(AVATAR_GLYPHS.length);
    for (const id of legacy) expect(avatarGlyph(id)?.id).toBe(id);
    expect(AVATAR_CATEGORIES.map(({ id }) => id)).toEqual([
      'symbols',
      'animals',
      'plants',
      'festivities',
      'abstract',
    ]);
    for (const category of AVATAR_CATEGORIES) {
      expect(category.glyphs.length).toBeGreaterThan(0);
      for (const glyph of category.glyphs) expect(glyph.category).toBe(category.id);
    }
  });

  /* Un identificador que ya no está en el catálogo no puede dejar un hueco. */
  it('vuelve a las iniciales con un dibujo desconocido', () => {
    render(<Avatar name="Ada Lovelace" glyph="lo-que-sea" />);

    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL');
  });

  it('aplica el color libre como dato sin perder el tono de respaldo', () => {
    render(<Avatar name="Ada Lovelace" glyph="rocket" tone={3} color={DEFAULT_USER_COLOR} />);

    const avatar = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(avatar).toHaveAttribute('data-custom-color');
    expect(avatar).toHaveStyle({ '--avatar-color': DEFAULT_USER_COLOR });
  });

  it.each([
    [AVATAR_LIGHT_INK, AVATAR_DARK_INK],
    [AVATAR_DARK_INK, AVATAR_LIGHT_INK],
  ])('mantiene el dibujo legible sobre el color libre %s', (color, foreground) => {
    render(<Avatar name="Perro" glyph="dog" color={color} />);

    expect(screen.getByRole('img', { name: 'Perro' })).toHaveStyle({
      '--avatar-color': color,
      '--avatar-foreground': foreground,
    });
  });

  it('el hover no desplaza la caja', () => {
    render(<Avatar name="Ada Lovelace" />);

    expectNoHoverShift(screen.getByRole('img', { name: 'Ada Lovelace' }));
  });
});
