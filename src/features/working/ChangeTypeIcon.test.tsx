import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '@i18n/I18nProvider';

import { ChangeTypeIcon } from './ChangeTypeIcon';

describe('ChangeTypeIcon', () => {
  it('usa un pictograma y conserva el nombre accesible del cambio', () => {
    const { container } = render(
      <I18nProvider initialLocale="es-MX">
        <ChangeTypeIcon change="added" />
      </I18nProvider>,
    );

    expect(screen.getByRole('img', { name: 'Agregado' })).toBeVisible();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('A');
  });
});
