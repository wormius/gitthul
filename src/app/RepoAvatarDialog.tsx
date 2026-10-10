import { useState } from 'react';

import type { RepoSummary } from '@core/domain/repository';
import type { RepoAvatar } from '@core/domain/library';
import { useI18n } from '@i18n/useI18n';
import { AvatarPicker } from '@ui/AvatarPicker';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';

interface RepoAvatarDialogProps {
  repo: RepoSummary;
  /** Lo que ya tenía elegido, o `null` si iba con sus iniciales. */
  current: RepoAvatar | null;
  /** `null` devuelve el repositorio al avatar automático. */
  onConfirm: (avatar: RepoAvatar | null) => void;
  onCancel: () => void;
}

/** La elección es un borrador hasta que se confirma el diálogo. */
export function RepoAvatarDialog({ repo, current, onConfirm, onCancel }: RepoAvatarDialogProps) {
  const { t } = useI18n();
  const [glyph, setGlyph] = useState<string | null>(current?.glyph ?? null);
  const [tone, setTone] = useState(current?.tone ?? 1);
  const [color, setColor] = useState<string | null>(current?.color ?? null);

  const chosen: RepoAvatar | null =
    glyph === null ? null : { glyph, tone, ...(color === null ? {} : { color }) };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="md"
      title={t('repositories.avatar.title', { repo: repo.name })}
      closeLabel={t('repositories.avatar.close', { repo: repo.name })}
      footer={
        <>
          <Button onClick={onCancel}>{t('repositories.avatar.cancel')}</Button>
          <Button variant="primary" onClick={() => onConfirm(chosen)}>
            {t('repositories.avatar.confirm')}
          </Button>
        </>
      }
    >
      <AvatarPicker
        name={repo.name}
        seed={repo.id}
        glyph={glyph}
        tone={tone}
        color={color}
        onGlyphChange={setGlyph}
        onToneChange={setTone}
        onColorChange={setColor}
      />
    </Dialog>
  );
}
