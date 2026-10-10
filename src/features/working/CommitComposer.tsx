import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useGestures } from '@app/GestureContext';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { Sha } from '@core/domain/commit';
import { isCancelled, toGitOperationError } from '@core/domain/errors';
import type { Branch } from '@core/domain/refs';
import type { RepoId } from '@core/domain/repository';
import type { CommitPrecondition } from '@core/domain/status';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Checkbox } from '@ui/Checkbox';
import { Dropdown } from '@ui/Dropdown';
import { Avatar } from '@ui/Avatar';
import { useShellStore } from '@app/shellStore';
import { GitErrorPanel } from '@app/GitErrorPanel';
import { Spinner } from '@ui/Spinner';
import { useSettingsData } from '../settings/useSettingsData';
import { Textarea } from '@ui/Textarea';

import { BODY_LIMIT, canCommit, commitWarnings, SUMMARY_LIMIT } from './commitMessage';
import styles from './CommitComposer.module.css';
import type { WorkingActions } from './useWorkingActions';
import { useWorkingStore } from './workingStore';

interface CommitComposerProps {
  repoId: RepoId;
  /** La rama activa, para saber si lo suyo ya está publicado. Nula con HEAD desacoplado. */
  head: Branch | null;
  /** Como se nombra la rama activa en toda frase; con HEAD desacoplado, su SHA corto. */
  headName: string;
  /** A qué apunta HEAD: es el commit que `amend` reescribe. */
  headSha: Sha;
  stagedCount: number;
  commitPrecondition?: CommitPrecondition;
  actions: WorkingActions;
  onMinimumHeightChange?: (height: number) => void;
}

/**
 * Redactar el commit — CU-7.
 *
 * Resumen y detalle se distinguen **por tamaño de fuente y no por etiqueta**:
 * son la primera línea y el resto del mismo mensaje, no dos campos de un
 * formulario. Los avisos de estilo salen debajo y nunca deshabilitan nada; lo
 * único que apaga el botón es no tener nada que enviar.
 *
 * El borrador vive en el store y no aquí porque `Mod+Enter` es un gesto del
 * registro global: se dispara desde fuera de este árbol —incluso con el foco en
 * la lista de archivos— y tiene que poder leer lo escrito.
 */
