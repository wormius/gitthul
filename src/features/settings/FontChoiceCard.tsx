import { useState } from 'react';

import { NumberSlider } from './NumberSlider';
import { ResetButton } from './ResetButton';
import { ChosenIcon } from './SettingsIcons';
import styles from './FontChoiceCard.module.css';

interface FontOption {
  value: string;
  label: string;
}

interface FontChoiceCardProps {
  /** `ui` mueve la familia de interfaz; `code` la de los visores. */
  kind: 'ui' | 'code';
  title: string;
  /** Nombre accesible del grupo de familias. */
  familyLabel: string;
  options: readonly FontOption[];
  value: string;
  onChange: (value: string) => void;
  onResetFamily: () => void;
  familyIsDefault: boolean;
  sizeLabel: string;
  size: number;
  min: number;
  max: number;
  step: number;
  presets: readonly number[];
  presetsLabel: string;
  onSizeChange: (value: number) => void;
  onResetSize: () => void;
  sizeIsDefault: boolean;
  /** La línea de muestra. En `code` conviene que traiga cifras y letras confundibles. */
  specimen: string;
}

/**
 * Elegir una fuente viéndola: cada ficha se pinta **en la familia que ofrece**.
 *
 * Es la razón por la que esto no es un `Select`: las `option` de un desplegable
 * nativo no se pueden tipografiar en todos los motores, así que el desplegable
 * enseñaba cinco nombres escritos todos en la misma letra — justo el dato que
 * hacía falta para decidir. Cada ficha lleva `data-font-ui` o `data-font-code`,
 * que es lo que `typography.css` selecciona; por eso las dos familias de fábrica
 * tienen ahora su bloque por atributo y no solo el valor de `:root`.
 *
 * Las dos tarjetas —interfaz y código— alinean sus cuatro filas aunque una
 * ofrezca cinco familias y la otra cuatro: la rejilla de fuera declara las filas
 * y cada tarjeta las hereda con `subgrid`. Donde no haya `subgrid` la tarjeta
 * sigue funcionando; solo deja de alinearse con su hermana.
 *
 * El espécimen no necesita truco alguno: el tamaño ya se aplicó en caliente a
 * toda la aplicación, así que la muestra crece porque está dentro de ella.
 */
export function FontChoiceCard({
  kind,
  title,
  familyLabel,
  options,
  value,
  onChange,
  onResetFamily,
  familyIsDefault,
  sizeLabel,
  size,
  min,
  max,
  step,
  presets,
  presetsLabel,
  onSizeChange,
  onResetSize,
  sizeIsDefault,
  specimen,
}: FontChoiceCardProps) {
  /*
   * El tamaño que enseña el espécimen mientras se arrastra. El deslizador no
   * escribe hasta que se suelta —si no, la sección se re-maqueta bajo el cursor—
   * y sin esto el arrastre sería a ciegas. Va como `font-size` en línea y no como
   * variable porque la escala `--text-*` se resuelve donde se declara: pisarla en
   * un descendiente no la recalcula.
   */
  const [draftSize, setDraftSize] = useState(size);
  const [lastSize, setLastSize] = useState(size);

  if (size !== lastSize) {
    setLastSize(size);
    setDraftSize(size);
  }

  return (
    <section className={styles.card} data-kind={kind}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <ResetButton what={title} disabled={familyIsDefault} onReset={onResetFamily} />
      </header>

      <div className={styles.families} role="radiogroup" aria-label={familyLabel}>
        {options.map((option) => {
          const selected = option.value === value;
          const attributes =
            kind === 'ui' ? { 'data-font-ui': option.value } : { 'data-font-code': option.value };

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={styles.family}
              data-selected={selected || undefined}
              {...attributes}
              onClick={() => {
                onChange(option.value);
              }}
            >
              <span className={styles.sample} aria-hidden="true">
                Aa
              </span>
              <span className={styles.name}>{option.label}</span>
              <span className={styles.check} aria-hidden="true">
                <ChosenIcon />
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.size}>
        <div className={styles.head}>
          <span className={styles.sizeLabel}>{sizeLabel}</span>
          <ResetButton what={sizeLabel} disabled={sizeIsDefault} onReset={onResetSize} />
        </div>
        <NumberSlider
          label={sizeLabel}
          value={size}
          min={min}
          max={max}
          step={step}
          presets={presets}
          presetsLabel={presetsLabel}
          onChange={onSizeChange}
          onDraft={setDraftSize}
        />
      </div>

      <p
        className={styles.specimen}
        style={{ fontSize: `${String(draftSize)}px` }}
        aria-hidden="true"
      >
        {specimen}
      </p>
    </section>
  );
}
