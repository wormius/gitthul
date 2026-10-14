import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@design/base.css';
import { App } from '@app/App';
import { initSettingsData } from './features/settings/useSettingsData';
import { APP_NAME, APP_VERSION } from '@app/metadata';
import { restoreShellSession } from '@app/shellStore';
import { createPaneSettingsStore } from '@app/paneSettingsStore';
import { PortsContext } from '@app/PortsContext';
import { createSectionSettingsStore } from '@app/sectionSettingsStore';
import { errorDetail, errorDiagnostic } from '@core/adapters/logOperation';
import { selectPorts } from '@core/adapters/selectPorts';
import { DEFAULT_SETTINGS, type Settings } from '@core/domain/settings';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';
import { PaneStorageContext } from '@ui/paneStorage';
import { SectionStorageContext } from '@ui/sectionStorage';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Falta el contenedor #root en index.html');
}

const ports = selectPorts();

window.addEventListener('error', (event) => {
  ports.log.write(
    'error',
    'runtime',
    event.message || 'error no controlado en la interfaz',
    errorDetail(event.error ?? event.message),
    {
      method: 'window.error',
      phase: 'failure',
      error: errorDiagnostic(event.error ?? event.message),
      requestData: { filename: event.filename, line: event.lineno, column: event.colno },
    },
  );
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as unknown;
  ports.log.write('error', 'runtime', 'promesa rechazada sin control', errorDetail(reason), {
    method: 'window.unhandledrejection',
    phase: 'failure',
    error: errorDiagnostic(reason),
  });
});

/**
 * Los ajustes se leen **antes** de pintar.
 *
 * Si la ventana se dibujara con el tema de fábrica y se corrigiera después, lo
 * que se vería en cada arranque sería un destello de claro a oscuro. Leerlos
 * primero cuesta un viaje a disco y ahorra ese parpadeo; el idioma va en el
 * mismo viaje por el mismo motivo.
 *
 * Que la lectura falle no puede impedir que la aplicación abra: se queda con
 * los valores de fábrica, lo anota en el registro y sigue.
 */
async function loadSettings(): Promise<Settings> {
  try {
    return await ports.settings.read();
  } catch (error) {
    ports.log.write(
      'error',
      'settings',
      'no se pudieron leer los ajustes; se arranca con los de fábrica',
      errorDetail(error),
      {
        method: 'loadSettings',
        phase: 'event',
        error: errorDiagnostic(error),
        resultData: { defaults: true },
      },
    );

    return DEFAULT_SETTINGS;
  }
}

const settings = await loadSettings();
initSettingsData(settings);

try {
  restoreShellSession(await ports.session.read());
} catch (error) {
  ports.log.write(
    'error',
    'session',
    'no se pudo leer la sesión; se arranca en Repositorios',
    errorDetail(error),
    {
      method: 'restoreSession',
      phase: 'event',
      error: errorDiagnostic(error),
      resultData: { restored: false },
    },
  );
}

const onWriteError = (error: unknown) => {
  ports.log.write('error', 'settings', 'no se pudo guardar un ajuste', errorDetail(error), {
    method: 'writeSettings',
    phase: 'failure',
    error: errorDiagnostic(error),
  });
};

const paneStore = createPaneSettingsStore(ports.settings, settings, onWriteError);
const sectionStore = createSectionSettingsStore(ports.settings, settings, onWriteError);

ports.log.write('info', 'app', `${APP_NAME} ${APP_VERSION} arrancó`);

createRoot(container, {
  onCaughtError: (error, info) =>
    ports.log.write(
      'error',
      'runtime.react',
      'Error de renderizado controlado',
      `${errorDetail(error)}\n${info.componentStack ?? ''}`,
      {
        method: 'react.onCaughtError',
        phase: 'failure',
        error: errorDiagnostic(error),
        requestData: { componentStack: info.componentStack ?? '' },
      },
    ),
  onUncaughtError: (error, info) =>
    ports.log.write(
      'error',
      'runtime.react',
      'Error de renderizado sin control; la vista puede dejar de responder',
      `${errorDetail(error)}\n${info.componentStack ?? ''}`,
      {
        method: 'react.onUncaughtError',
        phase: 'failure',
        error: errorDiagnostic(error),
        requestData: { componentStack: info.componentStack ?? '' },
      },
    ),
}).render(
  <StrictMode>
    <PortsContext value={ports}>
      <ThemeProvider
        initialSettings={settings.appearance}
        onChange={(appearance) => {
          void ports.settings.patch({ appearance }).catch(onWriteError);
        }}
      >
        <I18nProvider
          {...(settings.locale === 'auto' ? {} : { initialLocale: settings.locale })}
          onChange={(locale) => {
            void ports.settings.patch({ locale }).catch(onWriteError);
          }}
        >
          <PaneStorageContext value={paneStore}>
            <SectionStorageContext value={sectionStore}>
              <App />
            </SectionStorageContext>
          </PaneStorageContext>
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>
  </StrictMode>,
);
