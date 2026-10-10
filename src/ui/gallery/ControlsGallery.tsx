import { useState } from 'react';

import { Avatar } from '../Avatar';
import { AVATAR_CATEGORIES, AVATAR_TONES } from '../avatarGlyphs';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';
import { Badge } from '../Badge';
import { BigActionButton } from '../BigActionButton';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Chip } from '../Chip';
import { Counter } from '../Counter';
import { Divider } from '../Divider';
import { IconButton } from '../IconButton';
import { Input } from '../Input';
import { Kbd } from '../Kbd';
import { ProgressBar } from '../ProgressBar';
import { Radio } from '../Radio';
import { SearchInput } from '../SearchInput';
import { SegmentedControl } from '../SegmentedControl';
import { Select } from '../Select';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { SplitActionButton } from '../SplitActionButton';
import { Switch } from '../Switch';
import { Textarea } from '../Textarea';
import { Toolbar } from '../Toolbar';
import styles from './ControlsGallery.module.css';

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 5.5c0-.6.4-1 1-1H8l1.5 2H16c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1v-9Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const fileViewOptions = [
  { value: 'list', label: 'Lista' },
  { value: 'tree', label: 'Árbol' },
] as const;

const pullStrategyOptions = [
  { value: 'auto', label: 'Automática (rebase o merge según toque)' },
  { value: 'rebase', label: 'Siempre rebase' },
  { value: 'merge', label: 'Siempre merge' },
];

/**
 * Demo de los primitivos de F0.4. Cada grupo lleva su propia prueba de
 * comportamiento y de no-desplazamiento por hover en `src/ui/*.test.tsx`; esto
 * es solo la vitrina visual, contra los siete temas y las tres densidades.
 */
