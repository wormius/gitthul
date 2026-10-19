import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { TerminalPaneDescriptor } from '@core/domain/terminal';
import type { TerminalExit } from '@core/ports/TerminalPort';
import { IconButton } from '@ui/IconButton';

import { TerminalEmulator } from './TerminalEmulator';
import styles from './TerminalPane.module.css';

export interface TerminalPaneProps {
  pane: TerminalPaneDescriptor;
  paneIndex: number;
  activePaneId: string;
  sessionPrefix: string;
  outputLabel: string;
  placeholder: string;
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
  exitMessage: (exit: TerminalExit) => string;
  paneName: (index: number) => string;
  activeLabel: string;
  renameLabel: string;
  splitHorizontalLabel: string;
  splitVerticalLabel: string;
  closeLabel: string;
  openWorkingLabel: string;
  repositoryAvailable?: boolean;
  onActivate: (paneId: string) => void;
  onRename: (paneId: string, title: string) => void;
  onSplit: (paneId: string, orientation: 'horizontal' | 'vertical') => void;
  onClose: (paneId: string) => void;
  onOpenWorking?: () => void;
  onCwd: (paneId: string, cwd: string) => void;
  registerInsert: (paneId: string, insert: ((text: string) => void) | null) => void;
}

function HorizontalSplitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" />
      <path d="M8 3v10" stroke="currentColor" />
    </svg>
  );
}

function VerticalSplitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" />
      <path d="M2 8h12" stroke="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function WorkingIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="4" r="1.5" stroke="currentColor" />
      <circle cx="4" cy="12" r="1.5" stroke="currentColor" />
      <circle cx="12" cy="8" r="1.5" stroke="currentColor" />
      <path d="M4 5.5v5M5.5 4h1A5.5 5.5 0 0 1 12 8" stroke="currentColor" />
    </svg>
  );
}

/** Un pane nombra y gobierna exactamente un emulador; desmontarlo cierra su PTY. */
export function TerminalPane({
  pane,
  paneIndex,
  activePaneId,
  sessionPrefix,
  outputLabel,
  placeholder,
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
  exitMessage,
  paneName,
  activeLabel,
  renameLabel,
  splitHorizontalLabel,
  splitVerticalLabel,
  closeLabel,
  openWorkingLabel,
  repositoryAvailable = false,
  onActivate,
  onRename,
  onSplit,
  onClose,
  onOpenWorking,
  onCwd,
  registerInsert,
}: TerminalPaneProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const insertRef = useRef<((text: string) => void) | null>(null);
  const cancelRenameRef = useRef(false);
  const active = pane.id === activePaneId;
  const title = pane.title ?? paneName(paneIndex + 1);
  const displayCwd = pane.cwd.split('/').filter(Boolean).at(-1) ?? '~';

  useEffect(() => {
    registerInsert(pane.id, (text) => insertRef.current?.(text));
    return () => registerInsert(pane.id, null);
  }, [pane.id, registerInsert]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const beginRename = () => {
    cancelRenameRef.current = false;
    setDraft(title);
    setEditing(true);
  };
  const finishRename = () => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    onRename(pane.id, draft);
    setEditing(false);
  };
  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      cancelRenameRef.current = true;
      setEditing(false);
    }
  };

  return (
    <section
      className={styles.pane}
      data-active={active || undefined}
      aria-label={title}
      onFocus={() => onActivate(pane.id)}
      onPointerDown={() => onActivate(pane.id)}
    >
      <header className={styles.header}>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.nameInput}
            aria-label={renameLabel}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={finishRename}
            onKeyDown={handleRenameKey}
          />
        ) : (
          <button
            type="button"
            className={styles.name}
            aria-label={`${renameLabel}: ${title}`}
            title={renameLabel}
            onDoubleClick={beginRename}
            onClick={() => onActivate(pane.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'F2') beginRename();
            }}
          >
            <span>{title}</span>
            {active && <span className={styles.active}>{activeLabel}</span>}
          </button>
        )}
        <div className={styles.actions}>
          {repositoryAvailable && onOpenWorking && (
            <IconButton
              size="sm"
              icon={<WorkingIcon />}
              aria-label={openWorkingLabel}
              title={openWorkingLabel}
              onClick={onOpenWorking}
            />
          )}
          <IconButton
            size="sm"
            icon={<HorizontalSplitIcon />}
            aria-label={splitHorizontalLabel}
            title={splitHorizontalLabel}
            onClick={() => onSplit(pane.id, 'horizontal')}
          />
          <IconButton
            size="sm"
            icon={<VerticalSplitIcon />}
            aria-label={splitVerticalLabel}
            title={splitVerticalLabel}
            onClick={() => onSplit(pane.id, 'vertical')}
          />
          <IconButton
            size="sm"
            icon={<CloseIcon />}
            aria-label={closeLabel}
            title={closeLabel}
            onClick={() => onClose(pane.id)}
          />
        </div>
      </header>
      <div className={styles.emulator}>
        <TerminalEmulator
          sessionId={`${sessionPrefix}:${pane.id}`}
          cwd={pane.cwd}
          displayCwd={displayCwd}
          placeholder={placeholder}
          outputLabel={`${outputLabel}: ${title}`}
          errorMessage={errorMessage}
          searchLabel={searchLabel}
          searchClearLabel={searchClearLabel}
          searchPreviousLabel={searchPreviousLabel}
          searchNextLabel={searchNextLabel}
          searchCloseLabel={searchCloseLabel}
          searchResultsLabel={searchResultsLabel}
          linkTitle={linkTitle}
          linkDescription={linkDescription}
          linkOpenLabel={linkOpenLabel}
          linkCancelLabel={linkCancelLabel}
          exitMessage={exitMessage}
          onInsertRef={insertRef}
          onFocus={() => onActivate(pane.id)}
          onCwd={(cwd) => onCwd(pane.id, cwd)}
        />
      </div>
    </section>
  );
}
