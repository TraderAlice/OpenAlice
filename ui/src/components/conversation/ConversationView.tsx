import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ConversationLayout } from './ConversationLayout'
import { ChatComposer, type ChatComposerProps } from './ChatComposer'
import { ConversationTranscriptItem } from './ConversationTranscript'
import type { ConversationItem } from './types'
import './conversation.css'

export interface ConversationViewProps {
  readonly header?: ReactNode
  readonly renderComposer?: (props: ChatComposerProps) => ReactNode
  readonly fileHrefs?: Record<string, string>
  readonly onFileReference?: (path: string) => void
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
  const initialItems = useRef<Map<string, ConversationItem> | null>(null)
  if (!initialItems.current && props.items.length) initialItems.current = new Map(props.items.map(item => [item.key, item]))
  const [stopped, setStopped] = useState(false)
  useEffect(() => { if (!props.busy) setStopped(false) }, [props.busy])
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

  useEffect(() => {
    if (!scroller.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'auto' })
    })
    for (const child of scroller.current.children) observer.observe(child)
    return () => observer.disconnect()
  }, [props.items.length])

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
    setStopped(true)
    try { await props.stop() }
    catch (error) { if (mounted.current) setActionError(error instanceof Error ? error.message : String(error)) }
    finally { pendingRef.current = false; if (mounted.current) setPending(false) }
  }

  const error = actionError ?? props.error
  return <ConversationLayout
    header={props.header}
    scrollRef={scroller}
    onScroll={(event) => {
      followingRef.current = isConversationNearBottom(event.currentTarget)
      setFollowing(followingRef.current)
    }}
    composer={<>
      {!following && <div className="conversation-jump-row"><button type="button" className="conversation-jump-latest" onClick={() => jump()}>Jump to latest</button></div>}
      {props.status}
      {(props.send || (props.busy && props.stop)) && (props.renderComposer ?? ((composer) => <ChatComposer {...composer} />))({
        context: props.context, controls: props.controls,
        value: draft, onChange: setDraft, placeholder: props.placeholder,
        disabled: !props.ready || !props.send || pending,
        canSend: !!props.send && props.ready && !!draft.trim() && !props.busy,
        pending, busy: props.busy,
        onSubmit: () => void submit(), onStop: props.stop ? () => void stop() : undefined,
        stopLabel: props.stopLabel ?? 'Stop response',
      })}
    </>}
  >
      {props.items.length === 0 && !error && <div className="conversation-empty">{props.empty}</div>}
      {props.items.map((item, index) => <ConversationTranscriptItem key={item.key} fileHrefs={props.fileHrefs} onFileReference={props.onFileReference} item={item} animate={props.busy && !stopped && JSON.stringify(initialItems.current?.get(item.key)) !== JSON.stringify(item) && index === props.items.length - 1} latest={index === props.items.length - 1} working={props.busy && index === props.items.length - 1} />)}
      {error && <div className="conversation-error" role="alert">
        <strong>Could not continue</strong><span>{error}</span>
        {props.retry && <button type="button" onClick={() => { setActionError(null); props.retry?.() }}>Retry</button>}
        {props.recover && <button type="button" onClick={props.recover}>Refresh session</button>}
      </div>}
  </ConversationLayout>
}
