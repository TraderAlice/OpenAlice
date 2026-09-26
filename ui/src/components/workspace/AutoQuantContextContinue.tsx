import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import type { ConversationItem } from '../conversation/types'
import type { AgentInfo, SessionRecord, WebSessionPhase } from './api'
import { agentSupportsWeb, getWebSession, promptWebSession, readWorkspaceFile } from './api'
import { ContextContinuePanel } from './ContextContinueDialog'
import { runArchiveAndContinue, shouldOfferContextContinue } from './archive-and-continue'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { useWorkspace } from '../../tabs/store'
import type { WorkspaceSource } from '../../tabs/types'
import './context-continue.css'

export function AutoQuantContextContinueController(props: {
  readonly wsId: string
  readonly sessionId: string
  readonly source: Extract<WorkspaceSource, 'auto-quant'>
  readonly record: SessionRecord
  readonly agents?: readonly AgentInfo[]
  readonly items: readonly ConversationItem[]
  readonly phase?: WebSessionPhase
  readonly label?: string
  readonly turnBusy: boolean
  readonly children: (ui: {
    readonly headerAction: ReactNode
    readonly panel: ReactNode
  }) => ReactNode
}): React.ReactElement {
  const { t } = useTranslation()
  const workspaces = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const dockAnchorRef = useRef<HTMLSpanElement>(null)
  const pulseTimer = useRef<number | undefined>(undefined)
  const [continueOpen, setContinueOpen] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  const [continueBusy, setContinueBusy] = useState(false)
  const [dockPulse, setDockPulse] = useState(false)
  const autoOffered = useRef(false)

  useEffect(() => () => {
    if (pulseTimer.current !== undefined) window.clearTimeout(pulseTimer.current)
  }, [])

  const offerContinue = shouldOfferContextContinue({
    source: props.source,
    phase: props.phase,
    items: props.items,
    sessionId: props.sessionId,
  })

  useEffect(() => {
    if (!offerContinue || autoOffered.current || continueOpen) return
    autoOffered.current = true
    setContinueOpen(true)
  }, [offerContinue, continueOpen])

  const pulseDock = () => {
    setDockPulse(true)
    if (pulseTimer.current !== undefined) window.clearTimeout(pulseTimer.current)
    pulseTimer.current = window.setTimeout(() => setDockPulse(false), 900)
  }

  const confirmContinue = async (consensus: string) => {
    setContinueBusy(true)
    setContinueError(null)
    try {
      await runArchiveAndContinue({
        workspaceId: props.wsId,
        resumeId: props.record.resumeId,
        title: props.record.displayName?.trim() || props.record.title?.trim() || props.label || props.record.name,
        session: {
          id: props.record.id,
          state: props.record.state,
          surface: props.record.surface,
          agent: props.record.agent,
        },
      }, {
        supportsWeb: agentSupportsWeb(props.agents, props.record.agent),
        openWebSession: (id, sid) => workspaces.openWebSession(id, sid, props.source),
        promptWebSession,
        getWebSession,
        readWorkspaceFile,
        pauseSession: workspaces.pauseSession,
        setSessionPresence: workspaces.setSessionPresence,
        openLanding: (initialPrompt) => {
          openOrFocus({
            kind: 'auto-quant-landing',
            params: { targetWsId: props.wsId, initialPrompt },
          })
        },
        consensus,
      })
    } catch (error) {
      setContinueError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setContinueBusy(false)
    }
  }

  return <>{props.children({
    headerAction: (
      <span
        ref={dockAnchorRef}
        className={`oa-context-continue-dock-anchor${dockPulse ? ' oa-context-continue-dock-pulse' : ''}`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-[11px]"
          data-oa-context-continue-dock=""
          onClick={() => setContinueOpen(true)}
        >
          {t('contextContinue.offerAction')}
        </Button>
      </span>
    ),
    panel: (
      <ContextContinuePanel
        open={continueOpen}
        sessionId={props.sessionId}
        items={props.items}
        busy={continueBusy || props.turnBusy}
        error={continueError}
        dockAnchorRef={dockAnchorRef}
        onDismissDocked={pulseDock}
        onOpenChange={setContinueOpen}
        onConfirm={confirmContinue}
      />
    ),
  })}</>
}

