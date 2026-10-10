import { useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react';

import styles from './TerminalInput.module.css';

/** Lo que el padre puede pedirle a la línea de entrada. */
export interface TerminalInputHandle {
  insert: (text: string) => void;
  focus: () => void;
}

interface TerminalInputProps {
  cwd: string;
  disabled: boolean;
  placeholder: string;
  onSubmit: (command: string) => void;
  onCancel: () => void;
  onClear: () => void;
  history: readonly string[];
  /** Para controlar la inserción y el foco desde el rail. */
  handleRef?: Ref<TerminalInputHandle>;
}

/**
 * La línea de entrada de la terminal: prompt + campo editable.
 *
 * Captura Enter (ejecutar), ↑/↓ (historial), Ctrl+C (cancelar) y Mod+K
 * (limpiar). El campo se marca con `data-input-priority` para que `keys.ts`
 * no capture los atajos globales mientras tiene el foco.
 */
export function TerminalInput({
  cwd,
  disabled,
  placeholder,
  onSubmit,
  onCancel,
  onClear,
  history,
  handleRef,
}: TerminalInputProps) {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedInput = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(handleRef, () => ({
    insert(text: string) {
      const input = inputRef.current;

      if (!input) {
        setValue((previous) => previous + text);

        return;
      }

      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? value.length;
      const next = value.slice(0, start) + text + value.slice(end);

      setValue(next);

      requestAnimationFrame(() => {
        input.selectionStart = start + text.length;
        input.selectionEnd = start + text.length;
        input.focus();
      });
    },
    focus() {
      inputRef.current?.focus();
    },
  }));

  const submit = () => {
    const trimmed = value.trim();

    if (!trimmed) return;

    onSubmit(trimmed);
    setValue('');
    setHistoryIndex(-1);
    savedInput.current = '';
  };

  const navigateHistory = (direction: 1 | -1) => {
    if (history.length === 0) return;

    let next = historyIndex + direction;

    // Salir del historial vuelve al texto que se estaba escribiendo.
    if (next < 0) {
      setHistoryIndex(-1);
      setValue(savedInput.current);

      return;
    }

    if (next >= history.length) next = history.length - 1;

    // Al entrar en el historial por primera vez, se guarda lo que haya escrito.
    if (historyIndex === -1) savedInput.current = value;

    setHistoryIndex(next);
    // El historial va de más viejo a más nuevo; ↑ es retroceder.
    setValue(history[history.length - 1 - next] ?? '');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();

      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateHistory(1);

      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateHistory(-1);

      return;
    }

    // Ctrl+C con la línea vacía cancela; con texto, deja que el navegador copie.
    if (event.key === 'c' && event.ctrlKey && !value) {
      event.preventDefault();
      onCancel();

      return;
    }

    // Mod+K limpia la pantalla.
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onClear();
    }
  };

  return (
    <div className={styles.wrapper} data-terminal-input="">
      <span className={styles.prompt} aria-hidden="true">
        {cwd}$
      </span>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        data-input-priority=""
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
