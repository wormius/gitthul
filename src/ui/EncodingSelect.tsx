import { TEXT_ENCODINGS, encodingLabel } from '@core/domain/encoding';
import { useI18n } from '@i18n/useI18n';

import { Select } from './Select';
import styles from './EncodingSelect.module.css';

interface EncodingSelectProps {
  value: string;
  detected?: string | null;
  decodingErrors?: boolean;
  disabled?: boolean;
  onChange: (encoding: string) => void;
}

/** Shared control: automatic detection and explicit reinterpretation of bytes. */
export function EncodingSelect({
  value,
  detected,
  decodingErrors,
  disabled,
  onChange,
}: EncodingSelectProps) {
  const { t } = useI18n();
  return (
    <div className={styles.control}>
      <Select
        label={t('working.diff.encoding')}
        hideLabel
        value={value}
        disabled={disabled}
        title={
          disabled ? t('encoding.busy') : value === 'auto' ? t('encoding.autoHint') : undefined
        }
        onChange={(event) => onChange(event.target.value)}
        options={[
          {
            value: 'auto',
            label: detected
              ? t('encoding.autoDetected', { encoding: encodingLabel(detected) })
              : t('encoding.auto'),
          },
          ...TEXT_ENCODINGS.map((name) => ({ value: name, label: encodingLabel(name) })),
        ]}
      />
      {decodingErrors && (
        <span
          className={styles.warning}
          role="status"
          aria-label={t('encoding.invalid')}
          title={t('encoding.invalid')}
        >
          �
        </span>
      )}
    </div>
  );
}
