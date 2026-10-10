import type { Person } from '@core/domain/commit';

/**
 * De qué está hecho el repositorio ficticio.
 *
 * Nada de esto es texto de interfaz —es contenido de un repositorio, como lo
 * sería la salida de git— así que no pasa por i18n. Todo apunta a dominios de
 * ejemplo: el proyecto no hace una sola petición de red que el usuario no haya
 * pedido, y una dirección de correo real en una firma sería justo eso.
 */

export const PEOPLE: readonly Person[] = [
  { name: 'Alex', email: 'alex@ejemplo.org' },
  { name: 'Ada Márquez', email: 'ada@ejemplo.org' },
  { name: 'Bruno Salas', email: 'bruno@ejemplo.org' },
  { name: 'Iris Fontana', email: 'iris@ejemplo.org' },
  { name: 'Kai Nakamura', email: 'kai@ejemplo.org' },
];

export interface FixturePath {
  path: string;
  /** Los binarios no tienen diff de líneas: tienen ficha. */
  binary: boolean;
  mediaType: string;
}

export const PATHS: readonly FixturePath[] = [
  { path: 'src/app/Shell.tsx', binary: false, mediaType: 'text/tsx' },
  { path: 'src/app/shellStore.ts', binary: false, mediaType: 'text/typescript' },
  { path: 'src/app/tabs.ts', binary: false, mediaType: 'text/typescript' },
  { path: 'src/app/keys.ts', binary: false, mediaType: 'text/typescript' },
  { path: 'src/ui/Button.tsx', binary: false, mediaType: 'text/tsx' },
  { path: 'src/ui/DataGrid.tsx', binary: false, mediaType: 'text/tsx' },
  { path: 'src/ui/VirtualList.tsx', binary: false, mediaType: 'text/tsx' },
  { path: 'src/ui/SplitPane.module.css', binary: false, mediaType: 'text/css' },
  { path: 'src/ui/Tooltip.module.css', binary: false, mediaType: 'text/css' },
  { path: 'src/design/roles.css', binary: false, mediaType: 'text/css' },
  { path: 'src/design/palette.css', binary: false, mediaType: 'text/css' },
  { path: 'src/design/density.css', binary: false, mediaType: 'text/css' },
  { path: 'src/features/working/CommitGraph.tsx', binary: false, mediaType: 'text/tsx' },
  { path: 'src/features/working/graphLayout.ts', binary: false, mediaType: 'text/typescript' },
  { path: 'src/features/repositories/RepoRow.tsx', binary: false, mediaType: 'text/tsx' },
  { path: 'src/core/ports/GitPort.ts', binary: false, mediaType: 'text/typescript' },
  { path: 'src/i18n/messages/es-MX.ts', binary: false, mediaType: 'text/typescript' },
  { path: 'src-tauri/src/git/read/commits.rs', binary: false, mediaType: 'text/rust' },
  { path: 'src-tauri/src/git/write/stage.rs', binary: false, mediaType: 'text/rust' },
  { path: 'src-tauri/src/commands/mod.rs', binary: false, mediaType: 'text/rust' },
  { path: 'src-tauri/Cargo.toml', binary: false, mediaType: 'text/toml' },
  { path: 'docs/plan.md', binary: false, mediaType: 'text/markdown' },
  { path: 'docs/inventario.md', binary: false, mediaType: 'text/markdown' },
  { path: 'README.md', binary: false, mediaType: 'text/markdown' },
  { path: 'package.json', binary: false, mediaType: 'application/json' },
  { path: 'brand/icons/512x512.png', binary: true, mediaType: 'image/png' },
  { path: 'brand/icons/icon.ico', binary: true, mediaType: 'image/vnd.microsoft.icon' },
  { path: 'src/design/fonts/space-grotesk-400.woff2', binary: true, mediaType: 'font/woff2' },
];

export const PATHS_BY_NAME = new Map(PATHS.map((entry) => [entry.path, entry]));

/**
 * Qué se puede saber de una ruta que no está en el catálogo.
 *
 * Pasa con los renombrados, que inventan destinos. La extensión basta: es lo
 * mismo que hace git para decidir si algo es binario.
 */
export function describePath(path: string): FixturePath {
  const known = PATHS_BY_NAME.get(path);

  if (known) return known;

  const binary = /\.(png|ico|icns|woff2?|jpg|pdf)$/.test(path);

  return { path, binary, mediaType: binary ? 'application/octet-stream' : 'text/plain' };
}

/**
 * Mensajes de commit del proyecto.
 *
 * Siguen la convención del repositorio de verdad —`F<fase>: <qué quedó hecho>`
 * y los prefijos convencionales para lo que no es fase— porque el objetivo del
 * repositorio falso es que la tabla de commits se vea como se verá de verdad.
 */
export const PHASE_MESSAGES: readonly string[] = [
  'F0.3: tokens, temas y las dos escalas de tipografía',
  'F0.4: primitivos de control con su prueba de no-desplazamiento',
  'F0.5: superposición y navegación sobre una sola capa flotante',
  'F0.6: primitivos de estructura y datos',
  'F0.7: shell, barra inferior y máquina de pestañas',
  'F0.8: puertos y adaptador falso',
  'F1.1: acciones, recientes y lista de repositorios',
  'F1.2: espacios personalizados con arrastre',
  'F1.3: panel de estadísticas y pantalla de inicio',
  'F2.1: esqueleto de GitWorking y panel izquierdo',
  'F2.2: barra de acciones y cabecera de columnas',
  'F2.3: cálculo de calles del grafo en canvas',
  'F2.4: etiquetas de rama y arrastre entre ramas',
  'F2.5: panel derecho, preparación y redacción del commit',
];

export const FIX_MESSAGES: readonly string[] = [
  'fix: el hover de la etiqueta ya no desplaza la fila',
  'fix: la pestaña independiente se va con su modo',
  'fix: el foco vuelve al disparador al cerrar el diálogo',
  'fix: el divisor respeta el mínimo del panel colapsado',
  'fix: el grafo repinta al cambiar de densidad',
  'fix: el atajo no dispara desde un campo de texto',
  'fix: la lista virtual recalcula al redimensionar la ventana',
  'fix: el tema Contraste dibuja el anillo de foco de 3 px',
  'fix: los stashes se ordenan por fecha y no por índice',
  'fix: el menú contextual se voltea contra el borde inferior',
];

export const CHORE_MESSAGES: readonly string[] = [
  'docs: el inventario marca como hechos los primitivos de la fase',
  'docs: el plan aclara qué entra en el bloque 2',
  'chore: prettier y eslint en la misma pasada',
  'chore: subir Vitest y quitar la configuración duplicada',
  'test: el grafo aguanta cien mil filas',
  'refactor: la máquina de pestañas queda en funciones puras',
  'refactor: los tokens de grafo salen de la capa de roles',
  'i18n: alemán y francés al día con la base',
];

export const MERGE_TEMPLATE = 'Fusionar {source} dentro de {target}';

export const BODIES: readonly string[] = [
  '',
  '',
  '',
  'La regla de dos usos decide: el componente se queda en la vista hasta que\nuna segunda lo pida.',
  'Toda acción nombra sus ramas, así que las cadenas reciben el nombre como\nparámetro en vez de decir «aquí».',
  'El hover reserva su caja desde el inicio; solo cambia la opacidad.',
  'Cierra el hueco que dejó la fase anterior sin tocar la interfaz.',
];

export const STASH_MESSAGES: readonly string[] = [
  'WIP: pruebas del motor de calles a medias',
  'WIP: paleta del tema Grimorio antes de revisar contraste',
  'WIP: filtro del panel de referencias',
];
