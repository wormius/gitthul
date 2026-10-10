import { Fragment, useEffect, useRef } from 'react';

import { GRAPH_BRANCH_COUNT, graphBranchTokens } from '@design/tokenCatalog';
import { useCssTokens } from '@design/useCssTokens';

import styles from './GraphBranchSpecimen.module.css';

const BRANCHES = Array.from({ length: GRAPH_BRANCH_COUNT }, (_, index) => index + 1);

const TOKENS = [
  ...BRANCHES.flatMap((branch) => {
    const { color, dash, shape } = graphBranchTokens(branch);

    return [color, dash, shape];
  }),
  '--graph-line-width',
  '--graph-node-radius',
  '--surface-panel',
];

function dashPattern(value: string): number[] {
  if (!value || value === 'none') return [];

  return value.split(/\s+/).map(Number).filter(Number.isFinite);
}

function drawNode(
  context: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  radius: number,
  color: string,
  hole: string,
) {
  context.fillStyle = color;
  context.strokeStyle = color;

  if (shape === 'square' || shape === 'diamond') {
    const half = radius;

    context.save();
    context.translate(x, y);
    if (shape === 'diamond') context.rotate(Math.PI / 4);
    context.fillRect(-half, -half, half * 2, half * 2);
    context.restore();

    return;
  }

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();

  // El anillo es el motivo del logotipo: el hueco se pinta con el fondo del panel.
  if (shape !== 'ring-filled') {
    context.beginPath();
    context.arc(x, y, Math.max(1, radius - Math.max(1.5, radius * 0.45)), 0, Math.PI * 2);
    context.fillStyle = hole;
    context.fill();
  }
}

/**
 * Las ocho ramas con sus tres portadores de significado: color, trazo y forma.
 *
 * En los cinco temas normales el trazo es continuo y el nodo un anillo, así que
 * solo se ve el color. En «Contraste» aparecen los otros dos, y por eso este
 * espécimen es la comprobación de que las ramas siguen distinguiéndose en escala
 * de grises, que es lo que el plan exige.
 */
export function GraphBranchSpecimen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tokens = useCssTokens(TOKENS);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const canvases = container.querySelectorAll('canvas');
    const ratio = window.devicePixelRatio || 1;
    const lineWidth = Number.parseFloat(tokens['--graph-line-width'] ?? '2') || 2;
    const nodeRadius = Number.parseFloat(tokens['--graph-node-radius'] ?? '5') || 5;
    const hole = tokens['--surface-panel'] ?? '';

    canvases.forEach((canvas, index) => {
      const context = canvas.getContext('2d');

      if (!context) return;

      const { width, height } = canvas.getBoundingClientRect();

      if (width === 0 || height === 0) return;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const branch = graphBranchTokens(index + 1);
      const color = tokens[branch.color] ?? '';
      const middle = height / 2;

      context.lineWidth = lineWidth;
      context.strokeStyle = color;
      context.setLineDash(dashPattern(tokens[branch.dash] ?? 'none'));
      context.beginPath();
      context.moveTo(0, middle);
      context.lineTo(width, middle);
      context.stroke();

      context.setLineDash([]);
      drawNode(context, tokens[branch.shape] ?? 'ring', width / 2, middle, nodeRadius, color, hole);
    });
  }, [tokens]);

  return (
    <div className={styles.specimen} ref={containerRef}>
      {BRANCHES.map((branch) => {
        const { dash, shape } = graphBranchTokens(branch);

        return (
          <Fragment key={branch}>
            <span className={styles.label}>
              rama {branch} · {tokens[shape] || 'ring'} · {tokens[dash] || 'none'}
            </span>
            <canvas className={styles.lane} role="img" aria-label={`Rama ${String(branch)}`} />
          </Fragment>
        );
      })}
    </div>
  );
}
