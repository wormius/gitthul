import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { createMockKeyringPort } from '@core/adapters/mock/mockKeyringPort';
import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import type { RemoteCredentialAccount } from '@core/domain/settings';
import { I18nContext, type I18nContextValue } from '@i18n/I18nContext';
import { interpolate } from '@i18n/format';
import { esMX } from '@i18n/messages/es-MX';

import { CredentialAccounts } from './CredentialAccounts';

function i18n(): I18nContextValue {
  return {
    locale: 'es-MX',
    setLocale: () => undefined,
    t: (key, params) => interpolate(esMX[key], params),
  };
}

function renderAccounts(ports: AppPorts) {
  function Harness() {
    const [accounts, setAccounts] = useState<readonly RemoteCredentialAccount[]>([]);
    return <CredentialAccounts accounts={accounts} onUpdate={setAccounts} />;
  }

  return render(
    <I18nContext.Provider value={i18n()}>
      <PortsContext.Provider value={ports}>
        <Harness />
      </PortsContext.Provider>
    </I18nContext.Provider>,
  );
}

describe('CredentialAccounts', () => {
  it('añade, edita sin rehidratar el secreto y borra con confirmación', async () => {
    const user = userEvent.setup();
    const keyring = createMockKeyringPort();
    renderAccounts({ ...selectPorts(), keyring });

    const add = await screen.findByRole('button', { name: 'Agregar cuenta' });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await user.type(screen.getByLabelText('Nombre de la cuenta'), 'Trabajo');
    await user.type(screen.getByLabelText('Servicio o host'), 'github.com');
    await user.type(screen.getByLabelText('Usuario'), 'alex-work');
    await user.type(screen.getByLabelText('Regla de remoto o repositorio (opcional)'), 'empresa/*');
    await user.type(screen.getByLabelText('Token o contraseña'), 'token-secreto');
    await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));

    expect(await screen.findByRole('group', { name: 'Trabajo' })).toBeInTheDocument();
    expect([...keyring.entries.values()]).toEqual(['token-secreto']);

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('Token o contraseña')).toHaveValue('');
    await user.clear(screen.getByLabelText('Nombre de la cuenta'));
    await user.type(screen.getByLabelText('Nombre de la cuenta'), 'Trabajo principal');
    await user.click(screen.getByRole('button', { name: 'Guardar cuenta' }));

    expect(await screen.findByRole('group', { name: 'Trabajo principal' })).toBeInTheDocument();
    expect([...keyring.entries.values()]).toEqual(['token-secreto']);

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(screen.getByRole('dialog', { name: 'Eliminar Trabajo principal' })).toHaveTextContent(
      'Esta acción no se puede deshacer',
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Trabajo principal' })).not.toBeInTheDocument(),
    );
    expect(keyring.entries.size).toBe(0);
  });

  it('explica que Git conserva helpers y SSH cuando el llavero no está disponible', async () => {
    renderAccounts({
      ...selectPorts(),
      keyring: createMockKeyringPort({ available: false }),
    });

    expect(
      await screen.findByText(/Git todavía puede usar credential\.helper y SSH/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Agregar cuenta' })).toBeDisabled();
  });
});
