import { createRoot, type Root } from 'react-dom/client';

import {
  NativeRuntimeUnavailableError,
  selectPorts,
  type AppPorts,
} from '@core/adapters/selectPorts';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';

import { StartupError } from './StartupError';

/** A startup failure remains visible even when no native logger can be created. */
export async function startApplication(
  container: HTMLElement,
  start: (ports: AppPorts) => Promise<void>,
  choosePorts: () => AppPorts = selectPorts,
): Promise<Root | undefined> {
  try {
    await start(choosePorts());
  } catch (error) {
    console.error('GitThul startup failed', error);
    const root = createRoot(container);
    root.render(
      <ThemeProvider>
        <I18nProvider>
          <StartupError desktopUnavailable={error instanceof NativeRuntimeUnavailableError} />
        </I18nProvider>
      </ThemeProvider>,
    );
    return root;
  }
}
