import { describe, expect, it } from 'vitest';

import { AVATAR_CATEGORIES, AVATAR_GLYPHS } from '../ui/avatarGlyphs';

import { interpolate } from './format';
import { detectLocale, LOCALES } from './locales';
import { MESSAGES } from './messages';
import { esMX } from './messages/es-MX';

const BASE_KEYS = Object.keys(esMX).sort();

describe('catálogos', () => {
  it.each(LOCALES)('%s declara exactamente las claves de la base', (locale) => {
    expect(Object.keys(MESSAGES[locale]).sort()).toEqual(BASE_KEYS);
  });

  it.each(LOCALES)('%s no deja ninguna cadena vacía', (locale) => {
    const empty = Object.entries(MESSAGES[locale])
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it.each(LOCALES)('%s nombra todos los avatares y sus categorías', (locale) => {
    const keys = [
      'avatar.categories',
      ...AVATAR_CATEGORIES.map((category) => `avatar.category.${category.id}`),
      ...AVATAR_GLYPHS.map((glyph) => `avatar.glyph.${glyph.id}`),
    ];
    const missing = keys.filter((key) => !MESSAGES[locale][key as keyof typeof esMX]?.trim());

    expect(missing).toEqual([]);
  });

  // Un hueco perdido en la traducción deja la frase sin el nombre de la rama o
  // de la pestaña, que es justo lo que la invariante 5 prohíbe.
  it.each(LOCALES)('%s conserva los huecos de cada plantilla', (locale) => {
    const holes = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    const mismatched = Object.entries(esMX)
      .filter(([key, template]) => {
        const translated = MESSAGES[locale][key as keyof typeof esMX];

        return holes(template).join(',') !== holes(translated).join(',');
      })
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });
});

describe('detectLocale', () => {
  it('acepta la etiqueta exacta sin importar la caja', () => {
    expect(detectLocale(['es-mx'])).toBe('es-MX');
    expect(detectLocale(['de'])).toBe('de');
  });

  it('manda el castellano de España a es-ES y el resto a es-MX', () => {
    expect(detectLocale(['es-ES'])).toBe('es-ES');
    expect(detectLocale(['es'])).toBe('es-MX');
    expect(detectLocale(['es-AR'])).toBe('es-MX');
    expect(detectLocale(['es-419'])).toBe('es-MX');
  });

  it('reduce las variantes regionales a su idioma', () => {
    expect(detectLocale(['en-GB'])).toBe('en');
    expect(detectLocale(['fr-CA'])).toBe('fr');
    expect(detectLocale(['de-AT'])).toBe('de');
  });

  it('recorre las preferencias en orden y cae en la base', () => {
    expect(detectLocale(['ja', 'pt-BR', 'fr-FR'])).toBe('fr');
    expect(detectLocale(['ja', 'ko'])).toBe('es-MX');
    expect(detectLocale([])).toBe('es-MX');
  });
});

describe('interpolate', () => {
  it('rellena los huecos por nombre', () => {
    expect(
      interpolate('Fusionar {source} dentro de {target}', { source: 'dev', target: 'main' }),
    ).toBe('Fusionar dev dentro de main');
  });

  it('deja el hueco a la vista cuando falta el valor', () => {
    expect(interpolate('Rama {branch}')).toBe('Rama {branch}');
    expect(interpolate('Rama {branch}', { otra: 'dev' })).toBe('Rama {branch}');
  });

  it('acepta números', () => {
    expect(interpolate('{count} commits', { count: 3 })).toBe('3 commits');
  });
});
