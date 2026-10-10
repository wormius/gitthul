import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { GestureContext } from '@app/GestureContext';
import { detectPlatform } from '@app/platform';

import type { TerminalOutputLine } from '@core/domain/terminal';
import type { TerminalCommandPort } from '@core/ports/TerminalPort';

import { TerminalInput, type TerminalInputHandle } from './TerminalInput';
import { TerminalOutput, type OutputEntry } from './TerminalOutput';
import styles from './TerminalEmulator.module.css';
import { useTerminalClipboard, type TerminalClipboardProps } from './useTerminalClipboard';

const CLEAR_MARKER = '\x1b[clear]';

interface CommandTerminalEmulatorProps extends TerminalClipboardProps {
  terminal: TerminalCommandPort;
  sessionId: string;
  cwd: string;
  placeholder: string;
  outputLabel: string;
  onFocus?: () => void;
  onInsertRef?: React.MutableRefObject<((text: string) => void) | null>;
}

/** Emulador determinista de navegador, útil para galería y estados de prueba. */
export function CommandTerminalEmulator({
  terminal,
  sessionId,
  cwd,
  placeholder,
  outputLabel,
  onFocus,
  onInsertRef,
  clipboard,
  clipboardLabels,
  onClipboardError,
}: CommandTerminalEmulatorProps) {
  const gestures = useContext(GestureContext);
  const hostRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inputHandle = useRef<TerminalInputHandle>(null);
  const terminalClipboard = useTerminalClipboard({
    clipboard,
    clipboardLabels,
    onClipboardError,
    hostRef,
    platform: gestures?.platform ?? detectPlatform(),
    getSelection: () => {
      const input = hostRef.current?.querySelector('input');
      if (input && document.activeElement === input) {
        return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
      }
      const selection = window.getSelection();
      return selection?.anchorNode && hostRef.current?.contains(selection.anchorNode)
        ? selection.toString()
        : '';
    },
    paste: (text) => inputHandle.current?.insert(text),
    selectAll: () => {
      const output = hostRef.current?.querySelector('[role="log"]');
      if (!output) return;
      const range = document.createRange();
      range.selectNodeContents(output);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    focus: () => inputHandle.current?.focus(),
    canPaste: () => !running && Boolean(hostRef.current),
  });

  useEffect(() => {
    if (onInsertRef) onInsertRef.current = (text) => inputHandle.current?.insert(text);
    return () => {
      if (onInsertRef) onInsertRef.current = null;
    };
  }, [onInsertRef]);

  const handleSubmit = useCallback(
    (command: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      const entry: OutputEntry = { command, cwd, lines: [] };
      const lines: TerminalOutputLine[] = [];
      setEntries((previous) => [...previous, entry]);

      const run = async () => {
        try {
          for await (const line of terminal.execute(sessionId, command, controller.signal)) {
            if (line.text === CLEAR_MARKER) {
              setEntries([]);
              break;
            }
            lines.push(line);
            setEntries((previous) => {
              const updated = [...previous];
              updated[updated.length - 1] = { ...entry, lines: [...lines] };
              return updated;
            });
          }
        } catch {
          lines.push({ stream: 'stdout', text: '^C' });
          setEntries((previous) => {
            const updated = [...previous];
            updated[updated.length - 1] = { ...entry, lines: [...lines] };
            return updated;
          });
        } finally {
          setRunning(false);
          abortRef.current = null;
          setHistory((previous) => [...previous, command]);
        }
      };
      void run();
    },
    [terminal, sessionId, cwd],
  );

  return (
    <div
      ref={hostRef}
      className={styles.emulator}
      onFocus={onFocus}
      onKeyDownCapture={terminalClipboard.handleClipboardShortcut}
      onContextMenuCapture={terminalClipboard.onContextMenuCapture}
    >
      <TerminalOutput entries={entries} label={outputLabel} />
      <TerminalInput
        cwd={cwd}
        disabled={running}
        placeholder={placeholder}
        onSubmit={handleSubmit}
        onCancel={() => abortRef.current?.abort()}
        onClear={() => setEntries([])}
        history={history}
        handleRef={inputHandle}
      />
      {terminalClipboard.menu}
    </div>
  );
}
