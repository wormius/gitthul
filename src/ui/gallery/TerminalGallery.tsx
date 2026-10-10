import type { TerminalPtyPort } from '@core/ports/TerminalPort';
import { PtyTerminalEmulator } from '@features/terminal/PtyTerminalEmulator';
import { usePorts } from '@app/PortsContext';
import { useToast } from '@ui/useToast';

import styles from './TerminalGallery.module.css';

const SAMPLE_OUTPUT = [
  '\u001b[1;36mGitThul Terminal\u001b[0m',
  'Primera coincidencia segura',
  'Segunda coincidencia del historial',
  'Documentación: https://docs.example.test/terminal',
  '$ ',
].join('\r\n');

const galleryTerminal: TerminalPtyPort = {
  kind: 'pty',
  createSession: (request) => {
    request.onData(new TextEncoder().encode(SAMPLE_OUTPUT));
    return Promise.resolve();
  },
  write: () => Promise.resolve(),
  resize: () => Promise.resolve(),
  closeSession: () => Promise.resolve(),
};

/** Espécimen determinista del xterm real; no crea procesos ni abre enlaces. */
export function TerminalGallery() {
  const { system } = usePorts();
  const toast = useToast();
  return (
    <div className={styles.stage}>
      <PtyTerminalEmulator
        terminal={galleryTerminal}
        sessionId="terminal-gallery"
        cwd="/repo"
        outputLabel="Terminal de revisión"
        errorMessage="No se pudo iniciar la terminal de revisión."
        searchLabel="Buscar en el historial"
        searchClearLabel="Vaciar búsqueda"
        searchPreviousLabel="Coincidencia anterior"
        searchNextLabel="Coincidencia siguiente"
        searchCloseLabel="Cerrar búsqueda"
        searchResultsLabel={(current, total) => `${String(current)} de ${String(total)}`}
        linkTitle="Abrir enlace externo"
        linkDescription={(domain) => `El navegador del sistema abrirá ${domain}.`}
        linkOpenLabel={(domain) => `Abrir ${domain}`}
        linkCancelLabel="Cancelar"
        openExternal={() => Promise.resolve()}
        exitMessage={() => 'La sesión terminó.'}
        clipboard={system}
        clipboardLabels={{
          menu: 'Acciones de la terminal',
          copy: 'Copiar',
          paste: 'Pegar',
          selectAll: 'Seleccionar todo',
        }}
        onClipboardError={(action) =>
          toast.show({
            variant: 'danger',
            message:
              action === 'copy'
                ? 'No se pudo copiar al portapapeles'
                : 'No se pudo pegar desde el portapapeles',
          })
        }
      />
    </div>
  );
}
