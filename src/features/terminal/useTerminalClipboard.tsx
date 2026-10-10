import { useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';

import { formatShortcut, matchesShortcut, parseShortcut } from '@app/keys';
import type { Platform } from '@app/platform';
import type { SystemPort } from '@core/ports/SystemPort';
import { Menu } from '@ui/Menu';

export interface TerminalClipboardProps {
  clipboard: Pick<SystemPort, 'writeClipboardText' | 'readClipboardText'>;
  clipboardLabels: { menu: string; copy: string; paste: string; selectAll: string };
  onClipboardError: (action: 'copy' | 'paste') => void;
}

interface TerminalClipboardOptions extends TerminalClipboardProps {
  hostRef: RefObject<HTMLElement | null>;
  platform: Platform;
  getSelection: () => string;
  paste: (text: string) => void;
  selectAll: () => void;
  focus: () => void;
  canPaste: () => boolean;
}

const COPY = parseShortcut('Ctrl+Shift+C');
const PASTE = parseShortcut('Ctrl+Shift+V');
const COPY_INSERT = parseShortcut('Ctrl+Insert');
const PASTE_INSERT = parseShortcut('Shift+Insert');
const INTERRUPT = parseShortcut('Ctrl+C');
const MAC_COPY = parseShortcut('Mod+C');
const MAC_PASTE = parseShortcut('Mod+V');

/** Menú y portapapeles propios: no dependen del menú nativo del WebView. */
export function useTerminalClipboard({
  clipboard,
  clipboardLabels,
  onClipboardError,
  hostRef,
  platform,
  getSelection,
  paste,
  selectAll,
  focus,
  canPaste,
}: TerminalClipboardOptions) {
  const [point, setPoint] = useState<{ x: number; y: number; selection: string } | null>(null);
  const copyShortcut = platform === 'mac' ? MAC_COPY : COPY;
  const pasteShortcut = platform === 'mac' ? MAC_PASTE : PASTE;

  const copy = (text: string) => {
    if (text.length === 0) return;
    void clipboard.writeClipboardText(text).catch(() => onClipboardError('copy'));
  };
  const pasteClipboard = async () => {
    if (!canPaste()) return;
    try {
      const text = await clipboard.readClipboardText();
      // La sesión puede haber terminado mientras se leía el portapapeles.
      if (canPaste()) paste(text);
    } catch {
      onClipboardError('paste');
    }
  };
  const close = () => {
    setPoint(null);
    focus();
  };
  const open = (x: number, y: number) => {
    // Guardar antes de enfocar el menú: el texto pertenece a esta terminal.
    setPoint({ x, y, selection: getSelection() });
  };
  const containsTarget = (target: EventTarget | null) =>
    target instanceof Node && Boolean(hostRef.current?.contains(target));

  const onContextMenuCapture = (event: MouseEvent<HTMLElement>) => {
    if (!containsTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    open(event.clientX, event.clientY);
  };

  const handleClipboardShortcut = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || !containsTarget(event.target)) {
      return false;
    }
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      const rect = hostRef.current?.getBoundingClientRect();
      open(rect ? rect.left + rect.width / 2 : 0, rect ? rect.top + rect.height / 2 : 0);
      return handled();
    }
    const selection = getSelection();
    if (
      matchesShortcut(copyShortcut, event, platform) ||
      matchesShortcut(COPY_INSERT, event, platform) ||
      (selection.length > 0 && matchesShortcut(INTERRUPT, event, platform))
    ) {
      copy(selection);
      return handled();
    }
    if (
      matchesShortcut(pasteShortcut, event, platform) ||
      matchesShortcut(PASTE_INSERT, event, platform)
    ) {
      void pasteClipboard();
      return handled();
    }
    return false;
  };

  const menu = point && (
    <Menu
      label={clipboardLabels.menu}
      anchor={point}
      onClose={close}
      items={[
        {
          key: 'copy',
          label: clipboardLabels.copy,
          shortcut: formatShortcut(copyShortcut, platform),
          disabled: point.selection.length === 0,
          onSelect: () => copy(point.selection),
        },
        {
          key: 'paste',
          label: clipboardLabels.paste,
          shortcut: formatShortcut(pasteShortcut, platform),
          disabled: !canPaste(),
          onSelect: () => void pasteClipboard(),
        },
        { key: 'separator', kind: 'separator' },
        { key: 'selectAll', label: clipboardLabels.selectAll, onSelect: selectAll },
      ]}
    />
  );

  return { menu, onContextMenuCapture, handleClipboardShortcut };
}
