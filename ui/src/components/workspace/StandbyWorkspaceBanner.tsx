import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GitMerge, LoaderCircle, PauseCircle, Zap } from 'lucide-react'

import { useWorkspaces, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { Button } from '../ui/button'
import { isStandbyWorkspace, type Workspace } from './api'

interface Props {
  readonly workspace: Workspace | null | undefined
  readonly className?: string
}

/**
 * Non-intrusive top banner shown when inspecting a Standby workspace.
 * Explains that auto-scheduling is paused and global views exclude this
 * workspace, with one-click Activate and Absorb actions.
 */
export function StandbyWorkspaceBanner({ workspace, className = '' }: Props) {
  const { t } = useTranslation()
  let ctx: WorkspacesContextValue | null = null
  try {
    ctx = useWorkspaces()
  } catch {
    ctx = null
  }

  const activeTarget = useMemo(() => {
    if (!workspace || !ctx) return null
    const templateKey = workspace.template ?? 'chat'
    return (
      ctx.workspaces.find(
        (candidate) =>
          candidate.id !== workspace.id
          && (candidate.template ?? 'chat') === templateKey
          && !isStandbyWorkspace(candidate),
      )
      ?? ctx.workspaces.find(
        (candidate) => candidate.id !== workspace.id && !isStandbyWorkspace(candidate),
      )
      ?? null
    )
  }, [ctx, workspace])

  if (!workspace || !isStandbyWorkspace(workspace)) return null

  const activating = ctx?.activatingWorkspaceId === workspace.id

  return (
    <div
      role="status"
      data-testid="standby-workspace-banner"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-warning/25 bg-warning/8 px-4 py-2 text-[12px] leading-[18px] ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
        <PauseCircle
          size={14}
          strokeWidth={2.1}
          className="mt-0.5 shrink-0 text-warning sm:mt-0"
          aria-hidden="true"
        />
        <p className="min-w-0 text-foreground/90">
          <span className="font-semibold text-foreground">
            {t('workspace.activation.standbyBannerTitle')}
          </span>
          <span className="mx-1.5 text-muted-foreground" aria-hidden="true">·</span>
          <span className="text-muted-foreground">
            {t('workspace.activation.standbyBannerBody')}
          </span>
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {ctx?.requestActivateWorkspace && (
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={activating}
            onClick={() => void ctx.requestActivateWorkspace?.(workspace.id)}
            className="h-7 px-2.5 text-[11px]"
          >
            {activating
              ? <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Zap size={12} strokeWidth={2.2} aria-hidden="true" />}
            {activating ? t('workspace.activation.activating') : t('workspace.activation.activate')}
          </Button>
        )}
        {ctx && activeTarget && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={activating}
            onClick={() => ctx.openAgentConfig(activeTarget.id, undefined, 'absorb', workspace.id)}
            className="h-7 px-2.5 text-[11px]"
          >
            <GitMerge size={12} strokeWidth={2.1} aria-hidden="true" />
            {t('workspace.activation.absorbIntoActive')}
          </Button>
        )}
      </div>
    </div>
  )
}
