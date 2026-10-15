import { renderHook } from '@testing-library/react';
import type { ContextType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const select = vi.hoisted(() => vi.fn(() => ({ environment: 'test' })));
vi.mock('@core/adapters/selectPorts', () => ({ selectPorts: select }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

describe('PortsContext initialization', () => {
  it('does not create adapters when imported or when an explicit provider is used', async () => {
    const { PortsContext, usePorts } = await import('./PortsContext');
    expect(select).not.toHaveBeenCalled();
    const supplied = select();
    select.mockClear();
    const { result } = renderHook(usePorts, {
      wrapper: ({ children }) => (
        <PortsContext value={supplied as unknown as NonNullable<ContextType<typeof PortsContext>>}>
          {children}
        </PortsContext>
      ),
    });
    expect(result.current).toBe(supplied);
    expect(select).not.toHaveBeenCalled();
  });

  it('creates the test default only when first requested and reuses it', async () => {
    const { usePorts } = await import('./PortsContext');
    expect(select).not.toHaveBeenCalled();
    const first = renderHook(usePorts);
    const second = renderHook(usePorts);
    expect(first.result.current).toBe(second.result.current);
    expect(select).toHaveBeenCalledOnce();
  });

  it('requires an explicit provider in production, including mode test', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'test');
    const { usePorts } = await import('./PortsContext');
    expect(() => renderHook(usePorts)).toThrow('PortsContext provider');
    expect(select).not.toHaveBeenCalled();
  });
});
