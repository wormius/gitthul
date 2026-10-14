import type { LogPort } from '@core/ports/LogPort';
import { redactKnownLogValues, redactLogText } from '@core/domain/logPrivacy';
import type { LogMetadata } from '@core/domain/logs';
import type { TerminalExit } from '@core/ports/TerminalPort';
import { logOperation, type OperationSummary } from './logOperation';

const LABELS: Record<string, Record<string, string>> = {
  backup: {
    read: 'leer respaldos de emergencia',
    schedule: 'programar respaldo de repositorio',
    restore: 'restaurar repositorio en carpeta nueva',
  },
  recovery: {
    read: 'leer puntos de recuperación',
    cleanup: 'limpiar archivos temporales inactivos',
  },
  settings: {
    read: 'leer ajustes',
    patch: 'guardar ajustes',
    flush: 'persistir ajustes pendientes',
  },
  session: {
    read: 'restaurar sesión',
    write: 'guardar sesión',
    flush: 'persistir sesión pendiente',
  },
  library: {
    read: 'leer biblioteca',
    createSpace: 'crear espacio',
    createSpaceAndAddMany: 'crear espacio con repositorios',
    renameSpace: 'renombrar espacio',
    deleteSpace: 'eliminar espacio',
    moveSpace: 'ordenar espacios',
    addToSpace: 'agregar repositorio al espacio',
    addManyToSpace: 'agregar repositorios al espacio',
    removeFromSpace: 'retirar repositorio del espacio',
    removeManyFromSpaces: 'retirar repositorios de los espacios',
    setSpaceCollapsed: 'plegar o desplegar espacio',
    setView: 'cambiar vista de biblioteca',
    setSort: 'ordenar repositorios',
    setLayout: 'cambiar disposición de biblioteca',
    setAvatar: 'guardar avatar del repositorio',
    recordOpening: 'guardar repositorio reciente',
    flush: 'persistir biblioteca',
  },
  auth: {
    subscribe: 'escuchar solicitudes de autenticación',
    answer: 'responder autenticación',
    listKeys: 'listar llaves SSH',
    importKey: 'importar llave SSH',
    generateKey: 'generar llave SSH',
    removeKey: 'eliminar llave SSH',
    readAccess: 'leer acceso al remoto',
    saveAccess: 'guardar acceso al remoto',
    forgetAccess: 'olvidar acceso al remoto',
  },
  keyring: {
    isAvailable: 'consultar disponibilidad del llavero',
    has: 'consultar referencia del llavero',
    set: 'guardar secreto en el llavero',
    delete: 'eliminar secreto del llavero',
  },
  system: {
    pickDirectory: 'elegir carpeta',
    pickFile: 'elegir archivo',
    revealPath: 'abrir carpeta en explorador',
    resolveChildPath: 'resolver ruta',
    writeClipboardText: 'copiar al portapapeles',
    readClipboardText: 'leer portapapeles',
  },
  link: { openExternal: 'abrir enlace confirmado', checkRelease: 'consultar versiones publicadas' },
  terminal: {
    createSession: 'abrir terminal',
    closeSession: 'cerrar terminal',
    write: 'enviar entrada al PTY',
    resize: 'redimensionar terminal',
    getHistory: 'leer historial de terminal',
  },
};

