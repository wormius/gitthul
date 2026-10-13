import { createContext } from 'react';

/*
 * El contrato de los avisos vive aparte del proveedor para que importar
 * `useToast` no arrastre la región ni rompa la recarga en caliente.
 */

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';
export type ToastDismissReason = 'close' | 'timeout' | 'action' | 'programmatic';

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
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
  /** Varias elecciones, debajo del mensaje. Conserva `action` como primera si existe. */
  actions?: readonly ToastAction[];
  /** El cierre programático permite retirar el aviso sin registrar una elección. */
  onDismiss?: (reason: ToastDismissReason) => void;
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
