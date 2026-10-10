import { IconButton } from './IconButton';
import { Spinner } from './Spinner';
import styles from './StatusMessage.module.css';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface StatusMessageProps {
  /** Qué pasó, en una frase, nombrando siempre sus ramas. */
  message: string;
  tone?: StatusTone;
  /** El porqué, cuando la frase no basta: «usó rebase porque no habías publicado». */
  detail?: string;
  /** La operación sigue en marcha. */
  busy?: boolean;
  /** Qué está corriendo, p. ej. «Trayendo de origin». Solo con `busy`. */
  busyLabel?: string;
  onDismiss?: () => void;
  /** Obligatoria si hay `onDismiss`. */
  dismissLabel?: string;
}

function DismissIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.4 3.4 8.6 8.6M8.6 3.4 3.4 8.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Resultado de la última operación, en la barra inferior.
 *
 * Es donde se lee «hizo pull con rebase porque tus commits no estaban
 * publicados»: información, no un aviso que interrumpa. Por eso vive en la barra
 * y no en un toast, y por eso el tono viaja además en el motivo de anillo — en
 * «Contraste» el color no puede ser el único portador.
 *
 * `role="status"` lo anuncia sin cortar lo que el lector de pantalla esté
 * diciendo; solo el tono de peligro usa `alert`, que sí interrumpe, porque un
 * fallo de una operación de git no puede pasar desapercibido.
 */
export function StatusMessage({
  message,
  tone = 'neutral',
  detail,
  busy,
  busyLabel,
  onDismiss,
  dismissLabel,
}: StatusMessageProps) {
  return (
    <div
      className={[styles.status, styles[tone]].join(' ')}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {/* El indicador queda fuera del árbol accesible: la región ya se anuncia
          entera, y una segunda zona viva dentro la haría hablar dos veces. */}
      <span className={styles.mark} aria-hidden="true">
        {busy ? (
          <Spinner size="sm" label={busyLabel ?? message} />
        ) : (
          <span className={styles.ring} />
        )}
      </span>

      <span className={styles.text}>
        <span className={styles.message}>{message}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>

      {onDismiss && dismissLabel && (
        <IconButton
          size="sm"
          icon={<DismissIcon />}
          aria-label={dismissLabel}
          onClick={onDismiss}
        />
      )}
    </div>
  );
}
