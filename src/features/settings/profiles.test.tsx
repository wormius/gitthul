import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import type { CommitProfile } from '@core/domain/settings';
import { createMockSettingsPort } from '@core/adapters/mock/mockSettingsPort';
import { memoryStorage } from '@core/adapters/mock/storage';
import { I18nProvider } from '@i18n/I18nProvider';
import { ProfileList } from './ProfileList';

it('persists a complete profile and avatar across a new settings adapter', async () => {
  const storage = memoryStorage();
  const first = createMockSettingsPort({ storage });
  const profile: CommitProfile = {
    id: 'personal',
    name: 'Personal',
    email: 'personal@example.test',
    avatarGlyph: 'cactus',
    avatarTone: 3,
  };
  await first.patch({ git: { profiles: [profile] } });
  const second = createMockSettingsPort({ storage });
  expect((await second.read()).git.profiles).toEqual([profile]);
});

describe('profile creation', () => {
  it('saves only name, email and avatar, without inserting an empty draft', async () => {
    let persisted: readonly CommitProfile[] = [];
    function Harness() {
      const [profiles, setProfiles] = useState<readonly CommitProfile[]>([]);
      return (
        <ProfileList
          profiles={profiles}
          onUpdate={(profiles) => {
            persisted = profiles;
            setProfiles(profiles);
            return Promise.resolve();
          }}
        />
      );
    }
    render(
      <I18nProvider initialLocale="es-MX">
        <Harness />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Agregar perfil' }));
    expect(persisted).toHaveLength(0);
    expect(screen.queryByLabelText('Patrón de remoto')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Firma (GPG/SSH)')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre'), 'My name');
    await user.type(screen.getByLabelText('Correo'), 'my@example.test');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(persisted).toHaveLength(1));
    expect(persisted[0]).toMatchObject({ name: 'My name', email: 'my@example.test' });
    expect(persisted[0]).not.toHaveProperty('remotePattern');
    expect(persisted[0]).not.toHaveProperty('signingKey');
  });

  it('creates and edits expanded catalog avatars without losing them while changing tabs', async () => {
    let persisted: readonly CommitProfile[] = [];
    function Harness() {
      const [profiles, setProfiles] = useState<readonly CommitProfile[]>([]);
      return (
        <ProfileList
          profiles={profiles}
          onUpdate={(nextProfiles) => {
            persisted = nextProfiles;
            setProfiles(nextProfiles);
            return Promise.resolve();
          }}
        />
      );
    }
    render(
      <I18nProvider initialLocale="es-MX">
        <Harness />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Agregar perfil' }));
    await user.type(screen.getByLabelText('Nombre'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Correo'), 'ada@example.test');
    await user.click(screen.getByRole('button', { name: /Elegir avatar/ }));
    expect(screen.queryByLabelText('Color personalizado')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Plantas' }));
    await user.click(screen.getByRole('button', { name: 'Cactus' }));
    await user.click(screen.getByRole('button', { name: 'Color 7' }));
    await user.click(screen.getByRole('tab', { name: 'Festividades' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(persisted[0]).toMatchObject({
        name: 'Ada Lovelace',
        email: 'ada@example.test',
        avatarGlyph: 'cactus',
        avatarTone: 7,
      }),
    );
    const profileId = persisted[0]?.id;

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: /Elegir avatar/ }));
    expect(screen.getByRole('tab', { name: 'Plantas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Cactus' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Color 7' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('tab', { name: 'Animales' }));
    await user.click(screen.getByRole('button', { name: 'Ballena' }));
    await user.click(screen.getByRole('button', { name: 'Color 13' }));
    await user.click(screen.getByRole('tab', { name: 'Abstractos' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(persisted).toEqual([
        {
          id: profileId,
          name: 'Ada Lovelace',
          email: 'ada@example.test',
          avatarGlyph: 'whale',
          avatarTone: 13,
        },
      ]),
    );
  });
});
