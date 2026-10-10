import { useState } from 'react';

import { DragLayer } from '../DragLayer';
import { useDragSource, useDropTarget, type DropVerdict } from '../dragLayerUtils';
import styles from './DragGallery.module.css';

/**
 * Referencia de mentira: lo justo para que la demo tenga dos clases de carga.
 *
 * El primitivo no sabe qué es esto —recibe `unknown` y lo devuelve tal cual—, así
 * que quien lo pone es quien lo reconoce. Aquí, con `isRef`; en GitWorking, con
 * el guardián que le corresponda a su unión de rama y tag.
 */
interface DemoRef {
  kind: 'branch' | 'tag';
  name: string;
}

const REFS: readonly DemoRef[] = [
  { kind: 'branch', name: 'main' },
  { kind: 'branch', name: 'dev' },
  { kind: 'tag', name: 'v0.1.0' },
];

function isRef(payload: unknown): payload is DemoRef {
  return typeof payload === 'object' && payload !== null && 'kind' in payload;
}

function describe(ref: DemoRef): string {
  return ref.kind === 'branch' ? `rama ${ref.name}` : `tag ${ref.name}`;
}

function DragRef({ item }: { item: DemoRef }) {
  const drag = useDragSource({ payload: item, text: item.name, className: styles.ref });

  return (
    <span {...drag} data-kind={item.kind}>
      {item.name}
    </span>
  );
}

function DropSlot({
  label,
  hint,
  accepts,
  onDrop,
}: {
  label: string;
  hint: string;
  accepts: (ref: DemoRef) => DropVerdict | null;
  onDrop: (ref: DemoRef) => void;
}) {
  const drop = useDropTarget({
    accepts: (payload) => (isRef(payload) ? accepts(payload) : null),
    onDrop: (payload) => {
      if (isRef(payload)) onDrop(payload);
    },
    className: styles.slot,
  });

  return (
    <div {...drop}>
      <span className={styles.slotLabel}>{label}</span>
      <span className={styles.slotHint}>{hint}</span>
    </div>
  );
}

/**
 * Demo de `DragLayer`, y la que verifica lo que promete F0.12.
 *
 * Reproduce los dos consumidores que dimensionan el primitivo sin traerse una
 * línea de git: referencia contra referencia —la etiqueta del grafo— y
 * referencia contra la cabecera de Worktrees. Los cuatro casos están a la vista:
 * un destino que acepta, uno que acepta según lo que viaja, uno que rechaza y
 * uno que no es destino de nada. El origen se queda fantasmal en su hueco desde
 * el primer `dragover`, nunca antes, y lo que viaja con el puntero es una copia.
 */
export function DragGallery() {
  const [last, setLast] = useState<string | null>(null);

  const drop = (target: string) => (ref: DemoRef) => {
    setLast(`Se soltó ${describe(ref)} sobre ${target}`);
  };

  return (
    <DragLayer>
      <div className={styles.stage}>
        <div className={styles.column}>
          <h3 className={styles.columnTitle}>
            Se arrastran
            <span className={styles.hint}>ramas y tags; los commits nunca</span>
          </h3>
          <div className={styles.refs}>
            {REFS.map((item) => (
              <DragRef key={item.name} item={item} />
            ))}
          </div>
        </div>

        <div className={styles.column}>
          <h3 className={styles.columnTitle}>
            Se sueltan sobre
            <span className={styles.hint}>
              el válido se anuncia al empezar; el inválido, al apuntarlo
            </span>
          </h3>

          <DropSlot
            label="main"
            hint="etiqueta del grafo · vista previa de integración"
            accepts={(ref) => (ref.name === 'main' ? 'invalid' : 'valid')}
            onDrop={drop('la rama main')}
          />
          <DropSlot
            label="v0.1.0"
            hint="etiqueta de tag · solo comparar"
            accepts={() => 'valid'}
            onDrop={drop('el tag v0.1.0')}
          />
          <DropSlot
            label="Worktrees"
            hint="cabecera · solo ramas"
            accepts={(ref) => (ref.kind === 'branch' ? 'valid' : 'invalid')}
            onDrop={drop('la cabecera de Worktrees')}
          />
          <DropSlot
            label="Fondo del grafo"
            hint="no es destino de nada: ni se resalta ni recibe"
            accepts={() => null}
            onDrop={drop('el fondo del grafo')}
          />
        </div>
      </div>

      {/* Siempre en pantalla, con o sin mensaje: si apareciera al soltar,
          empujaría hacia abajo todo lo que viene después. */}
      <p className={styles.result} data-empty={last === null ? '' : undefined}>
        {last ?? 'Arrastra una de las tres sobre cualquiera de los cuatro destinos'}
      </p>
    </DragLayer>
  );
}
