import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GitQuery } from '@core/ports/GitPort';
import { useAsyncData } from './useAsyncData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const isEqual = (a: { text: string }, b: { text: string }) => a.text === b.text;

describe('useAsyncData: refrescos del mismo recurso', () => {
  it('conserva el dato mientras consulta y su identidad si la respuesta es igual', async () => {
    const initial = { text: 'original' };
    const refresh = deferred<typeof initial>();
    const first = () => Promise.resolve(initial);
    const next = () => refresh.promise;
    const { result, rerender } = renderHook(
      ({ load }) => useAsyncData(load, { resourceKey: 'file', isEqual }),
      { initialProps: { load: first } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ load: next });
    expect(result.current).toMatchObject({ status: 'ready', data: initial });
    await act(async () => {
      refresh.resolve({ ...initial });
      await refresh.promise;
    });
    if (result.current.status !== 'ready') throw new Error('No conservó el dato');
    expect(result.current.data).toBe(initial);
  });

  it('aplica cambios reales y muestra los errores de un refresco', async () => {
    const refresh = deferred<string>();
    const failed = deferred<string>();
    const { result, rerender } = renderHook(
      ({ load }) => useAsyncData(load, { resourceKey: 'file' }),
      { initialProps: { load: () => Promise.resolve('before') } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ load: () => refresh.promise });
    await act(async () => {
      refresh.resolve('after');
      await refresh.promise;
    });
    expect(result.current).toMatchObject({ status: 'ready', data: 'after' });
    rerender({ load: () => failed.promise });
    await act(async () => {
      failed.reject(new Error('read failed'));
      await failed.promise.catch(() => undefined);
    });
    expect(result.current.status).toBe('failed');
  });

  it('oculta el recurso anterior al cambiar de clave y descarta respuestas canceladas', async () => {
    const refresh = deferred<string>();
    const next = deferred<string>();
    const slow = vi.fn((_query: GitQuery) => refresh.promise);
    const { result, rerender } = renderHook(
      ({ load, resourceKey }) => useAsyncData(load, { resourceKey }),
      { initialProps: { load: (_query: GitQuery) => Promise.resolve('file-a'), resourceKey: 'a' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ load: slow, resourceKey: 'a' });
    rerender({ load: () => next.promise, resourceKey: 'b' });
    expect(result.current.status).toBe('loading');
    expect(slow.mock.calls[0]![0].signal?.aborted).toBe(true);
    await act(async () => {
      refresh.resolve('stale-a');
      await refresh.promise;
    });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      next.resolve('file-b');
      await next.promise;
    });
    expect(result.current).toMatchObject({ status: 'ready', data: 'file-b' });
  });

  it('sin clave mantiene el comportamiento previo de volver a cargando', async () => {
    const refresh = deferred<string>();
    const { result, rerender } = renderHook(({ load }) => useAsyncData(load), {
      initialProps: { load: () => Promise.resolve('before') },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ load: () => refresh.promise });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      refresh.resolve('after');
      await refresh.promise;
    });
    expect(result.current).toMatchObject({ status: 'ready', data: 'after' });
  });
});
