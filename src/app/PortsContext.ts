import { createContext, useContext } from 'react';

import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';

/**
 * Los puertos de la aplicación, por contexto.
 *
 * El arranque crea e inyecta un único conjunto. Las pruebas que no necesitan
 * espiar puertos conservan un conjunto simulado perezoso, exclusivo de Vitest.
 */
export const PortsContext = createContext<AppPorts | null>(null);

let testPorts: AppPorts | undefined;

export function usePorts(): AppPorts {
  const ports = useContext(PortsContext);
  if (ports) return ports;
  if (import.meta.env.DEV && import.meta.env.MODE === 'test') return (testPorts ??= selectPorts());
  throw new Error('GitThul requires a PortsContext provider.');
}
