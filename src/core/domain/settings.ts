/**
 * Lo que GitThul recuerda entre arranques.
 *
 * Los catálogos de valores válidos —temas, densidades, fuentes, idiomas— viven
 * aquí y no en `src/design` ni en `src/i18n` por una razón de dirección: el
 * dominio es la capa de adentro y puede depender de nada, mientras que el
 * sistema de diseño y las traducciones dependen de él. Así `SettingsPort` se
 * escribe sin importar una sola línea de la interfaz, y el adaptador que guarda
 * en disco puede validar lo que lee sin conocer el CSS que lo consume.
 *
 * `@design/theme` y `@i18n/locales` reexportan lo que les toca, de modo que los
 * componentes siguen importando de donde siempre.
 */

/**
 * Los nombres son los del plan: son la nomenclatura del producto, no
 * traducciones. **Thul va primero porque es el principal**, el que sale de
 * fábrica y el que resuelve `auto`; el orden de esta lista es el que se ofrece.
 */
export const THEMES = [
  'thul',
  'sargazo',
  'abismo',
  'dual',
  'grimorio',
  'arcano',
  'contraste',
] as const;
export type Theme = (typeof THEMES)[number];

/** Cada variante conserva la identidad cromática del tema elegido. */
export const THEME_VARIANTS = ['classic', 'minimalist', 'dense'] as const;
export type ThemeVariant = (typeof THEME_VARIANTS)[number];

export const MODES = ['dark', 'light'] as const;
export type Mode = (typeof MODES)[number];

export const DENSITIES = ['compact', 'cozy', 'spacious'] as const;
export type Density = (typeof DENSITIES)[number];

export const UI_FONTS = [
  'space-grotesk',
  'inter',
  'ibm-plex-sans',
  'atkinson-hyperlegible',
  'source-sans-3',
] as const;
export type UiFont = (typeof UI_FONTS)[number];

export const CODE_FONTS = [
  'jetbrains-mono',
  'ibm-plex-mono',
  'fira-code',
  'cascadia-code',
] as const;
export type CodeFont = (typeof CODE_FONTS)[number];

export const TOAST_POSITIONS = ['top-start', 'top-end', 'bottom-start', 'bottom-end'] as const;
export type ToastPosition = (typeof TOAST_POSITIONS)[number];

/**
 * `es-MX` es la base: es el catálogo del que sale el tipo `MessageKey`, así que
 * cualquier clave que falte en otro idioma es un error de compilación y no una
 * cadena en blanco descubierta en producción.
 */
export const LOCALES = ['es-MX', 'es-ES', 'en', 'de', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es-MX';

export interface ThemeSettings {
  /** `auto` elige «Contraste» si el sistema pide más contraste, y Thul si no. */
  theme: Theme | 'auto';
  themeVariant: ThemeVariant;
  /** `auto` sigue a prefers-color-scheme. */
  mode: Mode | 'auto';
  density: Density;
  uiFont: UiFont;
  codeFont: CodeFont;
  /** Píxeles. Independiente de `codeFontSize` a propósito. */
  uiFontSize: number;
  codeFontSize: number;
  /** Esquina donde aparecen los avisos, siempre separada de las barras del shell. */
  toastPosition: ToastPosition;
}

/**
 * Rangos de los dos ajustes de tamaño, en píxeles, con los saltos que se
 * ofrecen como botón.
 *
 * Los predefinidos existen porque arrastrar hasta un número concreto es el gesto
 * más torpe de la sección: son las medidas que la gente elige de verdad, a un
 * clic. Van aquí y no en la vista por lo mismo que el rango — es el catálogo de
 * lo que el producto ofrece, y quien lo guarda en disco lo valida contra él.
 */
export const UI_FONT_SIZE = {
  min: 10,
  max: 20,
  step: 1,
  default: 13,
  presets: [11, 12, 13, 14, 16, 18],
} as const;

export const CODE_FONT_SIZE = {
  min: 10,
  max: 24,
  step: 1,
  default: 13,
  presets: [11, 12, 13, 14, 16, 20],
} as const;

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  theme: 'auto',
  themeVariant: 'classic',
  mode: 'auto',
  density: 'cozy',
  uiFont: 'space-grotesk',
  codeFont: 'jetbrains-mono',
  uiFontSize: UI_FONT_SIZE.default,
  codeFontSize: CODE_FONT_SIZE.default,
  toastPosition: 'top-end',
};

