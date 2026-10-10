import { useI18n } from '@i18n/useI18n';
import { Heatmap } from '@ui/Heatmap';
import type { HeatmapCell, HeatmapDay } from '@ui/heatmap';

import styles from './ActivityHeatmap.module.css';

interface ActivityHeatmapProps {
  days: readonly HeatmapDay[];
  /** Nombre accesible del conjunto, ya redactado por quien lo consume. */
  label: string;
  /** La frase del total, ya redactada: el heatmap no sabe qué está contando. */
  total: string;
  /** Último día representado, en ISO. Sin él, el más reciente de los datos. */
  end?: string;
  /** Qué dice un día al posar el puntero. También lo redacta quien consume. */
  describeDay: (cell: HeatmapCell) => string;
  weeks?: number;
}

/**
 * El mapa de calor de la vista, sobre el primitivo `Heatmap`.
 *
 * Sirve a los dos usos de Repositorios —los commits de un repositorio y los días
 * de uso de la aplicación— porque lo único que cambia entre ellos es qué se
 * cuenta, y eso lo dicen los días y las frases que le pasan. Lo que añade sobre
 * el primitivo es la leyenda y el total del periodo, que es lo que impide leer
 * un relieve sin escala: los escalones son proporcionales al máximo observado,
 * así que sin la cifra un repositorio de tres commits al día se ve igual de
 * encendido que uno de cuarenta.
 */
export function ActivityHeatmap({
  days,
  label,
  total,
  end,
  describeDay,
  weeks,
}: ActivityHeatmapProps) {
  const { t } = useI18n();

  return (
    <div className={styles.activity}>
      <Heatmap
        days={days}
        label={label}
        describeDay={describeDay}
        legend={{
          lessLabel: t('repositories.heatmap.less'),
          moreLabel: t('repositories.heatmap.more'),
        }}
        {...(end === undefined ? {} : { end })}
        {...(weeks === undefined ? {} : { weeks })}
      />
      <p className={styles.total}>{total}</p>
    </div>
  );
}
