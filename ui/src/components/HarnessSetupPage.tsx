import { useMemo, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Loader2, PanelsTopLeft } from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { RecoverySurface, RefreshNotice } from './StateViews'
import { workspaceDisplayTitle } from './workspace/display'
import { useWorkspace } from '../tabs/store'

export type HarnessSetupCopyPrefix = 'autoQuantSetup' | 'autoPredictionSetup' | 'chatSetup'

export interface HarnessSetupPageProps {
  readonly icon: ComponentType<{ className?: string }>
  readonly testIdPrefix: string
  readonly copyPrefix: HarnessSetupCopyPrefix
  readonly templateName: string
  readonly showHarnessVersion: boolean
  readonly requireTemplates?: boolean
  readonly extraReady?: boolean
  readonly extraError?: string | null
  readonly onRetryExtra?: () => void
  readonly initialize: () => Promise<unknown>
  readonly selectWorkspace?: (workspaceId: string) => Promise<void>
}

export function HarnessSetupPage({
  icon: Icon,
  testIdPrefix,
  copyPrefix,
  templateName,
  showHarnessVersion,
  requireTemplates = true,
  extraReady = true,
  extraError = null,
  onRetryExtra,
  initialize: initializeWorkspace,
  selectWorkspace,
}: HarnessSetupPageProps) {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaces = useMemo(
    () => ctx.workspaces
      .filter((workspace) => workspace.template === templateName)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [ctx.workspaces, templateName],
  )
  const template = ctx.templates.find((candidate) => candidate.name === templateName)
  const version = template?.source?.defaultVersion

  const initialize = async () => {
    setInitializing(true)
    setError(null)
    try {
      await initializeWorkspace()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setInitializing(false)
    }
  }

  const chooseWorkspace = async (workspaceId: string) => {
    if (!selectWorkspace) return
    setPendingWorkspaceId(workspaceId)
    setError(null)
    try {
      await selectWorkspace(workspaceId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPendingWorkspaceId(null)
    }
  }

  if (!ctx.hasLoaded && ctx.listError !== null) {
    return (
      <RecoverySurface
        eyebrow={t('workspace.dataUnavailableEyebrow')}
        title={t('workspace.dataUnavailableTitle')}
        description={t('workspace.dataUnavailableDescription')}
        actionLabel={t('common.retry')}
        onAction={() => void ctx.refresh()}
      />
    )
  }

  if (requireTemplates && ctx.templatesLoaded && ctx.templatesError !== null) {
    return (
      <RecoverySurface
        eyebrow={t('workspace.dataUnavailableEyebrow')}
        title={t('workspace.templatesUnavailableTitle')}
        description={t('workspace.templatesUnavailableDescription')}
        actionLabel={t('common.retry')}
        onAction={() => void ctx.refreshTemplates()}
      />
    )
  }

  if (!ctx.hasLoaded || (requireTemplates && !ctx.templatesLoaded) || !extraReady) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label={t(`${copyPrefix}.loading`)} />
      </div>
    )
  }

  if (extraError) {
    return (
      <RecoverySurface
        eyebrow={t('workspace.dataUnavailableEyebrow')}
        title={t(`${copyPrefix}.loadErrorTitle`)}
        description={t(`${copyPrefix}.loadErrorBody`)}
        actionLabel={t('common.retry')}
        onAction={() => onRetryExtra?.()}
      />
    )
  }

  const hasExisting = workspaces.length > 0 && selectWorkspace !== undefined

  return (
    <div
      data-testid={`${testIdPrefix}-scroll`}
      className="relative flex h-full w-full items-start justify-start overflow-auto bg-background px-5 py-10"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-accent to-transparent" />
        <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(to_right,var(--foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--foreground)_1px,transparent_1px)] [background-size:96px_96px]" />
      </div>

      <main data-testid={`${testIdPrefix}-stack`} className="relative z-10 mx-auto my-auto w-full max-w-xl">
        {ctx.listError !== null && (
          <RefreshNotice
            message={t('workspace.dataStale')}
            actionLabel={t('common.retry')}
            onAction={() => void ctx.refresh()}
            className="mb-5"
          />
        )}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {t(`${copyPrefix}.eyebrow`)}
          </p>
          <h1 className="text-2xl font-semibold text-foreground">
            {hasExisting ? t(`${copyPrefix}.chooseTitle`) : t(`${copyPrefix}.initializeTitle`)}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            {hasExisting ? t(`${copyPrefix}.chooseBody`) : t(`${copyPrefix}.initializeBody`)}
          </p>
        </div>

        {hasExisting ? (
          <div className="space-y-2">
            {workspaces.map((workspace) => {
              const pending = pendingWorkspaceId === workspace.id
              return (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={pendingWorkspaceId !== null}
                  onClick={() => void chooseWorkspace(workspace.id)}
                  className="oa-pressable group flex w-full items-center gap-3 rounded-xl border border-border/75 bg-secondary/75 px-4 py-3 text-left hover:border-primary/40 hover:bg-muted disabled:opacity-60"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary">
                    <PanelsTopLeft className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {workspaceDisplayTitle(workspace)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t(`${copyPrefix}.workspaceMeta`, {
                        count: workspace.sessions.length,
                        version: workspace.harnessSource?.version ?? version ?? '—',
                      })}
                    </span>
                  </span>
                  {pending
                    ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    : <ArrowRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary" />}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => openOrFocus({ kind: 'workspace-list', params: {} })}
              className="mx-auto mt-3 block text-xs text-muted-foreground hover:text-foreground"
            >
              {t(`${copyPrefix}.manageWorkspaces`)}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/75 bg-secondary/70 p-5 shadow-[0_20px_60px_-48px_var(--foreground)]">
            <div className="mb-5 flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                <Check className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="text-sm font-medium text-foreground">{t(`${copyPrefix}.persistentTitle`)}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t(`${copyPrefix}.persistentBody`)}
                </p>
              </div>
            </div>
            {showHarnessVersion && (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/70 px-3 py-2 text-xs">
                {/* Only AutoQuant pins a Harness version. Chat deliberately
                    reuses the latest template and never renders this row. */}
                <span className="text-muted-foreground">{t('autoQuantSetup.harnessVersion')}</span>
                <span className="font-mono text-foreground">{version ?? '—'}</span>
              </div>
            )}
            <button
              type="button"
              disabled={initializing}
              onClick={() => void initialize()}
              className="oa-pressable flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {initializing && <Loader2 className="h-4 w-4 animate-spin" />}
              {initializing ? t(`${copyPrefix}.initializing`) : t(`${copyPrefix}.initializeAction`)}
            </button>
            {initializing && (
              <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
                {t(`${copyPrefix}.initializingBody`)}
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-4 text-center text-xs text-destructive">{error}</p>}
      </main>
    </div>
  )
}
