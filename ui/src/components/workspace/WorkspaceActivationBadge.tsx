import { useTranslation } from 'react-i18next'

import { isStandbyWorkspace, type Workspace } from './api'

interface Props {
  readonly workspace: Pick<Workspace, 'activationState'>
  readonly size?: 'xs' | 'sm'
  readonly className?: string
}

/**
 * Subtle pill indicating whether a Workspace currently occupies its template's
 * active slot or is in Standby mode. Missing/undefined `activationState` is
 * treated as `'active'` for backwards compatibility.
 */
export function WorkspaceActivationBadge({
  workspace,
  size = 'sm',
  className = '',
}: Props) {
  const { t } = useTranslation()
  const standby = isStandbyWorkspace(workspace)
  const sizeClass = size === 'xs'
    ? 'px-1.5 py-0 text-[10px] leading-[15px]'
    : 'px-2 py-0.5 text-[10px] leading-[14px]'
  const toneClass = standby
    ? 'border-border bg-muted/65 text-muted-foreground'
    : 'border-success/35 bg-success/10 text-success'

  return (
    <span
      data-activation-state={standby ? 'standby' : 'active'}
      className={`inline-flex shrink-0 items-center rounded-full border font-medium ${sizeClass} ${toneClass} ${className}`.trim()}
    >
      {t(standby ? 'workspace.activation.standbyBadge' : 'workspace.activation.activeBadge')}
    </span>
  )
}
