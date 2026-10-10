import { describe, expect, it } from 'vitest';

import { integrationOffer, isDragRef, type DragRef } from './integration';

describe('isDragRef', () => {
  it('acepta una rama válida', () => {
    expect(isDragRef({ kind: 'branch', name: 'main' })).toBe(true);
  });

  it('acepta un tag válido', () => {
    expect(isDragRef({ kind: 'tag', name: 'v1.0.0' })).toBe(true);
  });

  it('rechaza null', () => {
    expect(isDragRef(null)).toBe(false);
  });

  it('rechaza un objeto sin kind', () => {
    expect(isDragRef({ name: 'main' })).toBe(false);
  });

  it('rechaza un objeto sin name', () => {
    expect(isDragRef({ kind: 'branch' })).toBe(false);
  });

  it('rechaza un kind inválido', () => {
    expect(isDragRef({ kind: 'stash', name: 'stash@{0}' })).toBe(false);
  });

  it('rechaza un nombre que no es cadena', () => {
    expect(isDragRef({ kind: 'branch', name: 42 })).toBe(false);
  });

  it('rechaza primitivos', () => {
    expect(isDragRef(undefined)).toBe(false);
    expect(isDragRef('')).toBe(false);
    expect(isDragRef(123)).toBe(false);
  });
});

describe('integrationOffer', () => {
  it('devuelve null cuando source y target son la misma rama', () => {
    const ref: DragRef = { kind: 'branch', name: 'main' };

    expect(integrationOffer(ref, ref)).toBe(null);
  });

  it('devuelve null cuando source y target son el mismo tag', () => {
    const ref: DragRef = { kind: 'tag', name: 'v1.0.0' };

    expect(integrationOffer(ref, ref)).toBe(null);
  });

  it('ofrece merge-rebase-compare entre dos ramas distintas', () => {
    const source: DragRef = { kind: 'branch', name: 'feature' };
    const target: DragRef = { kind: 'branch', name: 'main' };

    expect(integrationOffer(source, target)).toBe('merge-rebase-compare');
  });

  it('ofrece compare-only cuando el source es un tag', () => {
    const source: DragRef = { kind: 'tag', name: 'v1.0.0' };
    const target: DragRef = { kind: 'branch', name: 'main' };

    expect(integrationOffer(source, target)).toBe('compare-only');
  });

  it('ofrece compare-only cuando el target es un tag', () => {
    const source: DragRef = { kind: 'branch', name: 'feature' };
    const target: DragRef = { kind: 'tag', name: 'v2.0.0' };

    expect(integrationOffer(source, target)).toBe('compare-only');
  });

  it('ofrece compare-only entre dos tags distintos', () => {
    const source: DragRef = { kind: 'tag', name: 'v1.0.0' };
    const target: DragRef = { kind: 'tag', name: 'v2.0.0' };

    expect(integrationOffer(source, target)).toBe('compare-only');
  });

  it('un branch y un tag con el mismo nombre no son la misma referencia', () => {
    const source: DragRef = { kind: 'branch', name: 'release' };
    const target: DragRef = { kind: 'tag', name: 'release' };

    expect(integrationOffer(source, target)).toBe('compare-only');
  });
});
