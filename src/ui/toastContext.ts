import { createContext } from 'react';

/*
 * El contrato de los avisos vive aparte del proveedor para que importar
 * `useToast` no arrastre la región ni rompa la recarga en caliente.
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  /** Ya traducido y con las ramas nombradas: «`dev` fusionada dentro de `main`». */
  message: string;
  variant?: ToastVariant;
  /**
   * El deshacer de la invariante 2. Toda operación destructiva que no confirma
   * antes tiene que ofrecerlo aquí.
   */
  action?: ToastAction;
  /** Milisegundos en pantalla. Cero lo deja hasta que alguien lo cierre. */
  duration?: number;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  createdAt: number;
}

export interface ToastHistoryRecord {
  id: string;
  message: string;
  variant: ToastVariant;
  createdAt: number;
  read: boolean;
}

export interface ToastApi {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  history: readonly ToastHistoryRecord[];
  unread: number;
  markHistoryRead: () => void;
  removeFromHistory: (id: string) => void;
  clearHistory: () => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export const DEFAULT_TOAST_DURATION = 6000;
export const WARNING_TOAST_DURATION = 8000;
export const DANGER_TOAST_DURATION = 10000;
