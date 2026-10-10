import { useEffect, useState } from 'react';

import { usePorts } from '@app/PortsContext';
import type { RepoId } from '@core/domain/repository';
import type { RepoAvatar } from '@core/domain/library';

/**
 * Lee el avatar elegido de un repositorio desde `LibraryPort`.
 *
 * Devuelve `null` mientras no se ha leído o cuando no hay ninguno elegido —en
 * ambos casos `Avatar` pinta las iniciales del nombre, que es lo correcto.
 */
export function useRepoAvatar(repoId: RepoId): RepoAvatar | null {
  const { library } = usePorts();
  const [avatar, setAvatar] = useState<RepoAvatar | null>(null);

  useEffect(() => {
    let active = true;

    void library
      .read()
      .then((current) => {
        if (active) setAvatar(current.avatars[repoId] ?? null);
      })
      .catch(() => {
        // El avatar es decoración opcional: la vista ya tiene las iniciales
        // deterministas como respaldo y no necesita un panel de error propio.
        if (active) setAvatar(null);
      });

    return () => {
      active = false;
    };
  }, [library, repoId]);

  return avatar;
}