// --- Configuraciones de git ---

export const PULL_STRATEGIES = ['auto', 'rebase', 'merge'] as const;
export type PullStrategy = (typeof PULL_STRATEGIES)[number];

export interface CommitProfile {
  id: string;
  name: string;
  email: string;
  /** Identificador del glifo del catálogo de avatares, o vacío. */
  avatarGlyph: string;
  /** Tono de 1 a 16, o 0 para el determinista. */
  avatarTone: number;
}

/** Metadatos no sensibles de una cuenta para remotos Git. */
export interface RemoteCredentialAccount {
  /** Referencia opaca del secreto en el llavero. */
  id: string;
  /** Nombre que distingue la cuenta en la interfaz. */
  label: string;
  /** Servicio o host, por ejemplo `github.com`. */
  host: string;
  /** Usuario que Git entrega junto con el secreto. */
  username: string;
  /** Regla opcional para URL/remoto/repositorio; vacío significa selección manual. */
  remotePattern: string;
}

export interface GitSettings {
  /** Ruta al ejecutable. Vacío = buscar en PATH. */
  executablePath: string;
  /** Estrategia de pull por defecto. */
  pullStrategy: PullStrategy;
  /** Identidades reutilizables; la selección pertenece a cada repositorio. */
  profiles: readonly CommitProfile[];
  /** Metadatos heredados; se conservan para migración y no se usan para autenticar. */
  credentialAccounts: readonly RemoteCredentialAccount[];
}

// --- Configuraciones de actualizaciones ---

export interface UpdateSettings {
  checkOnStartup: boolean;
}

/** Límites de recuperación aplicados de forma independiente a cada repositorio. */
export interface RecoverySettings {
  autoCleanup: boolean;
  maxCheckpoints: number;
  maxAgeDays: number;
  maxMiB: number;
}

export const RECOVERY_LIMITS = {
  maxCheckpoints: { min: 1, max: 10000, default: 100 },
  maxAgeDays: { min: 1, max: 3650, default: 30 },
  maxMiB: { min: 1, max: 1048576, default: 1024 },
} as const;

export const DEFAULT_RECOVERY_SETTINGS: RecoverySettings = {
  autoCleanup: true,
  maxCheckpoints: RECOVERY_LIMITS.maxCheckpoints.default,
  maxAgeDays: RECOVERY_LIMITS.maxAgeDays.default,
  maxMiB: RECOVERY_LIMITS.maxMiB.default,
};

/** Espacio compartido entre los respaldos de emergencia de todos los repositorios. */
export interface BackupSettings {
  enabled: boolean;
  maxMiB: number;
}

export const BACKUP_LIMITS = { min: 1, max: 1048576, default: 1024 } as const;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  maxMiB: BACKUP_LIMITS.default,
};

// --- Ajustes completos ---

export interface Settings {
  appearance: ThemeSettings;
  /** `auto` sigue al idioma del sistema operativo. */
  locale: Locale | 'auto';
  /**
   * Repartos de panel y anchos de columna, por identificador de almacenamiento.
   * Es un mapa abierto porque cada vista bautiza los suyos y el puerto no tiene
   * por qué enterarse cuando nace uno nuevo.
   */
  panes: Readonly<Record<string, number>>;
  /**
   * Plegado de cada sección del panel de referencias de GitWorking —Locales,
   * Remotas, Tags, Guardados, Worktrees—, por su nombre. Es **global y no por
   * repositorio**: es preferencia de la persona que mira, no un dato del
   * repositorio (CU-3 de `subplan-gitworking.md`). Mismo patrón que `panes`:
   * mapa abierto, se funde clave por clave.
   */
  workingSections: Readonly<Record<string, boolean>>;
  /** Nombre opcional del WIP por repositorio. */
  workingWipNames: Readonly<Record<string, string>>;
  /** Ajustes de git: ejecutable, pull y perfiles. */
  git: GitSettings;
  /** Consulta de versiones publicadas; no descarga ni instala actualizaciones. */
  updates: UpdateSettings;
  recovery: RecoverySettings;
  backup: BackupSettings;
  logging: { debugEnabled: boolean };
}

export const DEFAULT_GIT_SETTINGS: GitSettings = {
  executablePath: '',
  pullStrategy: 'auto',
  profiles: [],
  credentialAccounts: [],
};

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  checkOnStartup: false,
};

