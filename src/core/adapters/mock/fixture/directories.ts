/**
 * Las carpetas que el selector falso ofrece.
 *
 * Existen para que los tres finales de «Abrir una carpeta» se puedan ver sin
 * programar nada: pulsar el botón varias veces recorre esta lista y produce, en
 * orden, una carpeta que sí es repositorio, una que no lo es y una que ya estaba
 * en la lista. Sin esto, el camino de fallo de la vista se desarrollaría a
 * ciegas hasta que alguien escribiera su prueba.
 *
 * La tabla es una sola porque el selector y git tienen que estar de acuerdo:
 * `mockSystemPort` decide qué carpeta se elige y `mockGitPort` decide qué
 * encuentra dentro, y si cada uno tuviera su propia lista podrían contradecirse.
 * Una ruta que no esté aquí se trata como repositorio, que es lo que deja a las
 * pruebas inventar la suya sin pedir permiso.
 */
export interface MockDirectory {
  path: string;
  /** Si git vive dentro. `false` produce `repo.notARepository`. */
  repository: boolean;
}

export const MOCK_DIRECTORIES: readonly MockDirectory[] = [
  { path: '/home/example/projects/tesis', repository: true },
  { path: '/home/example/Descargas', repository: false },
  // Ya conocida por el mundo falso: el camino de `repo.alreadyExists`.
  { path: '/home/example/projects/gitthul', repository: true },
  { path: '/home/example/projects/tipografias', repository: true },
  { path: '/home/example/Documentos/recetas', repository: false },
];

export function isMockRepositoryDirectory(path: string): boolean {
  return MOCK_DIRECTORIES.find((entry) => entry.path === path)?.repository ?? true;
}
