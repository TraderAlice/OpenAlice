import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, MessageSquarePlus, Settings } from 'lucide-react'

import { useWorkspaces } from '../../contexts/workspaces-context'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab } from '../../tabs/types'
import { workspaceDisplayTitle } from './display'
import { orderSessionsForSidebar } from './sidebar-order'
import { SessionRow } from './Sidebar'

const AUTO_QUANT_TEMPLATE = 'auto-quant-v2'
const SESSION_LIMIT = 8

export function AutoQuantWorkspaceSection({
  onNavigate = () => undefined,
}: {
  onNavigate?: () => void
}): ReactElement | null {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [showSettings, setShowSettings] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workspace = ctx.workspaces.find((candidate) =>
    candidate.id === ctx.autoQuantDefaultWorkspaceId
    && candidate.template === AUTO_QUANT_TEMPLATE)
  const alternatives = ctx.workspaces.filter((candidate) =>
    candidate.template === AUTO_QUANT_TEMPLATE && candidate.id !== workspace?.id)
  const sessions = useMemo(
    () => orderSessionsForSidebar(workspace?.sessions ?? []).slice(0, SESSION_LIMIT),
    [workspace?.sessions],
  )
  const activeSessionId = focused?.kind === 'workspace'
    && focused.params.source === 'auto-quant'
    && focused.params.wsId === workspace?.id
      ? focused.params.sessionId ?? null
      : null

  if (!workspace) return null

  const navigate = (target: Parameters<typeof openOrFocus>[0]) => {
    openOrFocus(target)
    onNavigate()
  }

  const switchDefault = async (workspaceId: string) => {
    setSwitchingId(workspaceId)
    setError(null)
    try {
      await ctx.setAutoQuantDefaultWorkspace(workspaceId)
      setShowSettings(false)
      navigate({ kind: 'auto-quant-landing', params: {} })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSwitchingId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-2 pb-2 pt-2">
        <button
          type="button"
          onClick={() => navigate({ kind: 'auto-quant-landing', params: {} })}
          className="oa-pressable flex w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:border-primary/45 hover:bg-primary/15"
        >
          <MessageSquarePlus size={15} strokeWidth={2.15} className="shrink-0 text-primary" />
          <span>{t('autoQuant.newResearch')}</span>
        </button>
      </div>

      <div className="px-3 pb-1 pt-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
          {t('autoQuant.recentResearch')}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {sessions.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground/60">
            {t('autoQuant.noResearchYet')}
          </p>
        ) : sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            isActive={activeSessionId === session.id}
            onSelect={() => navigate({
              kind: 'workspace',
              params: { wsId: workspace.id, sessionId: session.id, source: 'auto-quant' },
            })}
            onPause={() => void ctx.pauseSession(workspace.id, session.id)}
            onResume={() => {
              if (session.surface === 'webpi') {
                void ctx.openWebPiSession(workspace.id, session.id, 'auto-quant')
              } else {
                void ctx.resumeSession(workspace.id, session.id, 'auto-quant')
              }
              onNavigate()
            }}
            onDelete={() => ctx.requestDeleteSession(workspace.id, session.id)}
          />
        ))}
        {workspace.sessions.length > SESSION_LIMIT && (
          <button
            type="button"
            onClick={() => navigate({
              kind: 'workspace',
              params: { wsId: workspace.id, source: 'auto-quant' },
            })}
            className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {t('chat.viewAllSessions', { count: workspace.sessions.length })}
          </button>
        )}
      </div>

      <div className="border-t border-border/60 p-2">
        <button
          type="button"
          onClick={() => setShowSettings((visible) => !visible)}
          aria-expanded={showSettings}
          className="oa-pressable flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate">{t('autoQuant.workspaceSettings')}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSettings ? 'rotate-180' : ''}`} />
        </button>
        {showSettings && (
          <div className="oa-disclosure-enter mt-1 rounded-lg border border-border/70 bg-secondary/65 p-2">
            <p className="truncate px-1 text-xs font-medium text-foreground" title={workspaceDisplayTitle(workspace)}>
              {workspaceDisplayTitle(workspace)}
            </p>
            <div className="mt-2 space-y-1">
              <button
                type="button"
                onClick={() => ctx.openAgentConfig(workspace.id)}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('autoQuant.configureWorkspace')}
              </button>
              {alternatives.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={switchingId !== null}
                  onClick={() => void switchDefault(candidate.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t('autoQuant.useWorkspace', { workspace: workspaceDisplayTitle(candidate) })}
                  </span>
                  {switchingId === candidate.id && <Check className="h-3 w-3" />}
                </button>
              ))}
              <button
                type="button"
                onClick={() => navigate({ kind: 'workspace-list', params: {} })}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('autoQuant.manageWorkspaces')}
              </button>
            </div>
            {error && <p className="mt-2 px-1 text-[11px] text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