export const DEFAULT_SETTINGS: Settings = {
  appearance: DEFAULT_THEME_SETTINGS,
  locale: 'auto',
  panes: {},
  workingSections: {},
  workingWipNames: {},
  git: DEFAULT_GIT_SETTINGS,
  updates: DEFAULT_UPDATE_SETTINGS,
  recovery: DEFAULT_RECOVERY_SETTINGS,
  backup: DEFAULT_BACKUP_SETTINGS,
  logging: { debugEnabled: false },
};

/** Un parche solo dice lo que cambia; `panes` y `workingSections` se funden clave por clave. */
export interface SettingsPatch {
  appearance?: Partial<ThemeSettings>;
  locale?: Locale | 'auto';
  panes?: Readonly<Record<string, number>>;
  workingSections?: Readonly<Record<string, boolean>>;
  workingWipNames?: Readonly<Record<string, string>>;
  git?: Partial<GitSettings>;
  updates?: Partial<UpdateSettings>;
  recovery?: Partial<RecoverySettings>;
  backup?: Partial<BackupSettings>;
  logging?: { debugEnabled?: boolean };
}

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  return {
    appearance: { ...current.appearance, ...patch.appearance },
    locale: patch.locale ?? current.locale,
    panes: patch.panes ? { ...current.panes, ...patch.panes } : current.panes,
    workingSections: patch.workingSections
      ? { ...current.workingSections, ...patch.workingSections }
      : current.workingSections,
    workingWipNames: patch.workingWipNames ?? current.workingWipNames,
    git: patch.git
      ? {
          ...current.git,
          ...patch.git,
          profiles: patch.git.profiles ?? current.git.profiles,
          credentialAccounts: patch.git.credentialAccounts ?? current.git.credentialAccounts,
        }
      : current.git,
    logging: { ...current.logging, ...patch.logging },
    updates: patch.updates ? { ...current.updates, ...patch.updates } : current.updates,
    recovery: patch.recovery ? { ...current.recovery, ...patch.recovery } : current.recovery,
    backup: patch.backup ? { ...current.backup, ...patch.backup } : current.backup,
  };
}

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function size(value: unknown, range: { min: number; max: number; default: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;

  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Convierte lo que había guardado en ajustes utilizables.
 *
 * Lo que se lee del disco es `unknown` de verdad: puede venir de una versión
 * anterior, de una edición a mano o de un archivo a medio escribir. Cada campo
 * que no encaje cae a su valor por defecto en vez de tumbar el arranque —
 * quedarse sin ventana porque alguien escribió mal el nombre de un tema sería
 * desproporcionado.
 */
export function normalizeSettings(value: unknown): Settings {
  const raw = record(value);
  const appearance = record(raw['appearance']);
  const panes: Record<string, number> = {};
  const workingSections: Record<string, boolean> = {};
  const workingWipNames: Record<string, string> = {};

  for (const [id, size] of Object.entries(record(raw['panes']))) {
    if (typeof size === 'number' && Number.isFinite(size)) panes[id] = size;
  }

  for (const [id, collapsed] of Object.entries(record(raw['workingSections']))) {
    if (typeof collapsed === 'boolean') workingSections[id] = collapsed;
  }

  for (const [id, name] of Object.entries(record(raw['workingWipNames']))) {
    if (typeof name === 'string' && name.trim() !== '') workingWipNames[id] = name.trim();
  }

  return {
    appearance: {
      theme: oneOf([...THEMES, 'auto'], appearance['theme'], DEFAULT_THEME_SETTINGS.theme),
      themeVariant: oneOf(
        THEME_VARIANTS,
        appearance['themeVariant'],
        DEFAULT_THEME_SETTINGS.themeVariant,
      ),
      mode: oneOf([...MODES, 'auto'], appearance['mode'], DEFAULT_THEME_SETTINGS.mode),
      density: oneOf(DENSITIES, appearance['density'], DEFAULT_THEME_SETTINGS.density),
      uiFont: oneOf(UI_FONTS, appearance['uiFont'], DEFAULT_THEME_SETTINGS.uiFont),
      codeFont: oneOf(CODE_FONTS, appearance['codeFont'], DEFAULT_THEME_SETTINGS.codeFont),
      uiFontSize: size(appearance['uiFontSize'], UI_FONT_SIZE),
      codeFontSize: size(appearance['codeFontSize'], CODE_FONT_SIZE),
      toastPosition: oneOf(
        TOAST_POSITIONS,
        appearance['toastPosition'],
        DEFAULT_THEME_SETTINGS.toastPosition,
      ),
    },
    locale: oneOf([...LOCALES, 'auto'], raw['locale'], DEFAULT_SETTINGS.locale),
    panes,
    workingSections,
    workingWipNames,
    git: normalizeGitSettings(raw['git']),
    updates: normalizeUpdateSettings(raw['updates']),
    recovery: normalizeRecoverySettings(raw['recovery']),
    backup: normalizeBackupSettings(raw['backup']),
    logging: { debugEnabled: record(raw['logging'])['debugEnabled'] === true },
  };
}

function normalizeGitSettings(value: unknown): GitSettings {
  const raw = record(value);

  return {
    executablePath:
      typeof raw['executablePath'] === 'string'
        ? raw['executablePath']
        : DEFAULT_GIT_SETTINGS.executablePath,
    pullStrategy: oneOf(PULL_STRATEGIES, raw['pullStrategy'], DEFAULT_GIT_SETTINGS.pullStrategy),
    profiles: normalizeProfiles(raw['profiles']),
    credentialAccounts: normalizeCredentialAccounts(raw['credentialAccounts']),
  };
}

function normalizeCredentialAccounts(value: unknown): readonly RemoteCredentialAccount[] {
  if (!Array.isArray(value)) return [];

  const result: RemoteCredentialAccount[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    const raw = record(item);
    const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
    const label = typeof raw['label'] === 'string' ? raw['label'].trim() : '';
    const host = typeof raw['host'] === 'string' ? raw['host'].trim() : '';
    const username = typeof raw['username'] === 'string' ? raw['username'].trim() : '';

    if (!id || !label || !host || !username || ids.has(id)) continue;
    ids.add(id);
    result.push({
      id,
      label,
      host,
      username,
      remotePattern: typeof raw['remotePattern'] === 'string' ? raw['remotePattern'].trim() : '',
    });
  }

  return result;
}

function normalizeProfiles(value: unknown): readonly CommitProfile[] {
  if (!Array.isArray(value)) return [];

  const result: CommitProfile[] = [];

  for (const item of value) {
    const raw = record(item);

    if (
      typeof raw['id'] !== 'string' ||
      typeof raw['name'] !== 'string' ||
      !raw['name'].trim() ||
      typeof raw['email'] !== 'string' ||
      !raw['email'].trim()
    )
      continue;

    result.push({
      id: raw['id'],
      name: raw['name'],
      email: typeof raw['email'] === 'string' ? raw['email'] : '',
      avatarGlyph: typeof raw['avatarGlyph'] === 'string' ? raw['avatarGlyph'] : '',
      avatarTone:
        typeof raw['avatarTone'] === 'number' && Number.isFinite(raw['avatarTone'])
          ? Math.min(16, Math.max(0, Math.round(raw['avatarTone'])))
          : 0,
    });
  }

  return result;
}

function normalizeUpdateSettings(value: unknown): UpdateSettings {
  const raw = record(value);

  return {
    checkOnStartup:
      typeof raw['checkOnStartup'] === 'boolean'
        ? raw['checkOnStartup']
        : DEFAULT_UPDATE_SETTINGS.checkOnStartup,
  };
}

function normalizeRecoverySettings(value: unknown): RecoverySettings {
  const raw = record(value);
  return {
    autoCleanup:
      typeof raw['autoCleanup'] === 'boolean'
        ? raw['autoCleanup']
        : DEFAULT_RECOVERY_SETTINGS.autoCleanup,
    maxCheckpoints: size(raw['maxCheckpoints'], RECOVERY_LIMITS.maxCheckpoints),
    maxAgeDays: size(raw['maxAgeDays'], RECOVERY_LIMITS.maxAgeDays),
    maxMiB: size(raw['maxMiB'], RECOVERY_LIMITS.maxMiB),
  };
}

function normalizeBackupSettings(value: unknown): BackupSettings {
  const raw = record(value);
  return {
    enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_BACKUP_SETTINGS.enabled,
    maxMiB: size(raw['maxMiB'], BACKUP_LIMITS),
  };
}
