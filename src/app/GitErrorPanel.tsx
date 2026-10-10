import { describeError, type GitFixId, type GitOperationError } from '@core/domain/errors';
import { useI18n } from '@i18n/useI18n';
import { ErrorPanel } from '@ui/ErrorPanel';

interface GitErrorPanelProps {
  error: GitOperationError;
  /**
   * Qué sabe hacer esta vista con cada arreglo del catálogo. Los que no tengan
   * quien los ejecute no se ofrecen: un botón que no lleva a ninguna parte es
   * peor que un botón de menos.
   */
  fixes?: Partial<Record<GitFixId, () => void>>;
}

/**
 * Un fallo de git, contado como manda el proyecto.
 *
 * `ErrorPanel` es un primitivo y no sabe nada de git; esta pieza es la que ata
 * el catálogo tipado con él: traduce el código a frase, causa y arreglos, y le
 * pasa la salida original para que quede plegada debajo. Vive en `src/app` y no
 * en `src/ui` justamente porque sí sabe de git, y en cambio no es de ninguna
 * vista en particular — lo usan todas.
 */
export function GitErrorPanel({ error, fixes }: GitErrorPanelProps) {
  const { t } = useI18n();
  const described = describeError(error);

  const offered = described.fixes.flatMap((fix) => {
    const onSelect = fixes?.[fix.id];

    return onSelect
      ? [
          {
            key: fix.id,
            label: t(fix.labelKey, described.params),
            onSelect,
            ...(fix.primary ? { primary: true } : {}),
          },
        ]
      : [];
  });

  return (
    <ErrorPanel
      title={t(described.titleKey, described.params)}
      cause={t(described.causeKey, described.params)}
      fixes={offered}
      {...(described.output === undefined
        ? {}
        : { output: described.output, outputLabel: t('error.output') })}
    />
  );
}
