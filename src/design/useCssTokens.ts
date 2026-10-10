import { useEffect, useState } from 'react';

const WATCHED_ATTRIBUTES = [
  'data-theme',
  'data-theme-variant',
  'data-mode',
  'data-density',
  'data-font-ui',
  'data-font-code',
  'style',
];

function readTokens(names: readonly string[]): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const values: Record<string, string> = {};

  for (const name of names) values[name] = computed.getPropertyValue(name).trim();

  return values;
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Lee tokens ya resueltos de `<html>` y los mantiene al día.
 *
 * Hay cosas que no se pueden pintar con CSS y necesitan el valor en JavaScript:
 * el grafo se dibuja en canvas y el informe de contraste mide colores. Observar
 * los atributos del elemento raíz — y no depender del orden de los efectos —
 * es lo que hace que esos consumidores se enteren de un cambio de tema, venga
 * de donde venga.
 *
 * `names` tiene que ser una constante estable, no un arreglo recién creado en
 * cada pintado.
 */
export function useCssTokens(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState(() => readTokens(names));

  useEffect(() => {
    const refresh = () => {
      setValues((previous) => {
        const next = readTokens(names);

        return sameValues(previous, next) ? previous : next;
      });
    };

    refresh();

    const observer = new MutationObserver(refresh);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });

    return () => {
      observer.disconnect();
    };
  }, [names]);

  return values;
}
