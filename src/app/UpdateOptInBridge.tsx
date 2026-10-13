import { useEffect, useRef } from 'react';

import { UPDATE_PROMPT_DELAY, UPDATE_PROMPT_INTERVAL } from '@core/domain/updatePrompt';
import type { UpdateSettings } from '@core/domain/settings';
import { getSettingsSnapshot, useSettingsData } from '@features/settings/useSettingsData';
import { useI18n } from '@i18n/useI18n';
import { useToast } from '@ui/useToast';
import type { ToastDismissReason } from '@ui/toastContext';

/** Suggest an explicit opt-in; never query releases merely to show this notice. */
export function UpdateOptInBridge() {
  const { settings, patch } = useSettingsData();
  const { t } = useI18n();
  const { show, dismiss } = useToast();
  const attempted = useRef(false);
  const lifetime = useRef(0);
  const notice = useRef<string | null>(null);
  const choosing = useRef(false);
  const { checkOnStartup, promptDismissed, nextPromptAt } = settings.updates;

  useEffect(() => {
    lifetime.current += 1;
    return () => {
      lifetime.current += 1;
      if (notice.current) dismiss(notice.current);
      notice.current = null;
    };
  }, [dismiss]);

  useEffect(() => {
    if (notice.current && !choosing.current && (checkOnStartup || promptDismissed)) {
      dismiss(notice.current);
      notice.current = null;
    }
  }, [checkOnStartup, promptDismissed, dismiss]);

  useEffect(() => {
    if (attempted.current || checkOnStartup || promptDismissed || nextPromptAt > Date.now()) return;

    const timer = setTimeout(() => {
      attempted.current = true;
      const generation = lifetime.current;
      const deadline = Date.now() + UPDATE_PROMPT_INTERVAL;
      const alive = () => generation === lifetime.current;
      const reportFailure = () => {
        if (alive()) show({ message: t('settings.updates.prompt.saveFailed'), variant: 'danger' });
      };
      const saveChoice = async (updates: Partial<UpdateSettings>) => {
        choosing.current = true;
        try {
          await patch({ updates });
        } catch (error) {
          reportFailure();
          throw error;
        } finally {
          choosing.current = false;
          // A settings view may have changed the preference while this choice
          // was saving. The effect skipped that update to keep pending actions
          // visible, so reconcile it again once the write has finished.
          const current = getSettingsSnapshot().updates;
          if (alive() && notice.current && (current.checkOnStartup || current.promptDismissed)) {
            dismiss(notice.current);
            notice.current = null;
          }
        }
      };

      // Also defer if the user closes the app without answering. An unreadable
      // preference store must not turn this offer into a prompt on every render.
      void patch({ updates: { nextPromptAt: deadline } }).then(() => {
        const current = getSettingsSnapshot().updates;
        if (
          !alive() ||
          current.checkOnStartup ||
          current.promptDismissed ||
          current.nextPromptAt !== deadline
        )
          return;
        let id = '';
        const onDismiss = (reason: ToastDismissReason) => {
          if (notice.current === id) notice.current = null;
          if (!alive() || (reason !== 'close' && reason !== 'timeout')) return;
          const latest = getSettingsSnapshot().updates;
          if (latest.checkOnStartup || latest.promptDismissed) return;
          void saveChoice({ nextPromptAt: Date.now() + UPDATE_PROMPT_INTERVAL }).catch(
            () => undefined,
          );
        };
        id = show({
          message: t('settings.updates.prompt.message'),
          duration: 0,
          actions: [
            {
              label: t('settings.updates.prompt.enable'),
              onAction: async () => {
                await saveChoice({ checkOnStartup: true, promptDismissed: true, nextPromptAt: 0 });
                if (alive() && getSettingsSnapshot().updates.checkOnStartup)
                  show({ message: t('settings.updates.prompt.enabled'), variant: 'success' });
              },
            },
            {
              label: t('settings.updates.prompt.remindLater'),
              onAction: () => saveChoice({ nextPromptAt: Date.now() + UPDATE_PROMPT_INTERVAL }),
            },
            {
              label: t('settings.updates.prompt.never'),
              onAction: () => saveChoice({ promptDismissed: true, nextPromptAt: 0 }),
            },
          ],
          onDismiss,
        });
        notice.current = id;
      }, reportFailure);
    }, UPDATE_PROMPT_DELAY);
    return () => clearTimeout(timer);
  }, [checkOnStartup, promptDismissed, nextPromptAt, patch, show, dismiss, t]);

  return null;
}
