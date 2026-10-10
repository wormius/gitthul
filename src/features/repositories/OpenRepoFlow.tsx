import { GitErrorPanel } from '@app/GitErrorPanel';
import type { GitErrorParams, GitOperationError } from '@core/domain/errors';
import { useI18n } from '@i18n/useI18n';
import { Dialog } from '@ui/Dialog';

interface OpenRepoFlowProps {
  /** `null` cuando no hay nada que contar, que es casi siempre. */
  error: GitOperationError | null;
  onClose: () => void;
  /** Volver a abrir el selector, que es el arreglo que esta vista sí sabe hacer. */
  onChooseAnother: () => void;
  /** CU-6: crear el repositorio en la misma carpeta que resultó no tener git. */
  onCreateHere: (path: string) => void;
}

/**
 * Lo que se ve cuando abrir una carpeta como repositorio no sale bien.
 *
 * El camino feliz de CU-5 no pinta nada: se elige la carpeta, se suma a la lista
 * y queda seleccionada. Cancelar el selector tampoco pinta nada — quien abre un
 * diálogo y cambia de idea no ha roto nada. Y que la carpeta ya estuviera en la
 * lista se resuelve seleccionando la fila que ya había, con un aviso en la barra
 * inferior: eso es un reencuentro, no un fallo.
 *
 * Queda este diálogo para lo que sí lo es, sobre todo una carpeta sin git
 * dentro. **Solo se ofrecen los arreglos que esta vista sabe ejecutar**: elegir
 * otra carpeta vuelve a abrir el selector, y «crear el repositorio aquí» abre
 * `CreateRepoDialog` con esa misma carpeta ya elegida. Un botón que no lleva a
 * ninguna parte es peor que un botón de menos.
 */
export function OpenRepoFlow({ error, onClose, onChooseAnother, onCreateHere }: OpenRepoFlowProps) {
  const { t } = useI18n();

  if (!error) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={t('repositories.folderFailed.title')}
      closeLabel={t('repositories.folderFailed.close')}
    >
      <GitErrorPanel
        error={error}
        fixes={{
          chooseAnotherFolder: () => {
            onClose();
            onChooseAnother();
          },
          createRepoHere: () => {
            const params = error.params as GitErrorParams['repo.notARepository'];

            onClose();
            onCreateHere(params.path);
          },
          retry: () => {
            onClose();
            onChooseAnother();
          },
        }}
      />
    </Dialog>
  );
}