export function ControlsGallery() {
  const { t } = useI18n();
  const [checked, setChecked] = useState(true);
  const [pullStrategy, setPullStrategy] = useState('auto');
  const [switchOn, setSwitchOn] = useState(false);
  const [fileView, setFileView] = useState<'list' | 'tree'>('list');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  return (
    <div className={styles.groups}>
      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Botones</h3>
        <div className={styles.row}>
          <Button variant="primary">Fusionar</Button>
          <Button variant="secondary">Cancelar</Button>
          <Button variant="ghost">Ver detalles</Button>
          <Button variant="primary" disabled>
            Deshabilitado
          </Button>
          <IconButton icon={<FolderIcon />} aria-label="Abrir carpeta" />
          <IconButton icon={<DownloadIcon />} aria-label="Fijar en la barra" pressed />
          <BigActionButton icon={<FolderIcon />} label="Abrir" />
          <BigActionButton icon={<DownloadIcon />} label="Clonar" />
          <SplitActionButton
            label="Push"
            icon={<DownloadIcon />}
            onAction={() => undefined}
            moreLabel="Más opciones de Push"
            alternatives={[
              { key: 'force', label: 'Forzar Push de main', onSelect: () => undefined },
              { key: 'tags', label: 'Push con etiquetas', onSelect: () => undefined },
            ]}
          />
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Campos</h3>
        <div className={styles.row}>
          <div className={styles.column}>
            <Input label="Nombre de la rama" placeholder="feature/login" />
            <SearchInput
              label="Buscar ramas"
              value={search}
              onChange={setSearch}
              clearLabel="Vaciar búsqueda"
              resultsLabel={search ? '3 resultados' : undefined}
              placeholder="Buscar…"
            />
            <Textarea
              label="Detalle del commit"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              placeholder="Explica el porqué, no el qué."
              maxRows={6}
            />
            <Select
              label="Estrategia de pull"
              options={pullStrategyOptions}
              value={pullStrategy}
              onChange={(event) => {
                setPullStrategy(event.target.value);
              }}
            />
            <SegmentedControl
              label="Vista de archivos"
              value={fileView}
              onChange={setFileView}
              options={fileViewOptions}
            />
            {/* El mismo mando sin rótulos, que es como cabe en una barra
                estrecha: el nombre de cada casilla pasa a `aria-label`. */}
            <SegmentedControl
              label="Vista de archivos, solo iconos"
              hideLabels
              value={fileView}
              onChange={setFileView}
              options={fileViewOptions.map((option) => ({
                ...option,
                icon: option.value === 'tree' ? <FolderIcon /> : <DownloadIcon />,
              }))}
            />
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Selección</h3>
        <div className={styles.row}>
          <div className={styles.stack}>
            <Checkbox
              label="Ver archivos ignorados"
              checked={checked}
              onChange={(event) => {
                setChecked(event.target.checked);
              }}
            />
            <Checkbox label="Deshabilitado" disabled />
          </div>
          <div className={styles.stack}>
            <Radio label="Rebase" name="pull-gallery" value="rebase" defaultChecked />
            <Radio label="Merge" name="pull-gallery" value="merge" />
          </div>
          <Switch
            label="Traer avatares de GitHub"
            checked={switchOn}
            onChange={(event) => {
              setSwitchOn(event.target.checked);
            }}
          />
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Etiquetas</h3>
        <div className={styles.row}>
          <Badge variant="success">Sin conflictos</Badge>
          <Badge variant="warning">3 sin publicar</Badge>
          <Badge variant="danger">Push rechazado</Badge>
          <Badge variant="info">Rebase en curso</Badge>
          <Badge variant="accent">main</Badge>
          <Chip onSelect={() => undefined} selected>
            main
          </Chip>
          <Chip onRemove={() => undefined} removeLabel="Quitar filtro de autor">
            Autor: Ada Lovelace
          </Chip>
          <Counter value={12} />
          <Counter value={3} prefix="+" />
          <span>
            <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd>
          </span>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Estado y progreso</h3>
        <div className={styles.row}>
          <Spinner label="Cargando" />
          <Spinner size="lg" label="Clonando repositorio" />
          <div className={styles.column}>
            <ProgressBar label="Clonando repositorio" value={64} />
            <ProgressBar label="Calculando el grafo" />
          </div>
          <div className={styles.column}>
            <Skeleton variant="text" />
            <Skeleton variant="block" />
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Avatar, separador y barra</h3>
        <div className={styles.row}>
          <Avatar name="Ada Lovelace" email="ada@example.test" size="xs" />
          <Avatar name="Ada Lovelace" email="ada@example.test" size="sm" />
          <Avatar name="Grace Hopper" email="grace@example.test" size="md" />
          <Avatar name="Margaret Hamilton" email="margaret@example.test" size="lg" />
          <Divider orientation="vertical" />
          <Toolbar label="Acciones de GitWorking">
            <IconButton icon={<DownloadIcon />} aria-label="Fetch" />
            <IconButton icon={<DownloadIcon />} aria-label="Pull" />
            <Divider orientation="vertical" />
            <IconButton icon={<CloseIcon />} aria-label="Descartar" />
          </Toolbar>
        </div>
      </div>

      {/* Comparar cada dibujo a tamaño de tarjeta y de fila en todos los temas. */}
      {AVATAR_CATEGORIES.map((category) => (
        <div key={category.id} className={styles.group}>
          <h3 className={styles.groupTitle}>{t(`avatar.category.${category.id}` as MessageKey)}</h3>
          <div className={styles.row}>
            {category.glyphs.map((glyph, index) => (
              <div key={glyph.id} className={styles.stack}>
                <span className={styles.avatarSizes}>
                  {(['lg', 'sm', 'xs'] as const).map((size) => (
                    <Avatar
                      key={size}
                      name={t(`avatar.glyph.${glyph.id}` as MessageKey)}
                      glyph={glyph.id}
                      tone={(index % AVATAR_TONES) + 1}
                      size={size}
                    />
                  ))}
                </span>
                <span>{t(`avatar.glyph.${glyph.id}` as MessageKey)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
