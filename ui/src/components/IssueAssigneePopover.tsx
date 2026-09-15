import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare } from 'lucide-react'
import { IssueAssigneeAvatar } from './IssueAssigneeAvatar'
import type { IssueAutomationHealth, IssueAutomationHealthState } from '../api/issues'
import { issuesApi } from '../api/issues'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { useWorkspaceSessionDirectory } from '../hooks/useWorkspaceSessionDirectory'
import { useWorkspaces } from '../contexts/workspaces-context'
import { AssigneeEditor } from './IssueAssigneeEditor'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const HEALTH_DOT: Record<IssueAutomationHealthState, string> = {
  inactive: 'bg-muted-foreground', not_started: 'bg-muted-foreground',
  due: 'bg-warning', running: 'bg-info', healthy: 'bg-success',
  interrupted: 'bg-warning', failed: 'bg-destructive', blocked: 'bg-destructive',
}

export function IssueAssigneePopover({ wsId, id, assignee, health }: { wsId: string; id: string; assignee: string; health?: IssueAutomationHealth }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [currentAssignee, setCurrentAssignee] = useState(assignee)
  useEffect(() => setCurrentAssignee(assignee), [wsId, id, assignee])
  const bound = currentAssignee.startsWith('@resume-')
  const human = currentAssignee === '@human'
  const eachRun = currentAssignee === '@new-each-run'
  const newSession = currentAssignee === '@new-then-resume'
  const description = bound ? t('issues.detail.signedSession', { resumeId: currentAssignee.slice(1) })
    : human ? t('issues.detail.human')
    : eachRun ? t('issues.detail.assigneeWorkspaceScheduled')
    : newSession ? t('issues.detail.assigneeNew')
    : t('issues.detail.unassigned')
  const label = [t('issues.detail.assignee'), health && t(`issues.health.${health.state}`)].filter(Boolean).join(' · ')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={label} aria-description={description} title={[description, health && `${t(`issues.health.${health.state}`)} — ${health.message}`].filter(Boolean).join(" · ")} className="relative flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <IssueAssigneeAvatar value={currentAssignee} />
        {health && <span aria-hidden className={`absolute right-0.5 top-0.5 size-2 rounded-full ring-2 ring-background ${HEALTH_DOT[health.state]}`} />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        {open && <AssigneeContent wsId={wsId} id={id} onAssigned={setCurrentAssignee} />}
      </PopoverContent>
    </Popover>
  )
}

function AssigneeContent({ wsId, id, onAssigned }: { wsId: string; id: string; onAssigned: (assignee: string) => void }) {
  const { t } = useTranslation()
  const { data, error, mutate } = useIssueDetail(wsId, id)
  const { directory, loading, error: directoryError } = useWorkspaceSessionDirectory(wsId)
  const { openHeadlessRun } = useWorkspaces()
  const [actionError, setActionError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  if (!data) return <p className="p-4 text-sm text-muted-foreground" role={error ? 'alert' : 'status'}>{error || t('common.loading')}</p>
  const owner = data.assigneeSession
  const concrete = data.issue.assignee.startsWith('@resume-')
  const ready = concrete && owner?.state === 'ready' && owner.workspace
  const policy = data.issue.assignee === '@new-each-run' ? t('issues.detail.assigneeEachDescription')
    : data.issue.assignee === '@new-then-resume' ? t('issues.detail.assigneeNewDescription')
    : data.issue.assignee === '@human' ? t('issues.detail.assigneeHumanDescription')
    : t('issues.detail.assigneeUnassignedDescription')
  const openConversation = async () => {
    if (!ready || opening) return
    setOpening(true)
    setActionError(null)
    try {
      await openHeadlessRun(owner.workspace!.id, owner.resumeId, { title: owner.displayName || data.issue.title })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }
  return (
    <>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">{t('issues.detail.assignee')}</p>
        {data.issue.automationHealth && <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-medium"><span aria-hidden className={`size-2 rounded-full ${HEALTH_DOT[data.issue.automationHealth.state]}`} />{t(`issues.health.${data.issue.automationHealth.state}`)}</p>
          <p className="text-xs text-muted-foreground">{data.issue.automationHealth.message}</p>
        </div>}
        {concrete ? <>
          <p className="break-words text-sm font-medium">{owner?.displayName || data.issue.assignee.slice(1)}</p>
          {ready ? <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">{t('issues.detail.runtime')}</dt><dd className="truncate">{owner.agent || '—'}</dd>
              <dt className="text-muted-foreground">{t('issues.detail.model')}</dt><dd className="truncate" title={owner.runtime?.model}>{owner.runtime?.model || '—'}</dd>
              <dt className="text-muted-foreground">{t('issues.detail.effort')}</dt><dd>{owner.runtime?.reasoningEffort || '—'}</dd>
              <dt className="text-muted-foreground">{t('issues.detail.credential')}</dt><dd className="truncate">{owner.runtime?.credentialSlug || owner.runtime?.credentialSource || '—'}</dd>
            </dl>
            <Button variant="outline" className="w-full" disabled={opening} onClick={() => void openConversation()}>
              <MessageSquare size={14} aria-hidden />{t('issues.detail.openConversation')}
            </Button>
          </> : <p className="text-xs text-muted-foreground">{t('issues.detail.sessionUnavailable')}</p>}
        </> : <p className="text-sm text-muted-foreground">{policy}</p>}
      </div>
      <div className="border-t border-border p-3">
        <AssigneeEditor triggerLabel={t('issues.detail.chooseAssignee')} value={data.issue.assignee} scheduled={Boolean(data.issue.when)} sessions={directory?.sessions ?? []} authoritativeOwner={owner} error={actionError} disabled={loading || Boolean(directoryError)} onChange={async (assignee) => {
          setActionError(null)
          try {
            const next = await issuesApi.update(wsId, id, { assignee })
            mutate(next)
            onAssigned(next.issue.assignee)
            return true
          } catch (e) {
            setActionError(e instanceof Error ? e.message : String(e))
            return false
          }
        }} />
        {(actionError || directoryError || error) && <p role="alert" className="mt-2 text-xs text-destructive">{actionError || directoryError || error}</p>}
      </div>
    </>
  )
}
