import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';

interface ResetButtonProps {
  /** Qué se restablece, ya traducido: «Tema», «Densidad», «Tamaño de código»… */
  what: string;
  /** Si ya está en su valor de fábrica no hay nada que restablecer. */
  disabled: boolean;
  onReset: () => void;
}

/**
 * Restablecer una sola cosa.
 *
 * El rótulo visible es corto porque va pegado al bloque que restablece, pero el
 * nombre accesible dice qué —«Restablecer Tema»—: con seis de estos en la
 * sección, un lector de pantalla que solo oyera «Restablecer» no distinguiría
 * uno de otro. Es la misma regla que obliga a nombrar las ramas en cada acción.
 *
 * Deshabilitado cuando el valor ya es el de fábrica: así el botón dice además si
 * hay algo cambiado, sin necesidad de una marca aparte.
 */
export function ResetButton({ what, disabled, onReset }: ResetButtonProps) {
  const { t } = useI18n();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-label={t('settings.resetOne', { what })}
      onClick={onReset}
    >
      {t('settings.resetShort')}
    </Button>
  );
}
