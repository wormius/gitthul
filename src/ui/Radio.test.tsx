import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Radio } from './Radio';

describe('Radio', () => {
  it('permite elegir una sola opción del grupo', async () => {
    const user = userEvent.setup();

    render(
      <>
        <Radio label="Rebase" name="pull-strategy" value="rebase" defaultChecked />
        <Radio label="Merge" name="pull-strategy" value="merge" />
      </>,
    );

    expect(screen.getByRole('radio', { name: 'Rebase' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Merge' }));

    expect(screen.getByRole('radio', { name: 'Merge' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Rebase' })).not.toBeChecked();
  });

  it('el hover no desplaza la caja', () => {
    render(<Radio label="Rebase" name="pull-strategy" value="rebase" />);

    expectNoHoverShift(screen.getByRole('radio', { name: 'Rebase' }));
  });
});
