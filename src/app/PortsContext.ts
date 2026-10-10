import { createContext, useContext } from 'react';

import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';

/**
 * Los puertos de la aplicación, por contexto.
 *
 * El valor por defecto son los que correspondan al entorno, así que un árbol de
 * pruebas funciona sin envolver nada — y envolverlo es lo que permite espiar las
 * llamadas cuando lo que se prueba es justo eso.
 */
export const PortsContext = createContext<AppPorts>(selectPorts());

export function usePorts(): AppPorts {
  return useContext(PortsContext);
}
