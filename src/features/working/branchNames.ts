/**
 * La validación de nombres de rama y de tag, escrita una sola vez.
 *
 * Crear y renombrar comparten reglas —lo que git acepta como
 * `refs/heads/<nombre>`— y el diálogo de tag comparte casi todas, así que la
 * regla vive aquí y no dentro de cada uno. Es el mismo criterio de
 * `validateSpaceName` en Repositorios: lo que rechaza el campo tiene que ser
 * exactamente lo que rechazaría git.
 */

export type RefNameProblem = 'empty' | 'invalid' | 'taken';

/** Lo que `git check-ref-format` prohíbe, reducido a lo que un campo puede ver. */
const INVALID = /[\s~^:?*[\\]|\.\.|@\{|^[-./]|[-./]$|\.lock$|\/\//;

export function validateRefName(
  name: string,
  taken: readonly string[],
  /** Renombrar admite que el nombre siga siendo el suyo mientras se escribe. */
  own?: string,
): RefNameProblem | null {
  const clean = name.trim();

  if (clean === '') return 'empty';
  if (INVALID.test(clean)) return 'invalid';
  if (clean !== own && taken.includes(clean)) return 'taken';

  return null;
}

/**
 * La carpeta hermana que el asistente de worktree propone: `../<repo>-<rama>`.
 *
 * La rama puede traer barras —`fix/push-rechazado`— y una carpeta con barras
 * sería otra carpeta dentro, así que se aplanan a guiones.
 */
export function suggestedWorktreePath(repoPath: string, repoName: string, branch: string): string {
  const parent = repoPath.slice(0, Math.max(repoPath.lastIndexOf('/'), 0));
  const suffix = branch.trim() === '' ? '' : `-${branch.trim().replace(/\//g, '-')}`;

  return `${parent}/${repoName}${suffix}`;
}
