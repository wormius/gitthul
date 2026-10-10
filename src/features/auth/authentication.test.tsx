import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import type { AuthChallenge } from '@core/ports/AuthPort';
import { I18nProvider } from '@i18n/I18nProvider';
import { AuthenticationDialog } from './AuthenticationDialogs';
import { RemoteAccessPanel } from './RemoteAccessPanel';

const challenge: AuthChallenge = {
  id: 'request',
  operationId: 'push',
  repository: '/repo/one',
  url: 'https://github.com/private/repo.git',
  kind: 'https',
  prompt: '',
  username: '',
};
function setup(request = challenge, available = true) {
  const ports = selectPorts();
  const answer = vi.spyOn(ports.auth, 'answer');
  vi.spyOn(ports.keyring, 'isAvailable').mockResolvedValue(available);
  const done = vi.fn();
  render(
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <AuthenticationDialog request={request} onDone={done} />
      </I18nProvider>
    </PortsContext>,
  );
  return { ports, answer, done };
}

describe('authentication at the operation', () => {
  it('submits one-operation credentials by default and can remember for this repository', async () => {
    const user = userEvent.setup();
    const { answer } = setup();
    await user.type(screen.getByLabelText('Usuario'), 'my-user');
    await user.type(screen.getByLabelText('Token o contraseña'), 'test-token');
    expect(screen.getByLabelText('Recordar para este repositorio')).not.toBeChecked();
    await user.click(screen.getByLabelText('Recordar para este repositorio'));
    await user.click(screen.getByRole('button', { name: 'Continuar operación' }));
    expect(answer).toHaveBeenCalledWith('request', {
      username: 'my-user',
      secret: 'test-token',
      remember: true,
    });
  });
  it('cancels without submitting or storing a secret', async () => {
    const { answer, ports } = setup();
    const save = vi.spyOn(ports.auth, 'saveAccess');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('request', null));
    expect(save).not.toHaveBeenCalled();
  });
  it('continues without persistence when no system keyring is available', async () => {
    const user = userEvent.setup();
    const { answer } = setup(challenge, false);
    await waitFor(() =>
      expect(screen.getByLabelText('Recordar para este repositorio')).toBeDisabled(),
    );
    await user.type(screen.getByLabelText('Usuario'), 'my-user');
    await user.type(screen.getByLabelText('Token o contraseña'), 'ephemeral-token');
    await user.click(screen.getByRole('button', { name: 'Continuar operación' }));
    expect(answer).toHaveBeenCalledWith('request', {
      username: 'my-user',
      secret: 'ephemeral-token',
      remember: false,
    });
  });
  it('requests an explicit HTTPS change instead of treating an SSH remote as username/token', async () => {
    const user = userEvent.setup();
    const { answer } = setup({ ...challenge, kind: 'ssh', url: 'git@github.com:private/repo.git' });
    expect(screen.queryByLabelText('Token o contraseña')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Cambiar este remoto a HTTPS'));
    await user.type(
      screen.getByLabelText('URL HTTPS del remoto'),
      'https://github.com/private/repo.git',
    );
    await user.click(screen.getByRole('button', { name: 'Continuar operación' }));
    expect(answer).toHaveBeenCalledWith('request', {
      username: '',
      secret: 'https://github.com/private/repo.git',
      remember: false,
    });
  });
  it('never accepts a new SSH host without an explicit trust action', async () => {
    const { answer } = setup({
      ...challenge,
      kind: 'host',
      prompt: 'Server fingerprint: test fingerprint',
    });
    expect(screen.getByText('Server fingerprint: test fingerprint')).toBeVisible();
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confiar en este servidor' }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledWith('request', {
        username: '',
        secret: 'yes',
        remember: false,
      }),
    );
  });
});

describe('explicit repository access', () => {
  it('sets and forgets credentials for the displayed repository and URL only', async () => {
    const user = userEvent.setup();
    const ports = selectPorts();
    const save = vi.spyOn(ports.auth, 'saveAccess');
    const forget = vi.spyOn(ports.auth, 'forgetAccess');
    render(
      <PortsContext value={ports}>
        <I18nProvider initialLocale="es-MX">
          <RemoteAccessPanel repoId="repo-one" url={challenge.url} />
        </I18nProvider>
      </PortsContext>,
    );
    const method = await screen.findByLabelText('Método de acceso');
    await user.selectOptions(method, 'https');
    await user.type(screen.getByLabelText('Usuario'), 'personal');
    await user.type(screen.getByLabelText('Token o contraseña'), 'scoped-token');
    await user.click(screen.getByRole('button', { name: 'Guardar acceso para este repositorio' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'repo-one',
        { url: challenge.url, method: 'https', username: 'personal', keyId: '' },
        'scoped-token',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Olvidar acceso de GitThul' }));
    await waitFor(() => expect(forget).toHaveBeenCalledWith('repo-one', challenge.url));
    expect((await ports.auth.readAccess('repo-two', challenge.url)).method).toBe('system');
  });
});
