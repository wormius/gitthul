import type { MessageKey } from '@i18n/messages';

export interface SettingsSection {
  id: SettingsSectionId;
  labelKey: MessageKey;
}

export type SettingsSectionId =
  'appearance' | 'language' | 'git' | 'shortcuts' | 'updates' | 'recovery' | 'logging' | 'about';

/** Las secciones de configuraciones del entregable. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', labelKey: 'settings.section.appearance' },
  { id: 'language', labelKey: 'settings.section.language' },
  { id: 'git', labelKey: 'settings.section.git' },
  { id: 'shortcuts', labelKey: 'settings.section.shortcuts' },
  { id: 'updates', labelKey: 'settings.section.updates' },
  { id: 'recovery', labelKey: 'settings.section.recovery' },
  { id: 'logging', labelKey: 'settings.section.logging' },
  { id: 'about', labelKey: 'settings.section.about' },
];
