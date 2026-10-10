/**
 * Qué secretos guarda GitThul y cómo se nombran.
 *
 * Nunca viven en los ajustes: el token con el que se accede a un remoto va al
 * gestor de llaves del sistema operativo, detrás de `KeyringPort`.
 */

/** Acceso a un remoto: el `id` es el host, `github.com`. */
export type CredentialKind = 'remote';

export interface CredentialRef {
  kind: CredentialKind;
  /** Identificador opaco y estable; nunca es el secreto ni una URL autenticada. */
  id: string;
}

/** Nombre de la entrada en el gestor de llaves. Estable: se usa para borrarla. */
export function credentialKey(ref: CredentialRef): string {
  return `${ref.kind}:${ref.id}`;
}
