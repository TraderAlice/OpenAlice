import { parseMarketReference } from '@traderalice/connector-protocol'
import { ConversationImagePreview } from '../conversation/ConversationImagePreview'
import { useConversationFiles } from '../../hooks/useConversationFiles'
import { useHarnessWorkbench } from '../../live/harness-workbench'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { PageTopBar } from '../PageTopBar'
import { ConversationView } from '../conversation/ConversationView'
import { ConversationRequestCard, type ConversationRequest } from '../conversation/ConversationRequestCard'
import { WebSessionComposer } from './WebSessionComposer'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import type { AgentInfo, SessionRecord, WebPermissionRequest, WebSessionPhase } from './api'
import { useWebConversation } from './useWebConversation'
import { summarizeToolInput } from './web-transcript'

export { isConversationNearBottom as isWebSessionNearBottom } from '../conversation/ConversationView'

interface Props {
  readonly readOnly?: boolean
  readonly record?: SessionRecord
  readonly wsId: string
  readonly sessionId: string
  /** Runtime id of the Session; the snapshot confirms it once loaded. */
  readonly agent?: string
  readonly agents?: readonly AgentInfo[]
  readonly label?: string
  readonly headerActions?: ReactNode
  readonly onSessionLost: () => void
}

/**
 * Browser conversation surface for any runtime that speaks a structured
 * protocol. The runtime and its wire are presentation facts here: copy adapts
 * to them, but the view never touches the protocol itself.
 */
export function WebSessionView(props: Props) {
  return <WebSession key={JSON.stringify([props.wsId, props.sessionId])} {...props} />
}

function WebSession({ readOnly = false, record, wsId, sessionId, agent, agents, label, headerActions, onSessionLost }: Props) {
  const [configurationReady, setConfigurationReady] = useState(true)
  const session = useWebConversation(wsId, sessionId, readOnly)
  const { snapshot, busy, requests } = session
  const openFile = useCallback((path: string) => {
    if (import.meta.env.VITE_DEMO_MODE && path === 'demo/autoquant-studio.html') {
      useHarnessWorkbench.getState().openTab(wsId, { id: 'studio', kind: 'studio' })
      return
    }
    const market = parseMarketReference(path)
    useHarnessWorkbench.getState().openTab(wsId, market
      ? { id: path, kind: 'market', ...market }
      : { id: `file:${path}`, kind: 'file', path })
  }, [wsId])
  const files = useConversationFiles(wsId, session.items, !!snapshot && snapshot.phase !== 'starting', openFile)
  const agentId = snapshot?.agent ?? agent ?? 'agent'
  const agentLabel = agents?.find((entry) => entry.id === agentId)?.displayName ?? fallbackAgentLabel(agentId)
  const activeRequest = useMemo(() => requests[0] ? presentRequest(requests[0]) : null, [requests])
  const phaseLabel = snapshot ? describePhase(snapshot.phase) : 'starting'
  const stopped = snapshot?.phase === 'stopped'

  return <>
    <ConversationView
      header={<PageTopBar title={label ?? 'Conversation'} actions={<>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={agentLabel} aria-label={agentLabel}>
          <AgentRuntimeIcon agentId={agentId} className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{agentLabel}</span>
        </span>
        {headerActions}
      </>}>
        {(busy || !snapshot || snapshot.phase === 'failed') && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {(busy || !snapshot) && <LoaderCircle size={12} className="animate-spin" aria-hidden />}
          {phaseLabel}
        </span>}
      </PageTopBar>}
      fileHrefs={files.fileHrefs}
      onFileReference={files.onFileReference}
      items={session.items}
      revision={snapshot?.revision ?? 0}
      busy={!readOnly && busy}
      ready={!readOnly && !!snapshot && snapshot.phase !== 'failed' && snapshot.phase !== 'starting' && !stopped && !session.reconfiguring && configurationReady}
      placeholder={`Message ${agentLabel}…`}
      empty={snapshot ? 'What should Alice work on next?' : 'Opening conversation…'}
      renderComposer={record && agents ? composer => <WebSessionComposer composer={composer} workspaceId={wsId} record={record} agents={agents}
        busy={readOnly || busy || session.reconfiguring || !snapshot || snapshot.phase === 'starting'} reconfigure={session.reconfigure} onReadyChange={setConfigurationReady} /> : undefined}
      status={<>
        {session.reconfiguring && <div role="status" className="px-3 py-1 text-xs text-muted-foreground">Applying AI configuration…</div>}

        {snapshot?.phase === 'compacting' && <div className="conversation-compaction-status" role="status">
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          <div><strong>Compacting conversation context</strong><span>{agentLabel} is summarizing older history. Sending will resume when the compact finishes.</span></div>
        </div>}
        {!readOnly && activeRequest && <ConversationRequestCard
          key={activeRequest.id}
          request={activeRequest}
          queued={requests.length - 1}
          respond={session.respond}
        />}
      </>}
      error={readOnly ? null : session.error ?? (stopped ? 'This session has stopped. Refresh the session to reconnect.' : null)}
      send={session.send}
      stop={session.stop}
      stopLabel={`Stop ${agentLabel}`}
      retry={() => void session.refresh()}
      recover={onSessionLost}
    />
    <ConversationImagePreview image={files.imagePreview} onClose={files.closeImage} />
  </>
}

function presentRequest(request: WebPermissionRequest): ConversationRequest {
  return {
    id: request.id,
    kind: request.kind,
    title: request.title,
    ...(request.description ? { description: request.description } : {}),
    ...(request.tool ? {
      tool: {
        name: request.tool.name,
        summary: summarizeToolInput(request.tool.name, request.tool.input),
        input: JSON.stringify(request.tool.input, null, 2) ?? '',
      },
    } : {}),
    options: request.options,
    allowText: request.allowText,
    secret: request.secret,
  }
}

function describePhase(phase: WebSessionPhase): string {
  return phase === 'awaiting-input' ? 'waiting for you' : phase
}

function fallbackAgentLabel(agentId: string): string {
  switch (agentId) {
    case 'claude': return 'Claude Code'
    case 'codex': return 'Codex'
    case 'cursor': return 'Cursor Agent'
    case 'grok': return 'Grok Build'
    case 'omp': return 'Oh My Pi'
    case 'opencode': return 'opencode'
    case 'pi': return 'Pi'
    default: return agentId
  }
}
