import { usePorts } from '@app/PortsContext';
import type { TerminalExit } from '@core/ports/TerminalPort';
import { useI18n } from '@i18n/useI18n';
import { useToast } from '@ui/useToast';

import { CommandTerminalEmulator } from './CommandTerminalEmulator';
import { PtyTerminalEmulator } from './PtyTerminalEmulator';

interface TerminalEmulatorProps {
  sessionId: string;
  cwd: string;
  displayCwd: string;
  placeholder: string;
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
  onFocus?: () => void;
  onCwd?: (cwd: string) => void;
  exitMessage: (exit: TerminalExit) => string;
  onInsertRef?: React.MutableRefObject<((text: string) => void) | null>;
}

/** Elige el transporte real en Tauri y conserva el emulador falso en navegador/pruebas. */
export function TerminalEmulator(props: TerminalEmulatorProps) {
  const { link, terminal, system } = usePorts();
  const { t } = useI18n();
  const toast = useToast();
  const clipboardProps = {
    clipboard: system,
    clipboardLabels: {
      menu: t('view.terminal.contextMenu'),
      copy: t('view.terminal.copy'),
      paste: t('view.terminal.paste'),
      selectAll: t('view.terminal.selectAll'),
    },
    onClipboardError: (action: 'copy' | 'paste') =>
      toast.show({
        variant: 'danger',
        message: t(action === 'copy' ? 'view.terminal.copyFailed' : 'view.terminal.pasteFailed'),
      }),
  };

  if (terminal.kind === 'pty') {
    return (
      <PtyTerminalEmulator
        {...props}
        {...clipboardProps}
        terminal={terminal}
        openExternal={link.openExternal}
      />
    );
  }

  return (
    <CommandTerminalEmulator
      {...props}
      {...clipboardProps}
      cwd={props.displayCwd}
      terminal={terminal}
    />
  );
}
