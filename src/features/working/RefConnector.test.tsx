import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { GraphColumn } from './CommitGraph';
import { RefConnector } from './RefConnector';

describe('RefConnector', () => {
  it('adelgaza solo el tramo horizontal de la referencia', () => {
    const column = {
      layout: {
        rowCount: 1,
        laneCount: 1,
        nodeAt: () => ({ lane: 0, kind: 'commit' as const, color: 1 }),
        passesAt: () => [],
        linksAt: () => [],
      },
      palette: {
        branches: [{ color: 'currentColor', dash: [], shape: 'ring' }],
        wip: 'currentColor',
        stash: 'currentColor',
        wipNode: 'currentColor',
        avatarInk: 'currentColor',
        avatarFont: 'sans-serif',
      },
      metrics: {
        rowHeight: 28,
        laneWidth: 12,
        lineWidth: 2,
        nodeRadius: 4,
        avatarSize: 14,
        cornerRadius: 5,
      },
      width: 24,
      form: 'dot' as const,
    } satisfies GraphColumn;
    const { container } = render(<RefConnector column={column} row={0} />);

    expect(container.querySelector('line')).toHaveAttribute('stroke-width', '1');
    expect(column.metrics.lineWidth).toBe(2);
  });
});
