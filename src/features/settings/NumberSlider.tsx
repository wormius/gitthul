import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';

import styles from './NumberSlider.module.css';

interface NumberSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /**
   * El valor mientras se arrastra, antes de escribirse. Sirve para que algo
   * pequeño —el espécimen de la tarjeta— dé la respuesta que el arrastre necesita
   * sin que la escriba nadie.
   */
  onDraft?: (value: number) => void;
  /** Medidas que se ofrecen como botón, para no tener que atinarle arrastrando. */
  presets?: readonly number[];
  /** Nombre accesible del grupo de predefinidos; obligatorio si hay predefinidos. */
  presetsLabel?: string;
}

/** Lo que tarda en escribirse un cambio de teclado o de campo tras la última tecla. */
const COMMIT_DELAY = 200;

/**
 * Deslizador, campo numérico y medidas predefinidas, sincronizados.
 *
 * **Con el puntero abajo no se escribe nada, pase el tiempo que pase.** Estos dos
 * ajustes cambian el tamaño de la interfaz **que contiene al deslizador**, así que
 * escribir a mitad del arrastre re-maqueta la sección y el control se va de debajo
 * del cursor. La primera versión escribía en cada sacudida; la segunda esperaba
 * 200 ms de quietud, y seguía escribiendo a mitad del arrastre en cuanto la mano
 * se detenía un instante — que arrastrando despacio es todo el rato. Ahora el
 * arrastre solo mueve el borrador y se escribe al soltar, que es lo que CU-4 del
 * subplan quería decir.
 *
 * El rebote se queda para lo que no tiene «soltar»: teclear una cifra en el campo.
 * Las flechas del teclado escriben al levantar la tecla, y los predefinidos en el
 * acto: un clic ya es una decisión terminada.
 */
export function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onDraft,
  presets,
  presetsLabel,
}: NumberSliderProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);

  /*
   * El deslizador se guarda para poder leerlo al soltar: quien escribe el valor
   * final es un oyente de `window` registrado en el `pointerdown`, y dentro de él
   * el `draft` capturado sería el del render en que se apretó, no el del último
   * movimiento. El elemento sí tiene el valor al día.
   */
  const slider = useRef<HTMLInputElement | null>(null);

  /*
   * Un cambio de fuera —restablecer, un predefinido, el valor recortado al
   * guardarse— manda sobre el borrador. Se ajusta durante el render y no en un
   * efecto: un efecto que llama a `setState` provoca un segundo render en cascada,
   * y aquí el dato viene de una prop, así que no hace falta esperar a que el
   * navegador pinte para saberlo.
   */
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function cancelPending() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function clamp(next: number) {
    return Math.min(max, Math.max(min, Math.round(next)));
  }

  /** Mueve el borrador y avisa, sin escribir. */
  function draftOnly(next: number) {
    setDraft(next);
    onDraft?.(next);
  }

  function schedule(next: number) {
    draftOnly(next);
    cancelPending();

    timer.current = setTimeout(() => {
      timer.current = null;
      onChange(next);
    }, COMMIT_DELAY);
  }

  function commit(next: number) {
    cancelPending();
    draftOnly(next);
    onChange(next);
  }

  /** Lo que el deslizador tiene puesto ahora mismo, sin pasar por el estado. */
  function sliderValue() {
    const raw = slider.current?.value;

    return raw === undefined ? draft : clamp(Number(raw));
  }

  function handleSlider(event: ChangeEvent<HTMLInputElement>) {
    const next = clamp(Number(event.target.value));

    // Arrastrando, solo borrador. Con el teclado no hay «soltar» que esperar, así
    // que ahí sí vale el rebote.
    if (dragging.current) draftOnly(next);
    else schedule(next);
  }

  function handleNumber(event: ChangeEvent<HTMLInputElement>) {
    const parsed = Number(event.target.value);

    if (Number.isFinite(parsed)) schedule(clamp(parsed));
  }

  /*
   * El final del arrastre se escucha en `window` y no en el control: soltar el
   * botón fuera de él —o que el gestor de ventanas se lleve el puntero— dejaría el
   * arrastre abierto para siempre y el ajuste sin escribirse.
   */
  function handlePointerDown() {
    dragging.current = true;
    cancelPending();

    const finish = () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);

      if (!dragging.current) return;

      dragging.current = false;
      commit(sliderValue());
    };

    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.track}>
        <input
          id={id}
          ref={slider}
          type="range"
          className={styles.slider}
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={handleSlider}
          onPointerDown={handlePointerDown}
          onKeyUp={() => {
            commit(sliderValue());
          }}
          onBlur={() => {
            commit(sliderValue());
          }}
        />
        <input
          type="number"
          className={styles.number}
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={handleNumber}
          onBlur={() => {
            commit(draft);
          }}
        />
      </div>

      {presets && presetsLabel && (
        <div className={styles.presets} role="radiogroup" aria-label={presetsLabel}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={draft === preset}
              aria-label={`${String(preset)} px`}
              className={styles.preset}
              data-selected={draft === preset || undefined}
              onClick={() => {
                commit(preset);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
