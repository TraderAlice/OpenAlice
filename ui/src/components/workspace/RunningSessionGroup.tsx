import { useEffect, useState } from 'react'
import { ChevronRight, Info, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarChildRow, SidebarChildRowButton } from '../SidebarChildRow'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import { SidebarActionMenu } from './SidebarActionMenu'
import type { HarnessSession } from './harness-sessions'
import { useSessionDetailsDialog } from './session-details-store'

function runningDuration(startedAt: number | undefined, now: number): string | null {
  if (!startedAt || !Number.isFinite(startedAt)) return null
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ${String(Math.floor((seconds % 86_400) / 3600)).padStart(2, '0')}h`
  const minutes = Math.floor(seconds / 60)
  const clock = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return minutes < 60 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(minutes / 60)}:${clock}`
}

/** One operational group, with a visible parent/child relationship in every Harness. */
export function RunningSessionGroup({ sessions, onSelect }: {
  sessions: readonly HarnessSession[]
  onSelect(session: HarnessSession): void
}) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (sessions.length === 0) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [sessions.length])
  if (sessions.length === 0) return null
  const label = t('workspace.sessionBusy.runningCount', { count: sessions.length })
  const focusClass = 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring'
  return <Collapsible>
    <SidebarChildRow active={false} className={focusClass}>
      <CollapsibleTrigger render={<SidebarChildRowButton
        className="group/running text-muted-foreground"
        icon={<LoaderCircle size={14} aria-hidden className="animate-spin [animation-duration:2s] motion-reduce:animate-none" />}
      />}>
        <span className="min-w-0 flex-1 truncate tabular-nums">{label}</span>
        <ChevronRight size={14} aria-hidden className="shrink-0 transition-transform group-data-[panel-open]/running:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
    </SidebarChildRow>
    <CollapsibleContent>
      <div className="mb-1 ml-[22px] mr-1.5 max-h-[40dvh] overflow-y-auto overscroll-contain border-l border-sidebar-foreground/15 py-0.5 pl-1"
        role="group" aria-label={label}>
        {sessions.map(row => {
          const execution = row.directory?.latestExecution
          const elapsed = execution?.status === 'running' ? runningDuration(execution.startedAt, now) : null
          return <SidebarChildRow key={row.resumeId} active={false} className={`${focusClass} oa-session-row`}>
            <SidebarChildRowButton onClick={() => onSelect(row)} aria-label={row.title}
              aria-description={elapsed ? `${t('workspace.sessionBusy.duration')} ${elapsed}` : undefined}
              icon={<AgentRuntimeIcon agentId={row.session.agent} className="h-4 w-4" />}>
              <span className="min-w-0 flex-1 truncate" title={row.title}>{row.title}</span>
              {elapsed && <span aria-hidden className="oa-session-state-action shrink-0 tabular-nums text-xs text-muted-foreground">{elapsed}</span>}
            </SidebarChildRowButton>
            <span className="oa-session-overflow-action flex shrink-0">
              <SidebarActionMenu label={t('common.moreActions', { target: row.title })} items={[{
                label: t('workspace.sessionDetails.title'), icon: <Info size={13} />,
                onSelect: () => useSessionDetailsDialog.getState().show({ ...row.session, title: row.title }),
              }]} />
            </span>
          </SidebarChildRow>
        })}
      </div>
    </CollapsibleContent>
  </Collapsible>
}
