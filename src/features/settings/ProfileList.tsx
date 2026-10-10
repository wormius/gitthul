import { useState } from 'react';

import type { CommitProfile, GitSettings } from '@core/domain/settings';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { AvatarPicker } from '@ui/AvatarPicker';
import { Button } from '@ui/Button';
import { Input } from '@ui/Input';

import { ProfileCard } from './ProfileCard';
import styles from './ProfileList.module.css';

interface ProfileListProps {
  profiles: readonly CommitProfile[];
  onUpdate: (profiles: readonly CommitProfile[]) => Promise<void>;
  startAdding?: boolean;
}

function nextProfileId(): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `profile-${suffix}`;
}

/** El tono con el que se estrena la elección cuando no había ninguna. */
const FIRST_TONE = 1;

/** Lista CRUD de perfiles de commit con botón de añadir y selector de avatar. */
export function ProfileList({ profiles, onUpdate, startAdding = false }: ProfileListProps) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(startAdding ? 'new' : null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editGlyph, setEditGlyph] = useState<string | null>(null);
  const [editTone, setEditTone] = useState(FIRST_TONE);
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleAdd() {
    setEditingId('new');
    setEditName('');
    setEditEmail('');
    setEditGlyph(null);
    setEditTone(FIRST_TONE);
    setPickerOpen(false);
  }

  async function handleDelete(id: string) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onUpdate(profiles.filter((p) => p.id !== id));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function handleEditStart(profile: CommitProfile) {
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditEmail(profile.email);
    setEditGlyph(profile.avatarGlyph || null);
    setEditTone(profile.avatarTone || FIRST_TONE);
    setPickerOpen(false);
  }

  async function handleEditSave() {
    if (editingId === null || !editName.trim() || !editEmail.trim() || busy) return;
    const profile: CommitProfile = {
      id: editingId === 'new' ? nextProfileId() : editingId,
      name: editName.trim(),
      email: editEmail.trim(),
      avatarGlyph: editGlyph ?? '',
      avatarTone: editGlyph === null ? 0 : editTone,
    };
    setBusy(true);
    setFailed(false);
    try {
      await onUpdate(
        editingId === 'new'
          ? [...profiles, profile]
          : profiles.map((p) => (p.id === editingId ? profile : p)),
      );
      setEditingId(null);
      setPickerOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const visibleProfiles =
    editingId === 'new'
      ? [...profiles, { id: 'new', name: '', email: '', avatarGlyph: '', avatarTone: 0 }]
      : profiles;

  return (
    <div className={styles.list}>
      {visibleProfiles.map((profile) =>
        editingId === profile.id ? (
          <div
            key={profile.id}
            className={styles.editForm}
            role="group"
            aria-label={t('settings.git.profile.editing')}
          >
            <div className={styles.editFields}>
              <Input
                label={t('settings.git.profile.name')}
                value={editName}
                disabled={busy}
                onChange={(e) => {
                  setEditName(e.target.value);
                }}
              />
              <Input
                label={t('settings.git.profile.email')}
                value={editEmail}
                disabled={busy}
                onChange={(e) => {
                  setEditEmail(e.target.value);
                }}
              />
              {/* Selección de avatar */}
              <div className={styles.avatarField}>
                <span className={styles.avatarFieldLabel}>{t('settings.git.profile.avatar')}</span>
                <button
                  type="button"
                  className={styles.avatarToggle}
                  disabled={busy}
                  onClick={() => {
                    setPickerOpen(!pickerOpen);
                  }}
                  aria-expanded={pickerOpen}
                >
                  <Avatar
                    name={editName || '?'}
                    email={editEmail}
                    size="sm"
                    {...(editGlyph === null ? {} : { glyph: editGlyph, tone: editTone })}
                  />
                  {t('settings.git.profile.chooseAvatar')}
                </button>

                {pickerOpen && (
                  <div className={styles.avatarPicker}>
                    <AvatarPicker
                      name={editName || '?'}
                      seed={editEmail}
                      glyph={editGlyph}
                      tone={editTone}
                      onGlyphChange={setEditGlyph}
                      onToneChange={setEditTone}
                      disabled={busy}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className={styles.editActions}>
              <Button
                size="sm"
                disabled={busy || !editName.trim() || !editEmail.trim()}
                onClick={() => {
                  void handleEditSave();
                }}
              >
                {t('settings.git.profile.save')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setEditingId(null)}>
                {t('settings.git.credentials.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <ProfileCard
            key={profile.id}
            profile={profile}
            disabled={busy}
            onEdit={() => {
              handleEditStart(profile);
            }}
            onDelete={() => {
              void handleDelete(profile.id);
            }}
          />
        ),
      )}
      {failed && <p role="alert">{t('settings.profiles.saveError')}</p>}
      <Button
        disabled={busy}
        variant="secondary"
        size="sm"
        className={styles.addButton}
        onClick={handleAdd}
      >
        {t('settings.git.profile.add')}
      </Button>
    </div>
  );
}

// Se exporta el tipo para que GitSection lea los perfiles desde el dominio.
export type { GitSettings };