export function CommitComposer({
  repoId,
  head,
  headName,
  headSha,
  stagedCount,
  commitPrecondition,
  actions,
  onMinimumHeightChange,
}: CommitComposerProps) {
  const { t } = useI18n();
  const { git } = usePorts();
  const gestures = useGestures();
  const { settings } = useSettingsData();
  const profiles = settings.git.profiles;
  const [changingProfile, setChangingProfile] = useState(false);
  const [profileFailed, setProfileFailed] = useState(false);
  const identityVersion = useWorkingStore((state) => state.historyVersion);
  const loadIdentity = useCallback(
    (query: { signal?: AbortSignal }) => {
      void identityVersion;
      return git.readIdentity(repoId, query);
    },
    [git, repoId, identityVersion],
  );
  const identity = useAsyncData(loadIdentity, { resourceKey: repoId });
  const gitIdentity = identity.status === 'ready' ? identity.data : null;
  const profile = profiles.find(
    (candidate) => candidate.name === gitIdentity?.name && candidate.email === gitIdentity.email,
  );
  const chooseProfile = async (candidate: (typeof profiles)[number]) => {
    setChangingProfile(true);
    setProfileFailed(false);
    try {
      await git.writeIdentity(repoId, { name: candidate.name, email: candidate.email });
      identity.reload();
    } catch {
      setProfileFailed(true);
    } finally {
      setChangingProfile(false);
    }
  };
  const busy = useWorkingStore((state) => state.pendingWrites > 0);

  const draft = useWorkingStore((state) => state.commitDraft);
  const setDraft = useWorkingStore((state) => state.setCommitDraft);
  const request = useWorkingStore((state) => state.commitRequest);
  const clearRequest = useWorkingStore((state) => state.clearCommitRequest);

  const warnings = commitWarnings(draft.summary);
  const amendAllowed = useWorkingStore((state) => state.context?.canAmend !== false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const amendError = draft.amendError;
  const amendLoading = draft.amend && draft.amendLoaded !== true;
  const amendStale = draft.amend && draft.amendHead !== headSha;
  const ready =
    canCommit(draft.summary, stagedCount, draft.amend) &&
    !amendLoading &&
    !amendStale &&
    (!draft.amend || amendAllowed);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLElement>(null);

  // El mínimo incluye los controles y avisos visibles, incluso cuando cambian
  // de alto por el idioma, la densidad, el ancho o el modo amend.
  useLayoutEffect(() => {
    const node = composerRef.current;
    if (!node || !onMinimumHeightChange) return;
    const children = Array.from(node.children);
    const measure = () => {
      const css = getComputedStyle(node);
      const pixels = (value: string) => Number.parseFloat(value) || 0;
      const contentHeight = children.reduce((height, child) => {
        const childCss = getComputedStyle(child);
        return (
          height +
          (child.classList.contains(styles.message ?? '')
            ? pixels(childCss.minHeight)
            : child.getBoundingClientRect().height) +
          pixels(childCss.marginTop) +
          pixels(childCss.marginBottom)
        );
      }, 0);
      const minimum = Math.ceil(
        contentHeight +
          Math.max(0, children.length - 1) * pixels(css.rowGap) +
          pixels(css.paddingTop) +
          pixels(css.paddingBottom) +
          pixels(css.borderTopWidth) +
          pixels(css.borderBottomWidth),
      );
      if (minimum > 0) onMinimumHeightChange(minimum);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    children.forEach((child) => observer?.observe(child));
    return () => observer?.disconnect();
  });

  const toggleAmend = useCallback(
    (amend: boolean) => {
      const current = useWorkingStore.getState().commitDraft;
      if (!amend) {
        setDraft({
          ...(current.beforeAmend ?? { summary: '', body: '' }),
          amend: false,
          amendHead: undefined,
          amendLoaded: undefined,
          amendError: undefined,
          amendMessageOnly: undefined,
          beforeAmend: undefined,
        });
        return;
      }
      if (!headSha || !amendAllowed) return;
      setDraft({
        amend: true,
        amendHead: headSha,
        amendLoaded: false,
        amendError: undefined,
        amendMessageOnly: false,
        beforeAmend: { summary: current.summary, body: current.body },
      });
    },
    [headSha, amendAllowed, setDraft],
  );

  // No permitir enviar un mensaje incompleto ni aplicar una lectura tardía
  // después de cancelar, cambiar de repositorio o comenzar otra enmienda.
  useEffect(() => {
    if (!draft.amend || draft.amendLoaded || !draft.amendHead) return;
    const controller = new AbortController();
    const target = draft.amendHead;
    void git
      .readCommit(repoId, target, { signal: controller.signal })
      .then((details) => {
        if (controller.signal.aborted) return;
        setDraft({ summary: details.commit.summary, body: details.commit.body, amendLoaded: true });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isCancelled(error)) return;
        setDraft({ amendError: toGitOperationError(error) });
      });
    return () => controller.abort();
  }, [draft.amend, draft.amendHead, draft.amendLoaded, git, repoId, setDraft, loadAttempt]);

  const submit = useCallback(() => {
    const state = useWorkingStore.getState();
    const current = state.commitDraft;

    if (
      changingProfile ||
      identity.status !== 'ready' ||
      state.pendingWrites > 0 ||
      (current.amend && (!current.amendLoaded || current.amendHead !== headSha || !amendAllowed)) ||
      !canCommit(current.summary, stagedCount, current.amend)
    )
      return;

    actions.commit(
      {
        summary: current.summary.trim(),
        body: current.body.trim(),
        ...(current.amend
          ? { amend: true, amendMessageOnly: current.amendMessageOnly === true }
          : {}),
        ...(commitPrecondition === undefined ? {} : { precondition: commitPrecondition }),
      },
      headName,
    );
  }, [
    actions,
    commitPrecondition,
    headName,
    stagedCount,
    changingProfile,
    identity.status,
    headSha,
    amendAllowed,
  ]);

  // El atajo de envío y los controles de amend dejan una petición en el store;
  // este componente, que tiene los puertos, la atiende.
  useEffect(() => {
    if (request === null) return;

    clearRequest();

    if (request.amend && !useWorkingStore.getState().commitDraft.amend) {
      // Abrir amend marca la casilla y carga el mensaje antes de poder enviarlo.
      toggleAmend(true);

      return;
    }

    submit();
  }, [clearRequest, request, submit, toggleAmend]);

  const published = head !== null && head.ahead === 0 && head.upstream !== undefined;

  return (
    <section
      ref={composerRef}
      className={styles.composer}
      aria-label={t('working.composer.label', { branch: headName })}
    >
      <header className={styles.header}>
        <span className={styles.title}>{t('working.composer.title')}</span>
      </header>
      <div className={styles.message}>
        <Textarea
          fieldClassName={styles.summaryField}
          className={[styles.summary, draft.summary.length >= SUMMARY_LIMIT ? styles.atLimit : '']
            .filter(Boolean)
            .join(' ')}
          label={t('working.composer.summary')}
          hideLabel
          placeholder={t('working.composer.summaryPlaceholder')}
          minRows={1}
          maxRows={3}
          maxLength={SUMMARY_LIMIT}
          disabled={amendLoading}
          value={draft.summary}
          onKeyDown={(event) => {
            if (
              event.key !== 'Enter' ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            bodyRef.current?.focus();
          }}
          onChange={(event) => {
            setDraft({
              summary: event.target.value,
            });
          }}
        />

        <Textarea
          fieldClassName={styles.bodyField}
          className={[styles.body, draft.body.length >= BODY_LIMIT ? styles.atLimit : '']
            .filter(Boolean)
            .join(' ')}
          label={t('working.composer.body')}
          hideLabel
          placeholder={t('working.composer.bodyPlaceholder')}
          minRows={4}
          autoResize={false}
          disabled={amendLoading}
          maxLength={BODY_LIMIT}
          textareaRef={bodyRef}
          value={draft.body}
          onChange={(event) => {
            setDraft({
              body: event.target.value,
            });
          }}
        />
      </div>

      <div className={styles.profile}>
        <Dropdown
          label={
            gitIdentity
              ? `${gitIdentity.name} <${gitIdentity.email}>`
              : t('working.composer.gitIdentity')
          }
          menuLabel={t('working.composer.profile')}
          matchTriggerWidth
          icon={
            gitIdentity ? (
              <Avatar
                name={gitIdentity.name}
                email={gitIdentity.email}
                size="sm"
                {...(profile?.avatarGlyph
                  ? { glyph: profile.avatarGlyph, tone: profile.avatarTone }
                  : {})}
              />
            ) : undefined
          }
          disabled={busy || changingProfile || identity.status === 'loading'}
          items={[
            ...profiles.map((candidate) => ({
              key: candidate.id,
              label: candidate.name,
              description: candidate.email,
              icon: (
                <Avatar
                  name={candidate.name}
                  email={candidate.email}
                  size="sm"
                  {...(candidate.avatarGlyph
                    ? { glyph: candidate.avatarGlyph, tone: candidate.avatarTone }
                    : {})}
                />
              ),
              onSelect: () => {
                void chooseProfile(candidate);
              },
            })),
            { kind: 'separator', key: 'separator' },
            {
              key: 'add',
              label: t('settings.git.profile.add'),
              onSelect: () => {
                useShellStore.getState().openSettings('git');
                useShellStore.setState({ addingProfile: true });
              },
            },
          ]}
        />
        {profileFailed && <p role="alert">{t('settings.profiles.applyError')}</p>}
      </div>

      {warnings.length > 0 && (
        <ul className={styles.warnings}>
          {warnings.map((warning) => (
            <li key={warning}>
              {warning === 'summaryTooLong'
                ? t('working.composer.warning.tooLong', {
                    limit: SUMMARY_LIMIT,
                    count: draft.summary.trim().length,
                  })
                : t('working.composer.warning.hasBreak')}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.amend}>
        <Checkbox
          label={t('working.composer.amend')}
          disabled={busy || (!draft.amend && (!headSha || !amendAllowed))}
          checked={draft.amend}
          onChange={(event) => {
            toggleAmend(event.target.checked);
          }}
        />
        {draft.amend && (
          <>
            <p className={styles.hint}>
              {t('working.composer.amendTarget', { sha: draft.amendHead?.slice(0, 7) ?? '' })}
            </p>
            <Checkbox
              label={t('working.composer.amendMessageOnly')}
              checked={draft.amendMessageOnly === true}
              disabled={busy || amendLoading}
              onChange={(event) => setDraft({ amendMessageOnly: event.target.checked })}
            />
            <p className={styles.hint}>
              {t(
                draft.amendMessageOnly
                  ? 'working.composer.amendKeepsStage'
                  : 'working.composer.amendIncludesStage',
                { count: stagedCount },
              )}
            </p>
            {amendLoading && amendError === undefined && (
              <Spinner
                size="sm"
                label={t('working.commitDetails.loading', {
                  sha: draft.amendHead?.slice(0, 7) ?? '',
                })}
              />
            )}
            {amendError !== undefined && (
              <GitErrorPanel
                error={amendError}
                fixes={{
                  retry: () => {
                    setDraft({ amendError: undefined });
                    setLoadAttempt((attempt) => attempt + 1);
                  },
                }}
              />
            )}
            {amendStale && (
              <p role="alert" className={styles.published}>
                {t('working.composer.amendStale')}
              </p>
            )}
          </>
        )}
        {draft.amend && published && (
          <p className={styles.published} role="status">
            {t('working.composer.amendPublished', {
              branch: headName,
              remote: head?.upstream ?? '',
            })}
          </p>
        )}
      </div>

      <div className={styles.footer}>
        <Button
          variant="primary"
          disabled={!ready || busy || changingProfile || identity.status !== 'ready'}
          iconStart={busy ? <Spinner size="sm" label={t('working.busy')} /> : undefined}
          onClick={() => {
            gestures.run(draft.amend ? 'working.amend' : 'working.commit');
          }}
        >
          {draft.amend
            ? t('working.composer.submitAmend', { branch: headName })
            : t('working.composer.submit', { branch: headName })}
        </Button>
      </div>
    </section>
  );
}
