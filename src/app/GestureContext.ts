import { createContext, useContext } from 'react';

import type { GestureRegistry } from './gestures';

export const GestureContext = createContext<GestureRegistry | null>(null);

export function useGestures(): GestureRegistry {
  const registry = useContext(GestureContext);

  if (!registry) throw new Error('useGestures necesita un GestureProvider por encima');

  return registry;
}
