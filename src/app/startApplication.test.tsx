import { act, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('shows a translated startup error when production has no desktop runtime', async () => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  vi.stubEnv('MODE', 'production');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { startApplication } = await import('./startApplication');
  const container = document.createElement('div');
  document.body.append(container);
  const start = vi.fn(() => Promise.resolve());
  let root: Awaited<ReturnType<typeof startApplication>>;
  await act(async () => {
    root = await startApplication(container, start);
  });
  expect(start).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('GitThul could not start');
  expect(screen.getByRole('alert')).toHaveTextContent('reopen the desktop application');
  act(() => {
    root?.unmount();
  });
  container.remove();
});
