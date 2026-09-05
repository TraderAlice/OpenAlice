import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, LoaderCircle, Square } from 'lucide-react'
import { Textarea } from '../ui/textarea'
import { Button } from '../ui/button'
import { ComposerShell } from './ComposerShell'
import { ConversationTranscriptItem } from './ConversationTranscript'
import type { ConversationItem } from './types'
import './conversation.css'

export interface ConversationViewProps {
  readonly items: readonly ConversationItem[]
  readonly revision: number
  readonly busy: boolean
  readonly ready: boolean
  readonly placeholder: string
  readonly empty: ReactNode
  readonly context?: ReactNode
  readonly controls?: ReactNode
  readonly status?: ReactNode
  readonly error?: string | null
  /** An absent action means the adapter does not support it. */
  readonly send?: (message: string) => Promise<void>
  readonly stop?: () => Promise<void>
  readonly stopLabel?: string
  readonly retry?: () => void
  readonly recover?: () => void
}

export function isConversationNearBottom(metrics: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>, threshold = 72): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

/** No runtime protocol, polling or workspace knowledge belongs in this view. */
export function ConversationView(props: ConversationViewProps) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const pendingRef = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  function jump(behavior: ScrollBehavior = 'smooth') {
    followingRef.current = true
    setFollowing(true)
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: motion })
  }
  useEffect(() => {
    if (followingRef.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'auto' })
  }, [props.revision, props.items.length])

  async function submit() {
    const message = draft.trim()
    if (!props.send || !props.ready || props.busy || pendingRef.current || !message) return
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    // Lock this draft only until the request is acknowledged; failed sends keep it.
    try {
      await props.send(message)
      if (mounted.current) { setDraft(''); jump('auto') }
    } catch (error) {
      if (mounted.current) setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }

  async function stop() {
    if (!props.stop || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    try { await props.stop() }
    catch (error) { if (mounted.current) setActionError(error instanceof Error ? error.message : String(error)) }
    finally { pendingRef.current = false; if (mounted.current) setPending(false) }
  }

  const error = actionError ?? props.error
  return <div className="conversation-shell">
    <div ref={scroller} className="conversation-messages" onScroll={(event) => {
      followingRef.current = isConversationNearBottom(event.currentTarget)
      setFollowing(followingRef.current)
    }}>
      {props.items.length === 0 && !error && <div className="conversation-empty">{props.empty}</div>}
      {props.items.map((item, index) => <ConversationTranscriptItem key={item.key} item={item} working={props.busy && index === props.items.length - 1} />)}
      {error && <div className="conversation-error" role="alert">
        <strong>Could not continue</strong><span>{error}</span>
        {props.retry && <button type="button" onClick={() => { setActionError(null); props.retry?.() }}>Retry</button>}
        {props.recover && <button type="button" onClick={props.recover}>Refresh session</button>}
      </div>}
    </div>
    <div className="conversation-composer-wrap">
      {!following && <div className="conversation-jump-row"><button type="button" className="conversation-jump-latest" onClick={() => jump()}>Jump to latest</button></div>}
      {props.status}
      {(props.send || (props.busy && props.stop)) && <ComposerShell context={props.context} controls={props.controls} action={
        props.busy ? (props.stop && <Button size="icon" className="conversation-send" disabled={pending} aria-label={props.stopLabel ?? 'Stop response'} onClick={() => void stop()}>{pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Square size={14} fill="currentColor" aria-hidden />}</Button>)
          : props.send && <Button size="icon" className="conversation-send" disabled={!props.ready || !draft.trim() || pending} aria-label="Send message" aria-busy={pending} onClick={() => void submit()}>{pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <ArrowUp size={18} aria-hidden />}</Button>
      }>
        <Textarea value={draft} rows={1} className="conversation-input" aria-label={props.placeholder} placeholder={props.placeholder} disabled={!props.ready || !props.send || pending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
        }} />
      </ComposerShell>}
    </div>
  </div>
}
