import { useId, useState, type ReactNode } from 'react';

import styles from './CollapsibleRail.module.css';
import { ContextMenu } from './ContextMenu';
import { Counter } from './Counter';
import { IconButton } from './IconButton';
import type { MenuEntry } from './menu';
import { Popover } from './Popover';

export interface RailSection {
  key: string;
  /** Encabezado del bloque desplegado y etiqueta del icono cuando está plegado. */
  label: string;
  icon: ReactNode;
  children: ReactNode;
  /** Cantidad de elementos en la sección — se muestra junto al rótulo. */
  count?: number;
  /** Si `true`, el contenido de la sección se oculta. */
  collapsed?: boolean;
  /** Alterna el estado colapsado de la sección. */
  onToggleCollapsed?: () => void;
  /** Menú contextual de la cabecera de sección. */
  menu?: readonly MenuEntry[];
  /** Rótulo accesible del menú contextual de la cabecera. */
  menuLabel?: string;
  /** Rótulo accesible del botón de plegar (p. ej. «Plegar Locales»). */
  collapseLabel?: string;
  /** Rótulo accesible del botón de desplegar (p. ej. «Desplegar Locales»). */
  expandLabel?: string;
}

interface CollapsibleRailProps {
  /** Nombre accesible del panel completo, p. ej. «Referencias de gitthul». */
  label: string;
  sections: readonly RailSection[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  collapseLabel: string;
  expandLabel: string;
  /** Contenido fijo sobre las secciones. Se oculta al plegar. */
  header?: ReactNode;
  /** Integra el control de plegado a la derecha de `header` y omite el título visible. */
  collapseControlInHeader?: boolean;
  /** Contenido visible en el rail cuando está plegado, junto a la flecha. */
  collapsedHeader?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function ChevronIcon({ pointing }: { pointing: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d={pointing === 'left' ? 'M9.5 3.5 5 8l4.5 4.5' : 'M6.5 3.5 11 8l-4.5 4.5'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TwistyIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-expanded={expanded ? '' : undefined}
    >
      <path
        d="M6 3.6 11 8l-5 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Panel que se pliega a una tira de iconos y saca su contenido en flotante.
 *
 * Plegado, cada sección conserva su icono y se abre en una capa posicionada
 * sobre el resto de la vista: la tira nunca se ensancha y nada de lo que hay al
 * lado se mueve. El despliegue va por clic y no por hover a propósito — un panel
 * que aparece solo al rozarlo con el ratón es imposible de usar con el teclado y
 * molesto con el trackpad.
 */
export function CollapsibleRail({
  label,
  sections,
  collapsed,
  onCollapsedChange,
  collapseLabel,
  expandLabel,
  header,
  collapseControlInHeader = false,
  collapsedHeader,
  footer,
  className,
}: CollapsibleRailProps) {
  const headingId = useId();
  // El ancla se toma del propio clic: un `ref` por sección se recrearía en cada
  // render y dejaría la tira reenganchando referencias sin parar.
  const [open, setOpen] = useState<{ key: string; anchor: HTMLElement } | null>(null);

  const openSection = sections.find((section) => section.key === open?.key) ?? null;

  const toggle = () => {
    setOpen(null);
    onCollapsedChange(!collapsed);
  };

  if (collapsed) {
    return (
      <div
        className={[styles.rail, styles.collapsed, className].filter(Boolean).join(' ')}
        role="toolbar"
        aria-label={label}
        aria-orientation="vertical"
      >
        {/*
          El encabezado y la flecha van en el mismo renglón — «(Avatar) ›» —, no
          uno encima del otro: plegado, esa pareja es la identidad del panel y
          leerla en dos alturas la partía en dos cosas sin relación.
        */}
        <div className={styles.collapsedTop}>
          {collapsedHeader}
          <IconButton
            icon={<ChevronIcon pointing="right" />}
            aria-label={expandLabel}
            size="sm"
            onClick={toggle}
          />
        </div>

        {sections.map((section) => (
          <IconButton
            key={section.key}
            icon={section.icon}
            aria-label={section.label}
            aria-expanded={open?.key === section.key}
            aria-haspopup="dialog"
            size="lg"
            className={open?.key === section.key ? styles.openIcon : undefined}
            onClick={(event) => {
              const anchor = event.currentTarget;

              setOpen((current) =>
                current?.key === section.key ? null : { key: section.key, anchor },
              );
            }}
          />
        ))}

        {open && openSection && (
          <Popover
            open
            anchor={open.anchor}
            onClose={() => {
              setOpen(null);
            }}
            label={openSection.label}
            side="right"
            align="start"
            className={styles.flyout}
          >
            <h3 className={styles.flyoutTitle}>{openSection.label}</h3>
            {openSection.children}
          </Popover>
        )}
      </div>
    );
  }

  return (
    <section
      className={[styles.rail, styles.expanded, className].filter(Boolean).join(' ')}
      {...(collapseControlInHeader ? { 'aria-label': label } : { 'aria-labelledby': headingId })}
    >
      {collapseControlInHeader ? (
        <div className={styles.integratedHeader}>
          <div className={styles.integratedHeaderContent}>{header}</div>
          <IconButton
            icon={<ChevronIcon pointing="left" />}
            aria-label={collapseLabel}
            onClick={toggle}
          />
        </div>
      ) : (
        <>
          <div className={styles.head}>
            <h2 className={styles.title} id={headingId}>
              {label}
            </h2>
            <IconButton
              icon={<ChevronIcon pointing="left" />}
              aria-label={collapseLabel}
              onClick={toggle}
            />
          </div>
          {header}
        </>
      )}

      <div className={styles.sections}>
        {sections.map((section) => (
          <section key={section.key} className={styles.section} aria-label={section.label}>
            {section.onToggleCollapsed !== undefined ? (
              <SectionHeader section={section} />
            ) : (
              <h3 className={styles.sectionTitle}>
                <span className={styles.sectionIcon} aria-hidden="true">
                  {section.icon}
                </span>
                {section.label}
              </h3>
            )}
            {section.collapsed !== true && section.children}
          </section>
        ))}
      </div>

      {footer}
    </section>
  );
}

/**
 * Cabecera de sección colapsable: botón con chevron, icono, rótulo y contador,
 * opcionalmente envuelto en un menú contextual. Componente interno que aísla la
 * lógica de render para no ensuciar el cuerpo principal.
 */
function SectionHeader({ section }: { section: RailSection }) {
  const ariaLabel = section.collapsed ? section.expandLabel : section.collapseLabel;

  const toggle = (
    <h3 className={styles.sectionHeading}>
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={!section.collapsed}
        aria-label={ariaLabel}
        onClick={section.onToggleCollapsed}
      >
        <TwistyIcon className={styles.twisty} expanded={!section.collapsed} />
        <span className={styles.sectionIcon} aria-hidden="true">
          {section.icon}
        </span>
        <span className={styles.sectionLabel}>{section.label}</span>
        {section.count !== undefined && <Counter value={section.count} />}
      </button>
    </h3>
  );

  if (section.menu !== undefined) {
    return (
      <ContextMenu items={section.menu} label={section.menuLabel ?? section.label}>
        {toggle}
      </ContextMenu>
    );
  }

  return toggle;
}
