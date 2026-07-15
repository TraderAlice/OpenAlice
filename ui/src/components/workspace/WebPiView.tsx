import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronRight, CircleAlert, CircleDashed, LoaderCircle, Send, Square } from 'lucide-react'

import { MarkdownContent } from '../MarkdownContent'
import {
  abortWebPiSession,
  getWebPiSession,
  promptWebPiSession,
  type WebPiSnapshot,
} from './api'
import {
  activityToolLabel,
  contentText,
  groupWebPiTranscript,
  summarizeToolInput,
  type WebPiActivity,
  type WebPiToolStep,
  type WebPiTranscriptItem,
} from './webpi-transcript'

const FOLLOW_LATEST_THRESHOLD_PX = 72

export function isWebPiNearBottom(
  metrics: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  threshold = FOLLOW_LATEST_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

interface Props {
  readonly wsId: string
  readonly sessionId: string
  readonly label?: string
  readonly onSessionLost: () => void
}

/** A thin browser renderer over Pi's own RPC messages. Pi remains responsible
 * for the conversation schema and JSONL persistence; this component does not
 * introduce an OpenAlice message model. */
export function WebPiView({ wsId, sessionId, label, onSessionLost }: Props): ReactElement {
  const [snapshot, setSnapshot] = useState<WebPiSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [followingLatest, setFollowingLatest] = useState(true)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef<WebPiSnapshot | null>(null)
  const followLatestRef = useRef(true)

  const acceptSnapshot = useCallback((next: WebPiSnapshot): void => {
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await getWebPiSession(wsId, sessionId, snapshotRef.current?.revision)
      if (next) acceptSnapshot(next)
      setError(next?.error ?? null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [acceptSnapshot, sessionId, wsId])

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    const loop = async (): Promise<void> => {
      await refresh()
      if (cancelled) return
      const phase = snapshotRef.current?.phase
      const delay = phase === 'working' || phase === 'compacting' || phase === 'retrying'
        ? 350
        : 1_500
      timer = window.setTimeout(() => void loop(), delay)
    }
    void loop()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [refresh])

  const messages = useMemo(() => {
    if (!snapshot) return []
    return snapshot.streamingMessage
      ? [...snapshot.messages, snapshot.streamingMessage]
      : [...snapshot.messages]
  }, [snapshot])
  const transcript = useMemo(() => groupWebPiTranscript(messages), [messages])

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const scroller = scrollerRef.current
    if (!scroller) return
    followLatestRef.current = true
    setFollowingLatest(true)
    scroller.scrollTo({ top: scroller.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    if (followLatestRef.current) scrollToLatest('auto')
  }, [scrollToLatest, snapshot?.revision, transcript.length])

  const working = snapshot?.phase === 'working' || snapshot?.phase === 'compacting' || snapshot?.phase === 'retrying'

  const submit = async (): Promise<void> => {
    const message = draft.trim()
    if (!message || working) return
    followLatestRef.current = true
    setFollowingLatest(true)
    setDraft('')
    setError(null)
    try {
      acceptSnapshot(await promptWebPiSession(wsId, sessionId, message))
    } catch (err) {
      setDraft(message)
      setError((err as Error).message)
    }
  }

  const abort = async (): Promise<void> => {
    try {
      acceptSnapshot(await abortWebPiSession(wsId, sessionId))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="webpi-shell">
      <header className="webpi-header">
        <div>
          <div className="webpi-title">{label ?? 'Pi'} <span>WebPi · Beta</span></div>
          <div className="webpi-subtitle">Same Pi session · browser surface</div>
        </div>
        <div className={`webpi-phase is-${snapshot?.phase ?? 'starting'}`}>
          {(working || !snapshot) && <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />}
          {snapshot?.phase ?? 'starting'}
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="webpi-messages"
        onScroll={(event) => {
          const follows = isWebPiNearBottom(event.currentTarget)
          followLatestRef.current = follows
          setFollowingLatest(follows)
        }}
      >
        {messages.length === 0 && !error && (
          <div className="webpi-empty">This Pi conversation is ready in the browser.</div>
        )}
        {transcript.map((item, index) => (
          <PiTranscriptItem
            key={item.key}
            item={item}
            working={working && index === transcript.length - 1}
          />
        ))}
        {error && (
          <div className="webpi-error">
            <strong>WebPi could not continue.</strong>
            <span>{error}</span>
            <button type="button" onClick={() => { setError(null); void refresh() }}>Retry</button>
            <button type="button" onClick={onSessionLost}>Refresh session</button>
          </div>
        )}
      </div>

      {!followingLatest && (
        <button type="button" className="webpi-jump-latest" onClick={() => scrollToLatest()}>
          Jump to latest
        </button>
      )}

      <div className="webpi-composer-wrap">
        <div className="webpi-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="Message Pi…"
            rows={1}
            disabled={!snapshot || snapshot.phase === 'failed'}
          />
          {working ? (
            <button type="button" className="webpi-send" onClick={() => void abort()} aria-label="Stop Pi">
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="webpi-send" onClick={() => void submit()} disabled={!draft.trim()} aria-label="Send message">
              <Send size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="webpi-composer-hint">Enter to send · Shift+Enter for a new line</div>
      </div>
    </div>
  )
}

function PiTranscriptItem({
  item,
  working,
}: {
  readonly item: WebPiTranscriptItem
  readonly working: boolean
}): ReactElement {
  if (item.kind === 'user') {
    return (
      <article className="webpi-message is-user">
        <div className="webpi-message-body"><PiContent value={item.content} /></div>
      </article>
    )
  }
  if (item.kind === 'unknown') {
    return (
      <article className="webpi-message is-assistant">
        <div className="webpi-message-body"><PiContent value={item.value} /></div>
      </article>
    )
  }
  return (
    <article className="webpi-message is-assistant is-turn">
      <div className="webpi-message-body">
        {item.progress.map((text, index) => (
          <div key={index} className="webpi-progress-text"><MarkdownContent text={text} /></div>
        ))}
        {item.activity && <PiActivityGroup activity={item.activity} working={working} />}
        {item.final && <div className="webpi-final-text"><MarkdownContent text={item.final} /></div>}
      </div>
    </article>
  )
}

function PiActivityGroup({ activity, working }: { readonly activity: WebPiActivity; readonly working: boolean }): ReactElement {
  const failedCount = activity.steps.filter((step) => step.status === 'failed').length
  const running = activity.steps.some((step) => step.status === 'running')
  const thinkingCount = activity.thinking.length
    + activity.steps.reduce((count, step) => count + step.thinking.length, 0)
  const [open, setOpen] = useState(failedCount > 0)

  useEffect(() => {
    if (failedCount > 0) setOpen(true)
  }, [failedCount])

  const title = failedCount > 0
    ? `${failedCount} failed`
    : running ? (working ? 'Working' : 'Incomplete')
      : activity.steps.length > 0 ? `${activity.steps.length} action${activity.steps.length === 1 ? '' : 's'}`
        : 'Reasoning'
  const tools = activityToolLabel(activity.steps)
  const detail = tools || (thinkingCount > 0 ? `${thinkingCount} note${thinkingCount === 1 ? '' : 's'}` : 'Details')

  return (
    <details
      className={`webpi-activity${failedCount > 0 ? ' is-error' : ''}${running ? ' is-running' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="webpi-activity-status" aria-hidden="true">
          {failedCount > 0
            ? <CircleAlert size={14} />
            : running
              ? working ? <LoaderCircle size={14} className="animate-spin" /> : <CircleDashed size={14} />
              : <Check size={14} />}
        </span>
        <span className="webpi-activity-title">{title}</span>
        <span className="webpi-activity-meta">{detail}</span>
        <ChevronRight size={14} className="webpi-disclosure" aria-hidden="true" />
      </summary>
      <div className="webpi-activity-body">
        {activity.steps.map((step) => <PiToolStepView key={step.id} step={step} working={working} />)}
        {activity.thinking.length > 0 && (
          <PiReasoning notes={activity.thinking} label="Final reasoning" />
        )}
        {activity.unknownParts.length > 0 && (
          <details className="webpi-reasoning">
            <summary>Raw events · {activity.unknownParts.length}</summary>
            <pre>{JSON.stringify(activity.unknownParts, null, 2)}</pre>
          </details>
        )}
      </div>
    </details>
  )
}

function PiToolStepView({ step, working }: { readonly step: WebPiToolStep; readonly working: boolean }): ReactElement {
  const failed = step.status === 'failed'
  const [open, setOpen] = useState(failed)
  const summary = summarizeToolInput(step.name, step.input)
  const resultChars = step.result === undefined ? null : contentText(step.result).length

  useEffect(() => {
    if (failed) setOpen(true)
  }, [failed])

  return (
    <details
      className={`webpi-tool-step is-${step.status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="webpi-step-status" aria-hidden="true">
          {failed
            ? <CircleAlert size={13} />
            : step.status === 'running'
              ? working ? <LoaderCircle size={13} className="animate-spin" /> : <CircleDashed size={13} />
              : <Check size={13} />}
        </span>
        <code>{step.name}</code>
        <span className="webpi-step-summary">{summary ?? (step.status === 'running' ? 'Running…' : 'Completed')}</span>
        {resultChars !== null && <span className="webpi-step-size">{formatChars(resultChars)}</span>}
        <ChevronRight size={13} className="webpi-disclosure" aria-hidden="true" />
      </summary>
      <div className="webpi-step-detail">
        {step.thinking.length > 0 && <PiReasoning notes={step.thinking} label="Reasoning" />}
        <section>
          <h4>Input</h4>
          <pre>{JSON.stringify(step.input, null, 2)}</pre>
        </section>
        {step.result !== undefined && (
          <section>
            <h4>{failed ? 'Error' : 'Result'}</h4>
            <div className="webpi-step-result"><PiContent value={step.result} /></div>
          </section>
        )}
      </div>
    </details>
  )
}

function PiReasoning({ notes, label }: { readonly notes: readonly string[]; readonly label: string }): ReactElement {
  return (
    <details className="webpi-reasoning">
      <summary>{label} · {notes.length}</summary>
      <div className="webpi-reasoning-notes">
        {notes.map((note, index) => <MarkdownContent key={index} text={note} />)}
      </div>
    </details>
  )
}

function PiContent({ value }: { readonly value: unknown }): ReactElement {
  if (typeof value === 'string') return <MarkdownContent text={value} />
  if (!Array.isArray(value)) {
    const record = asRecord(value)
    const text = typeof record?.['text'] === 'string' ? record['text'] : JSON.stringify(value, null, 2)
    return <MarkdownContent text={text ?? ''} />
  }
  return (
    <div className="webpi-content-parts">
      {value.map((part, index) => {
        const item = asRecord(part)
        const type = typeof item?.['type'] === 'string' ? item['type'] : 'unknown'
        if (type === 'text' && typeof item?.['text'] === 'string') {
          return <MarkdownContent key={index} text={item['text']} />
        }
        if (type === 'thinking') {
          const thinking = typeof item?.['thinking'] === 'string' ? item['thinking'] : String(item?.['text'] ?? '')
          return <details key={index} className="webpi-detail"><summary>Thinking</summary><MarkdownContent text={thinking} /></details>
        }
        if (type === 'toolCall') {
          return (
            <details key={index} className="webpi-detail is-tool">
              <summary>Used {String(item?.['name'] ?? 'tool')}</summary>
              <pre>{JSON.stringify(item?.['arguments'] ?? {}, null, 2)}</pre>
            </details>
          )
        }
        return <pre key={index} className="webpi-unknown">{JSON.stringify(part, null, 2)}</pre>
      })}
    </div>
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function formatChars(chars: number): string {
  if (chars < 1_000) return `${chars} chars`
  return `${(chars / 1_000).toFixed(chars < 10_000 ? 1 : 0)}k chars`
}
