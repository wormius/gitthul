import type { CommitProfile } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { Button } from '@ui/Button';

import styles from './ProfileCard.module.css';

interface ProfileCardProps {
  profile: CommitProfile;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

/** Tarjeta de un perfil de commit con avatar, nombre, correo y acciones. */
export function ProfileCard({ profile, onEdit, onDelete, disabled }: ProfileCardProps) {
  const { t } = useI18n();

  return (
    <div className={styles.card} role="group" aria-label={profile.name || profile.email}>
      <div className={styles.header}>
        <div className={styles.identity}>
          <Avatar
            name={profile.name || '?'}
            email={profile.email}
            size="md"
            {...(profile.avatarGlyph
              ? { glyph: profile.avatarGlyph, tone: profile.avatarTone }
              : {})}
          />
          <div className={styles.info}>
            <div className={styles.name}>{profile.name}</div>
            <div className={styles.email}>{profile.email}</div>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={onEdit} disabled={disabled}>
          {t('settings.git.profile.edit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={disabled}>
          {t('settings.git.profile.delete')}
        </Button>
      </div>
    </div>
  );
}
