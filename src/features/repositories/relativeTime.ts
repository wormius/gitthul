/*
 * Cuánto hace que se abrió un repositorio, en la unidad que toca.
 *
 * Es puro y recibe el «ahora» en vez de leer el reloj: así se prueba sin fingir
 * `Date` y la lista entera se pinta contra un solo instante en vez de contra
 * uno distinto por fila.
 *
 * El texto no pasa por el catálogo de i18n porque no es una frase de GitThul
 * sino una forma del idioma, y quien la sabe conjugar es `Intl` — igual que el
 * orden alfabético lo sabe `Intl.Collator` y las fechas `Intl.DateTimeFormat`.
 * Traducirla a mano en cinco catálogos sería reimplementar, peor, lo que la
 * plataforma ya trae hecho para todos los idiomas.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * «hace 2 días», «la semana pasada», «ahora».
 *
 * La unidad se elige por magnitud y no se mezcla: «hace 1 mes» dice lo mismo
 * que «hace 32 días» y se lee de un vistazo. `numeric: 'auto'` es lo que
 * convierte «hace 1 día» en «ayer», que es como se dice de verdad.
 */
export function relativeTime(at: number, now: number, format: Intl.RelativeTimeFormat): string {
  const delta = at - now;
  const distance = Math.abs(delta);

  if (distance < MINUTE) return format.format(0, 'second');
  if (distance < HOUR) return format.format(Math.round(delta / MINUTE), 'minute');
  if (distance < DAY) return format.format(Math.round(delta / HOUR), 'hour');
  if (distance < WEEK) return format.format(Math.round(delta / DAY), 'day');
  if (distance < MONTH) return format.format(Math.round(delta / WEEK), 'week');
  if (distance < YEAR) return format.format(Math.round(delta / MONTH), 'month');

  return format.format(Math.round(delta / YEAR), 'year');
}
