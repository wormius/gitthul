import { useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { GestureContext } from '@app/GestureContext';
import { matchesShortcut, parseShortcut } from '@app/keys';
import { detectPlatform } from '@app/platform';

import type { TerminalExit, TerminalPtyPort } from '@core/ports/TerminalPort';
import { useTheme } from '@design/useTheme';
import { readTerminalTheme } from '@design/terminalTheme';
import { Button } from '@ui/Button';
import { IconButton } from '@ui/IconButton';
import { SearchInput } from '@ui/SearchInput';

import styles from './TerminalEmulator.module.css';
import { findTerminalHttpLinks } from './terminalLinks';
import { findTerminalMatches } from './terminalSearch';
import { useTerminalClipboard, type TerminalClipboardProps } from './useTerminalClipboard';

let runtimeSequence = 0;
const FIND_SHORTCUT = parseShortcut('Mod+F');

interface PtyTerminalEmulatorProps extends TerminalClipboardProps {
  terminal: TerminalPtyPort;
  sessionId: string;
  cwd: string;
  outputLabel: string;
  errorMessage: string;
  searchLabel: string;
  searchClearLabel: string;
  searchPreviousLabel: string;
  searchNextLabel: string;
  searchCloseLabel: string;
  searchResultsLabel: (current: number, total: number) => string;
  linkTitle: string;
  linkDescription: (domain: string) => string;
  linkOpenLabel: (domain: string) => string;
  linkCancelLabel: string;
  openExternal: (url: string) => Promise<void>;
  onFocus?: () => void;
  onCwd?: (cwd: string) => void;
  exitMessage: (exit: TerminalExit) => string;
  onInsertRef?: React.MutableRefObject<((text: string) => void) | null>;
}

/** Terminal nativa: xterm pinta los bytes del shell y devuelve cada gesto al PTY. */
export function PtyTerminalEmulator({
  terminal: port,
  sessionId,
  cwd,
  outputLabel,
  errorMessage,
  searchLabel,
  searchClearLabel,
  searchPreviousLabel,
  searchNextLabel,
  searchCloseLabel,
  searchResultsLabel,
  linkTitle,
  linkDescription,
  linkOpenLabel,
  linkCancelLabel,
  openExternal,
  onFocus,
  onCwd,
  exitMessage,
  onInsertRef,
  clipboard,
  clipboardLabels,
  onClipboardError,
}: PtyTerminalEmulatorProps) {
  const gestures = useContext(GestureContext);
  const { settings, resolved } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const initialCwdRef = useRef(cwd);
  const onCwdRef = useRef(onCwd);
  const exitMessageRef = useRef(exitMessage);
  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const sessionReadyRef = useRef(false);
  const [sessionActive, setSessionActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const linkOpenRef = useRef<HTMLButtonElement>(null);
  const searchIndexRef = useRef(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPosition, setSearchPosition] = useState({ current: 0, total: 0 });
  const [pendingLink, setPendingLink] = useState<{ href: string; domain: string } | null>(null);
  const [runtimeSessionId] = useState(() => {
    runtimeSequence += 1;
    return `${sessionId}:pty-${String(runtimeSequence)}`;
  });

  useEffect(() => {
    onCwdRef.current = onCwd;
  }, [onCwd]);

  useEffect(() => {
    exitMessageRef.current = exitMessage;
  }, [exitMessage]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (pendingLink) linkOpenRef.current?.focus();
  }, [pendingLink]);

  const search = useCallback((query: string, direction: -1 | 0 | 1) => {
    const xterm = xtermRef.current;
    if (!xterm || query.length === 0) {
      searchIndexRef.current = -1;
      setSearchPosition({ current: 0, total: 0 });
      xterm?.clearSelection();
      return;
    }

    const buffer = xterm.buffer.active;
    const lines = Array.from(
      { length: buffer.length },
      (_, row) => buffer.getLine(row)?.translateToString(true) ?? '',
    );
    const matches = findTerminalMatches(lines, query);
    if (matches.length === 0) {
      searchIndexRef.current = -1;
      setSearchPosition({ current: 0, total: 0 });
      xterm.clearSelection();
      return;
    }

    const previous = searchIndexRef.current;
    const index =
      direction === 0 || previous < 0
        ? 0
        : (previous + direction + matches.length) % matches.length;
    const match = matches[index];
    if (!match) return;
    searchIndexRef.current = index;
    setSearchPosition({ current: index + 1, total: matches.length });
    xterm.select(match.column, match.row, match.length);
    xterm.scrollToLine(match.row);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    xtermRef.current?.focus();
  }, []);

  const terminalClipboard = useTerminalClipboard({
    clipboard,
    clipboardLabels,
    onClipboardError,
    hostRef,
    platform: gestures?.platform ?? detectPlatform(),
    getSelection: () => xtermRef.current?.getSelection() ?? '',
    paste: (text) => xtermRef.current?.paste(text),
    selectAll: () => xtermRef.current?.selectAll(),
    focus: () => xtermRef.current?.focus(),
    canPaste: () => sessionActive && sessionReadyRef.current,
  });

  const handleShortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (terminalClipboard.handleClipboardShortcut(event)) return;
    if (matchesShortcut(FIND_SHORTCUT, event, gestures?.platform ?? detectPlatform())) {
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
      return;
    }

    // xterm consume combinaciones como Ctrl+W antes de que alcancen window.
    // Solo los atajos declarados se atienden antes; Ctrl+C y el resto siguen al PTY.
    const gesture = gestures?.match(event.nativeEvent);
    if (!gesture) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.run();
  };

  useEffect(() => {
    const host = hostRef.current;
    const xterm = xtermRef.current;
    if (!host || !xterm) return;

    const computed = getComputedStyle(host);
    xterm.options.fontFamily = computed.fontFamily;
    xterm.options.fontSize = Number.parseFloat(computed.fontSize);
    xterm.options.theme = readTerminalTheme(computed);
    fitRef.current?.();
  }, [
    resolved.mode,
    resolved.theme,
    resolved.themeVariant,
    settings.codeFont,
    settings.codeFontSize,
    settings.density,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let active = true;
    let sessionReady = false;
    let exited = false;
    let observer: ResizeObserver | null = null;
    let disposeInput: (() => void) | null = null;
    let disposeLinks: (() => void) | null = null;

    const start = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (!active) return;

      const computed = getComputedStyle(host);
      const xterm = new Terminal({
        cursorBlink: true,
        screenReaderMode: true,
        scrollback: 5000,
        fontFamily: computed.fontFamily,
        fontSize: Number.parseFloat(computed.fontSize),
        theme: readTerminalTheme(computed),
      });
      const fit = new FitAddon();
      xterm.loadAddon(fit);
      xterm.open(host);
      xtermRef.current = xterm;
      const links = xterm.registerLinkProvider({
        provideLinks: (lineNumber, callback) => {
          const line = xterm.buffer.active.getLine(lineNumber - 1)?.translateToString(true) ?? '';
          callback(
            findTerminalHttpLinks(line).map((link) => ({
              text: link.href,
              range: {
                start: { x: link.start + 1, y: lineNumber },
                end: { x: link.start + link.length, y: lineNumber },
              },
              activate: () => setPendingLink({ href: link.href, domain: link.domain }),
              decorations: { pointerCursor: true, underline: true },
            })),
          );
        },
      });
      disposeLinks = () => links.dispose();

      const fitAndResize = () => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        fit.fit();
        if (sessionReady) {
          void port.resize(runtimeSessionId, xterm.cols, xterm.rows).catch(() => undefined);
        }
      };
      fitRef.current = fitAndResize;
      fitAndResize();

      const input = xterm.onData((data) => {
        if (exited) return;
        void port.write(runtimeSessionId, data).catch(() => xterm.writeln(`\r\n${errorMessage}`));
      });
      disposeInput = () => input.dispose();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(fitAndResize);
        observer.observe(host);
      }

      try {
        await port.createSession({
          sessionId: runtimeSessionId,
          cwd: initialCwdRef.current,
          cols: xterm.cols,
          rows: xterm.rows,
          onData: (data) => xterm.write(data),
          onCwd: (observedCwd) => onCwdRef.current?.(observedCwd),
          onExit: (exit) => {
            exited = true;
            sessionReady = false;
            sessionReadyRef.current = false;
            if (active) setSessionActive(false);
            xterm.options.disableStdin = true;
            xterm.writeln(`\r\n${exitMessageRef.current(exit)}`);
          },
        });
        if (!active) {
          await port.closeSession(runtimeSessionId).catch(() => undefined);
          return;
        }
        if (!exited) {
          sessionReady = true;
          sessionReadyRef.current = true;
          setSessionActive(true);
          // Un resize durante createSession aún no podía llegar al PTY.
          // Sincronizar antes de editar evita que ZLE redibuje con otro ancho.
          fitAndResize();
          xterm.focus();
        }
      } catch {
        xterm.writeln(errorMessage);
      }
    };

    void start();
    if (onInsertRef) onInsertRef.current = (text) => xtermRef.current?.paste(text);

    return () => {
      active = false;
      sessionReadyRef.current = false;
      observer?.disconnect();
      disposeInput?.();
      disposeLinks?.();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      if (onInsertRef) onInsertRef.current = null;
      void port.closeSession(runtimeSessionId).catch(() => undefined);
    };
  }, [errorMessage, onInsertRef, port, runtimeSessionId]);

  return (
    <div
      className={styles.emulator}
      onKeyDownCapture={handleShortcut}
      onContextMenuCapture={terminalClipboard.onContextMenuCapture}
    >
      {searchOpen && (
        <div className={styles.searchBar} role="search">
          <SearchInput
            ref={searchInputRef}
            className={styles.searchInput}
            label={searchLabel}
            placeholder={searchLabel}
            value={searchQuery}
            clearLabel={searchClearLabel}
            resultsLabel={searchResultsLabel(searchPosition.current, searchPosition.total)}
            onChange={(query) => {
              setSearchQuery(query);
              search(query, 0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                search(searchQuery, event.shiftKey ? -1 : 1);
              }
              if (event.key === 'Escape') closeSearch();
            }}
          />
          <IconButton
            size="sm"
            icon={<span aria-hidden="true">↑</span>}
            aria-label={searchPreviousLabel}
            title={searchPreviousLabel}
            disabled={searchPosition.total === 0}
            onClick={() => search(searchQuery, -1)}
          />
          <IconButton
            size="sm"
            icon={<span aria-hidden="true">↓</span>}
            aria-label={searchNextLabel}
            title={searchNextLabel}
            disabled={searchPosition.total === 0}
            onClick={() => search(searchQuery, 1)}
          />
          <IconButton
            size="sm"
            icon={<span aria-hidden="true">×</span>}
            aria-label={searchCloseLabel}
            title={searchCloseLabel}
            onClick={closeSearch}
          />
        </div>
      )}
      <div
        ref={hostRef}
        className={styles.pty}
        role="application"
        aria-label={outputLabel}
        onFocus={onFocus}
      />
      {terminalClipboard.menu}
      {pendingLink && (
        <div className={styles.linkPrompt} role="alertdialog" aria-label={linkTitle}>
          <strong>{linkTitle}</strong>
          <span>{linkDescription(pendingLink.domain)}</span>
          <div className={styles.linkActions}>
            <Button size="sm" variant="ghost" onClick={() => setPendingLink(null)}>
              {linkCancelLabel}
            </Button>
            <Button
              ref={linkOpenRef}
              size="sm"
              variant="primary"
              onClick={() => {
                const href = pendingLink.href;
                setPendingLink(null);
                void openExternal(href);
              }}
            >
              {linkOpenLabel(pendingLink.domain)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
