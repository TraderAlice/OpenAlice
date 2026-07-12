import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Bot, LoaderCircle, Send, Square, User } from 'lucide-react'

import { MarkdownContent } from '../MarkdownContent'
import {
  abortWebPiSession,
  getWebPiSession,
  promptWebPiSession,
  type WebPiSnapshot,
} from './api'

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
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await getWebPiSession(wsId, sessionId)
      setSnapshot(next)
      setError(next.error)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [sessionId, wsId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 500)
    return () => window.clearInterval(timer)
  }, [refresh])

  const messages = useMemo(() => {
    if (!snapshot) return []
    return snapshot.streamingMessage
      ? [...snapshot.messages, snapshot.streamingMessage]
      : [...snapshot.messages]
  }, [snapshot])

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, snapshot?.revision])

  const working = snapshot?.phase === 'working' || snapshot?.phase === 'compacting' || snapshot?.phase === 'retrying'

  const submit = async (): Promise<void> => {
    const message = draft.trim()
    if (!message || working) return
    setDraft('')
    setError(null)
    try {
      setSnapshot(await promptWebPiSession(wsId, sessionId, message))
    } catch (err) {
      setDraft(message)
      setError((err as Error).message)
    }
  }

  const abort = async (): Promise<void> => {
    try {
      setSnapshot(await abortWebPiSession(wsId, sessionId))
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

      <div ref={scrollerRef} className="webpi-messages">
        {messages.length === 0 && !error && (
          <div className="webpi-empty">This Pi conversation is ready in the browser.</div>
        )}
        {messages.map((message, index) => (
          <PiMessage key={`${index}-${snapshot?.revision ?? 0}`} value={message} />
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

function PiMessage({ value }: { readonly value: unknown }): ReactElement {
  const record = asRecord(value)
  const role = typeof record?.['role'] === 'string' ? record['role'] : 'assistant'
  const user = role === 'user'
  const tool = role === 'toolResult' || role === 'tool'
  const content = record?.['content']
  return (
    <article className={`webpi-message is-${user ? 'user' : tool ? 'tool' : 'assistant'}`}>
      <div className="webpi-avatar">{user ? <User size={14} /> : <Bot size={14} />}</div>
      <div className="webpi-message-body">
        <div className="webpi-role">{user ? 'You' : tool ? String(record?.['toolName'] ?? 'Tool') : 'Pi'}</div>
        <PiContent value={content ?? value} />
      </div>
    </article>
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