/** Safe by default: no arguments or response bodies from credential, settings or clipboard ports. */
export function instrumentAppPort<T extends object>(port: T, scope: string, log: LogPort): T {
  const terminalLifetimes = new Map<string, { closing: boolean }>();
  return new Proxy(port, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function' || property === 'execute')
        return value;
      return (...args: unknown[]) => {
        let request: string | undefined;
        let repository: string | undefined;
        const requestData: LogMetadata = {};
        if (scope === 'auth' && /^(readAccess|saveAccess|forgetAccess)$/.test(property)) {
          repository = typeof args[0] === 'string' ? args[0] : undefined;
          const access = args[1];
          const url =
            typeof access === 'string'
              ? access
              : access && typeof access === 'object' && 'url' in access
                ? String(access.url)
                : '';
          request = `url=${redactLogText(url)}`;
          requestData['url'] = redactLogText(url);
        }
        if (scope === 'system' && /^(revealPath|resolveChildPath)$/.test(property))
          request = args
            .filter((value) => typeof value === 'string')
            .map((value, index) => `path${index}=${redactLogText(String(value))}`)
            .join(' · ');
        if (scope === 'link' && property === 'openExternal' && typeof args[0] === 'string')
          request = `url=${redactLogText(args[0])}`;
        if (scope === 'link' && property === 'checkRelease') requestData['releaseKind'] = 'stable';
        if (scope === 'settings' && property === 'patch' && args[0] && typeof args[0] === 'object')
          request = `secciones=${Object.keys(args[0]).join(',')}`;
        if (scope === 'settings' && property === 'patch' && args[0] && typeof args[0] === 'object')
          requestData['sections'] = Object.keys(args[0]);
        if (scope === 'backup' && property === 'schedule' && typeof args[0] === 'string')
          repository = args[0];
        if (scope === 'terminal') {
          const first = args[0];
          if (property === 'createSession' && first && typeof first === 'object') {
            const original = first as Record<string, unknown>;
            const sessionId = String(original['sessionId']);
            const lifetime = { closing: false };
            terminalLifetimes.set(sessionId, lifetime);
            request = `sessionId=${String(original['sessionId'])} · cwd=${String(original['cwd'])} · cols=${String(original['cols'])} · rows=${String(original['rows'])}`;
            Object.assign(requestData, {
              sessionId,
              cwd: String(original['cwd']),
              cols: Number(original['cols']),
              rows: Number(original['rows']),
            });
            args[0] = {
              ...original,
              onExit: (exit: TerminalExit) => {
                try {
                  log.write(
                    exit.success || lifetime.closing ? 'info' : 'warn',
                    'terminal',
                    lifetime.closing
                      ? 'El proceso de terminal terminó al cerrar la sesión'
                      : exit.success
                        ? 'El proceso de terminal terminó'
                        : 'El proceso de terminal terminó con estado no exitoso',
                    undefined,
                    {
                      phase: 'event',
                      request,
                      requestData,
                      result: `code=${exit.code} · signal=${exit.signal ?? 'none'}`,
                      resultData: {
                        code: exit.code,
                        signal: exit.signal,
                        success: exit.success,
                        closing: lifetime.closing,
                      },
                    },
                  );
                } catch {
                  /* Deliver the terminal exit even if the logger fails. */
                }
                if (terminalLifetimes.get(sessionId) === lifetime)
                  terminalLifetimes.delete(sessionId);
                (original['onExit'] as ((exit: TerminalExit) => void) | undefined)?.(exit);
              },
            };
          } else {
            request = `sessionId=${String(first)}`;
            requestData['sessionId'] = String(first);
            if (property === 'closeSession') {
              const lifetime = terminalLifetimes.get(String(first));
              if (lifetime) lifetime.closing = true;
            }
          }
        }
        if (scope === 'auth' && property === 'subscribe' && typeof args[0] === 'function') {
          const listener = args[0] as (event: unknown) => void;
          args[0] = (event: unknown) => {
            try {
              if (event && typeof event === 'object' && 'storageError' in event)
                log.write(
                  'warn',
                  'auth',
                  'La credencial no se pudo guardar en el llavero; se usará solo en esta sesión',
                );
              else if (event && typeof event === 'object') {
                const challenge = event as Record<string, unknown>;
                log.write('debug', 'auth', 'Cambio en la solicitud de autenticación', undefined, {
                  phase: 'event',
                  ...(typeof challenge['repository'] === 'string'
                    ? { repository: challenge['repository'] }
                    : {}),
                  ...(typeof challenge['operationId'] === 'string'
                    ? { nativeOperationId: challenge['operationId'] }
                    : {}),
                  requestData: {
                    ...(typeof challenge['kind'] === 'string' ? { kind: challenge['kind'] } : {}),
                    ...(typeof challenge['url'] === 'string'
                      ? { url: redactLogText(challenge['url']) }
                      : {}),
                    dismissed: typeof challenge['dismiss'] === 'string',
                  },
                });
              }
            } catch {
              /* Authentication must survive a broken logger. */
            }
            listener(event);
          };
        }
        // Suppress arbitrary raw secrets if an underlying API echoes its own input in an error.
        const secrets: string[] = [];
        if (scope === 'keyring' && property === 'set' && typeof args[1] === 'string')
          secrets.push(args[1]);
        if (scope === 'auth') {
          if (property === 'generateKey' && typeof args[1] === 'string') secrets.push(args[1]);
          if (property === 'saveAccess' && typeof args[2] === 'string') secrets.push(args[2]);
          if (property === 'answer' && args[1] && typeof args[1] === 'object') {
            const secret = (args[1] as Record<string, unknown>)['secret'];
            if (typeof secret === 'string') secrets.push(secret);
          }
        }
        if (
          (scope === 'terminal' && property === 'write') ||
          (scope === 'system' && property === 'writeClipboardText')
        )
          if (typeof args[1] === 'string' || typeof args[0] === 'string')
            secrets.push(String(scope === 'terminal' ? args[1] : args[0]));
        const sanitize = (text: string) => redactKnownLogValues(text, secrets);
        return logOperation(
          log,
          scope,
          property,
          LABELS[scope]?.[property] ?? `${scope}: ${property}`,
          {
            ...(request ? { request } : {}),
            ...(repository ? { repository } : {}),
            ...(Object.keys(requestData).length ? { requestData } : {}),
          },
          () => {
            const pending = Reflect.apply(value, target, args) as Promise<unknown>;
            if (scope !== 'terminal' || !/^(createSession|closeSession)$/.test(property))
              return pending;
            const sessionId =
              property === 'createSession'
                ? String((args[0] as Record<string, unknown>)['sessionId'])
                : String(args[0]);
            return pending.then(
              (result) => {
                if (property === 'closeSession') terminalLifetimes.delete(sessionId);
                return result;
              },
              (error: unknown) => {
                const lifetime = terminalLifetimes.get(sessionId);
                if (property === 'createSession') terminalLifetimes.delete(sessionId);
                else if (lifetime) lifetime.closing = false;
                throw error;
              },
            );
          },
          scope === 'terminal' && /^(createSession|closeSession)$/.test(property)
            ? 'info'
            : 'debug',
          (result): string | OperationSummary => {
            if (scope === 'keyring' && property === 'isAvailable' && result === false)
              log.write(
                'warn',
                'keyring',
                'El llavero del sistema no está disponible; no se podrán guardar secretos',
              );
            return result === null
              ? { text: 'sin selección o sin datos', data: { selected: false } }
              : typeof result === 'boolean'
                ? { text: String(result), data: { value: result } }
                : Array.isArray(result)
                  ? { text: `elementos=${result.length}`, data: { count: result.length } }
                  : 'completado';
          },
          sanitize,
          !(scope === 'terminal' && /^(write|resize)$/.test(property)),
          (scope === 'terminal' && /^(createSession|closeSession)$/.test(property)) ||
            (scope === 'backup' && property === 'restore')
            ? 'info'
            : undefined,
        );
      };
    },
  });
}
