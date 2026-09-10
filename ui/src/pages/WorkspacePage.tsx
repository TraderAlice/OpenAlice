/**
 * Single workspace/session detail page.
 *
 * Renders the launcher's WorkspaceView (terminal + files panel) bound
 * to whatever workspace+session this tab's spec points at:
 *
 *   { wsId }                — workspace selected, no session pinned: shows
 *                             the new-conversation composer for that workspace.
 *   { wsId, sessionId }     — session pinned: shows the terminal slot for
 *                             that session, with the workspace's files
 *                             panel alongside.
 *
 * Each session is its own tab; multiple session tabs for the same workspace
 * each carry their own WorkspaceView (with their own files polling).
 * Closing a tab via the X button does NOT terminate the session — the PTY
 * keeps running on the server. Use the sidebar's × to actually delete.
 */

import { useHarnessWorkbenchContext } from '../components/harness/context'
import { useEffect } from 'react'
import { ChevronDown, Unplug, Monitor, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@xterm/xterm/css/xterm.css'

import { useWorkspaces } from '../contexts/workspaces-context'
import { useWorkspaceSessionData } from '../hooks/useWorkspaceData'
import { useWorkspace } from '../tabs/store'
import { agentSupportsWeb } from '../components/workspace/api'
import { workspaceDisplayName, workspaceDisplayTitle } from '../components/workspace/display'
import { HarnessLandingPage } from './ChatLandingPage'
import { WorkspaceView } from '../components/workspace/WorkspaceView'
import { PageTopBar } from '../components/PageTopBar'
import { WorkspaceFilesToggle } from '../components/workspace/WorkspaceFilesToggle'
import { Button } from '../components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui/dropdown-menu'
import { AgentRuntimeIcon } from '../lib/agentRuntimeIcon'
import type { ViewSpec } from '../tabs/types'

interface Props {
  spec: Extract<ViewSpec, { kind: 'workspace' }>
  visible: boolean
}

export function WorkspacePage({ spec, visible }: Props) {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const workbench = useHarnessWorkbenchContext()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const wsId = spec.params.wsId
  const sessionId = spec.params.sessionId ?? null
  const source = spec.params.source
  const {
    workspace,
    session: activeRecord,
    updateRuntime,
    loading,
    error: loadError,
  } = useWorkspaceSessionData(wsId, sessionId)
  const effectiveDefaultAgent = workspace?.defaultAgent ?? ctx.defaultAgent
  const defaultAgentEnabled =
    effectiveDefaultAgent !== null &&
    effectiveDefaultAgent !== undefined &&
    ctx.agents.some((a) => a.id === effectiveDefaultAgent && a.kind !== 'utility')

  const spawnDefault = (): void => {
    if (defaultAgentEnabled && effectiveDefaultAgent) {
      void ctx.spawn(wsId, { agent: effectiveDefaultAgent }, source)
      return
    }
    // The old header dropdown duplicated the global New chat flow and left a
    // second, stale session-creation surface in every Workspace. When no
    // default runtime is configured, take the remaining empty-state/shortcut
    // entry points to the targeted composer, which owns runtime + credential
    // selection.
    openOrFocus({
      kind: source === 'auto-quant'
        ? 'auto-quant-landing'
        : source === 'prediction' ? 'auto-prediction-landing' : 'chat-landing',
      params: { targetWsId: wsId },
    })
  }

  // Cmd+T / Ctrl+T: spawn fresh session in this workspace; only when this
  // tab is visible, to avoid double-spawns when multiple workspace tabs are
  // open.
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 't' && e.key !== 'T') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      spawnDefault()
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [visible, ctx, wsId, defaultAgentEnabled, effectiveDefaultAgent])

  if (!workspace) {
    return (
      <div className="workspaces-root flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
        {loadError ?? (loading ? t('workspace.sessionOpening') : t('workspace.notFound'))}
      </div>
    )
  }

  if (sessionId && !activeRecord) return (
    <div role={loading ? 'status' : 'alert'} className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {loadError ?? (loading ? t('workspace.sessionOpening') : t('workspace.sessionNotFound'))}
    </div>
  )

  const workspaceName = workspaceDisplayName(workspace)
  const hasCustomName = workspaceName !== workspace.tag
  const terminalCanvas =
    activeRecord?.state === 'running' &&
    (activeRecord.surface ?? 'terminal') === 'terminal'
  const pausedCanvas = activeRecord?.state === 'paused'
  const webCanvas = activeRecord?.state === 'running' && activeRecord.surface === 'webpi'
  const workspaceCanvas = terminalCanvas || pausedCanvas
  // The surface toggle is offered only for runtimes that expose a structured
  // protocol; a TUI-only runtime keeps its terminal without a dead button.
  const canSwitchSurface = activeRecord?.state === 'running' && activeRecord.surface !== 'headless'
    && (webCanvas || agentSupportsWeb(ctx.agents, activeRecord.agent))
  const runtimeLabel = activeRecord
    ? ctx.agents.find((agent) => agent.id === activeRecord.agent)?.displayName ?? activeRecord.agent
    : ''
  const workspaceActions = (
    <>
      {!workbench && activeRecord && canSwitchSurface && (
        <Button
          type="button"
          onClick={() => {
            if (webCanvas) {
              void ctx.resumeSession(wsId, activeRecord.id, source)
            } else {
              void ctx.openWebSession(wsId, activeRecord.id, source)
            }
          }}
          variant="ghost"
          size="sm"
          className="text-[11px]"
          title={webCanvas ? `Open this ${runtimeLabel} Session in the terminal` : `Open this ${runtimeLabel} Session in Web`}
        >
          {webCanvas
            ? <Monitor size={13} strokeWidth={2.25} aria-hidden="true" />
            : <AgentRuntimeIcon agentId={activeRecord.agent} className="h-[13px] w-[13px]" />}
          {webCanvas ? 'Open TUI' : 'Web Beta'}
        </Button>
      )}
      {activeRecord && (terminalCanvas || webCanvas) && <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t('workspace.interactiveOwnership.actions')}><ChevronDown size={14} /></Button>} />
        <DropdownMenuContent align="end" className="min-w-64">
          <DropdownMenuItem onClick={() => void ctx.pauseSession(wsId, activeRecord.id)}>
            <Unplug size={14} />{t('workspace.interactiveOwnership.disconnect')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
      <WorkspaceFilesToggle />
      {!workbench && <Button
        type="button"
        onClick={() => ctx.openAgentConfig(wsId)}
        variant="ghost"
        size="sm"
        className="text-[11px]"
        title={t('workspace.configure')}
      >
        <Settings size={13} aria-hidden />
        {t('workspace.settings')}
      </Button>}
    </>
  )

  if (!sessionId) return (
    <div className="workspaces-root workspace-page-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PageTopBar title={workspaceName} titleHint={workspaceDisplayTitle(workspace)} actions={workspaceActions}>
        {hasCustomName && <span className="hidden font-mono text-[10px] text-muted-foreground/70 sm:inline">{workspace.tag}</span>}
      </PageTopBar>
      <HarnessLandingPage key={wsId} mode={source ?? 'chat'} spec={{ params: { targetWsId: wsId } }} showHeader={false} />
    </div>
  )

  return (
    <div className={`workspaces-root workspace-page-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${terminalCanvas ? ' is-terminal-canvas' : ''}${pausedCanvas ? ' is-paused-canvas' : ''}`}>
      {/* Running renderers fill the shared header slot with session identity
       * and these actions. Paused sessions own their header here. */}
      {!terminalCanvas && !webCanvas && (
        <PageTopBar title={workspaceName} titleHint={workspaceDisplayTitle(workspace)} actions={workspaceActions}>
            {hasCustomName && (
              <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/70 sm:inline">
                {workspace.tag}
              </span>
            )}
        </PageTopBar>
      )}

      <div className={`flex min-h-0 min-w-0 flex-1 flex-col${workspaceCanvas ? '' : ' p-3'}`}>
        <WorkspaceView
          visible={visible}
          wsId={wsId}
          sessionId={sessionId}
          {...(source ? { source } : {})}
          activeRecord={activeRecord}
          agents={ctx.agents}
          label={workspaceName}
          terminalHeaderActions={terminalCanvas || webCanvas ? workspaceActions : undefined}
          onResume={(id) => ctx.resumeSession(wsId, id, source)}
          onUpdateSessionRuntime={(_id, update) => updateRuntime(update).then(() => undefined)}
          onSaveSessionDisplayName={(resumeId, displayName) => (
            ctx.setSessionDisplayName(wsId, resumeId, displayName)
          )}
          onOpenWeb={(id) => ctx.openWebSession(wsId, id, source)}
          onSessionLost={() => {
            // 4404 from the WS upgrade — the session is gone server-side.
            // Refresh the list; the reconcile effect will close this tab.
            void ctx.refresh()
          }}
        />
      </div>
    </div>
  )
}
