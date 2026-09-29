import { getLaunchPreview, clearLaunchPreview } from '../conversation/launch-preview'
import type { ConversationItem } from '../conversation/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  abortWebSession,
  openWebSession,
  type PausedSessionRuntimeUpdate,
  getWebSession,
  promptWebSession,
  respondWebSession,
  revealEarlierWebHistory,
  type WebSessionPhase,
  type WebSessionSnapshot,
} from './api'
import { presentWebTranscript } from './web-presentation'
import {
  readWebSessionCache,
  writeWebSessionCache,
} from './web-session-cache'

const ACTIVE_POLL_MS = 350
const IDLE_POLL_MS = 1500
/** Hidden warm frames still catch up, but far less often than a visible desk. */
const HIDDEN_POLL_MS = 15_000

/**
 * Live view of one Web conversation. Polls faster while the runtime works and
 * only accepts monotonically newer revisions so a late response from a
 * previous poll can never roll the transcript back.
 *
 * One mounted identity; WebSessionView keys this hook's owner by workspace/session.
 * Remounts hydrate from a small in-memory snapshot cache so Trading → Session
 * returns do not wait on a full multi‑MB GET before first paint.
 */
export function useWebConversation(
  wsId: string,
  sessionId: string,
  readOnly = false,
  visible = true,
) {
  const [launchPrompt] = useState(() => getLaunchPreview(wsId, sessionId))
  const [snapshot, setSnapshot] = useState<WebSessionSnapshot | null>(
    () => readWebSessionCache(wsId, sessionId),
  )
  const [error, setError] = useState<string | null>(null)
  const current = useRef<WebSessionSnapshot | null>(snapshot)
  const alive = useRef(false)
  const generation = useRef(0)
  const restarting = useRef(false)
  const visibleRef = useRef(visible)
  const wasVisibleRef = useRef(visible)
  visibleRef.current = visible
  const [reconfiguring, setReconfiguring] = useState(false)
  useEffect(() => { if (snapshot) clearLaunchPreview(wsId, sessionId) }, [snapshot, wsId, sessionId])
  useEffect(() => () => clearLaunchPreview(wsId, sessionId), [wsId, sessionId])
  const accept = useCallback((next: WebSessionSnapshot) => {
    if (!alive.current || (current.current && next.revision < current.current.revision)) return
    current.current = next
    writeWebSessionCache(wsId, sessionId, next)
    setSnapshot(next)
    setError(next.error)
  }, [wsId, sessionId])
  const refresh = useCallback(async () => {
    if (readOnly || restarting.current) return
    const epoch = generation.current
    try {
      const next = await getWebSession(wsId, sessionId, current.current?.revision)
      if (epoch !== generation.current) return
      if (next) accept(next)
      else if (alive.current) setError(current.current?.error ?? null)
    } catch (error) { if (alive.current && epoch === generation.current) setError(error instanceof Error ? error.message : String(error)) }
  }, [accept, wsId, sessionId, readOnly])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    let timer: number | undefined
    async function poll() {
      await refresh()
      if (cancelled) return
      const phase = current.current?.phase
      const delay = !visibleRef.current
        ? HIDDEN_POLL_MS
        : isBusy(phase) ? ACTIVE_POLL_MS : IDLE_POLL_MS
      timer = window.setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => { alive.current = false; cancelled = true; window.clearTimeout(timer) }
  }, [refresh])
  // When a warm frame becomes visible again, refresh after paint so the
  // composer can take focus/keystrokes before a multi‑MB poll/reconcile.
  // Skip the initial mount — `poll` already fetched once.
  useEffect(() => {
    const becameVisible = visible && !wasVisibleRef.current
    wasVisibleRef.current = visible
    if (!becameVisible || readOnly) return
    let cancelled = false
    let idleId: number | undefined
    const raf = window.requestAnimationFrame(() => {
      const run = () => { if (!cancelled) void refresh() }
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(run, { timeout: 250 })
      } else {
        idleId = window.setTimeout(run, 0)
      }
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      if (idleId === undefined) return
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      else window.clearTimeout(idleId)
    }
  }, [visible, readOnly, refresh])
  const reconfigure = useCallback(async (runtime: PausedSessionRuntimeUpdate) => {
    if (restarting.current || isBusy(current.current?.phase)) throw new Error('Wait for the current response to finish')
    restarting.current = true
    generation.current += 1
    setReconfiguring(true)
    try {
      const next = await openWebSession(wsId, sessionId, runtime)
      // A new process owns a new revision sequence. Keep rendered history until it is ready.
      current.current = null
      accept(next)
    } finally {
      restarting.current = false
      if (alive.current) setReconfiguring(false)
    }
  }, [accept, wsId, sessionId])
  const [historyBusy, setHistoryBusy] = useState(false)
  const items = useMemo(() => presentWebTranscript(snapshot ? [...snapshot.messages, ...(snapshot.streamingMessage ? [snapshot.streamingMessage] : [])] : []), [snapshot])
  const loadEarlier = useCallback(async () => {
    if (readOnly || historyBusy || !snapshot?.historyHiddenCount) return
    setHistoryBusy(true)
    try {
      accept(await revealEarlierWebHistory(wsId, sessionId))
    } finally {
      if (alive.current) setHistoryBusy(false)
    }
  }, [accept, historyBusy, readOnly, sessionId, snapshot?.historyHiddenCount, wsId])
  return {
    snapshot,
    error,
    reconfiguring,
    reconfigure,
    items: !snapshot && launchPrompt ? [{ kind: 'user', key: 'launch-preview', content: [{ kind: 'markdown', text: launchPrompt }] }] as ConversationItem[] : items,
    busy: isBusy(snapshot?.phase),
    historyBusy,
    historyHiddenCount: snapshot?.historyHiddenCount ?? 0,
    loadEarlier,
    requests: snapshot?.requests ?? [],
    refresh,
    send: async (message: string) => { accept(await promptWebSession(wsId, sessionId, message)) },
    stop: async () => { accept(await abortWebSession(wsId, sessionId)) },
    respond: async (requestId: string, optionId: string, text?: string) => {
      accept(await respondWebSession(wsId, sessionId, requestId, optionId, text))
    },
  }
}

/**
 * A turn is in flight. `awaiting-input` counts: the runtime is mid-turn and
 * blocked on the user answering a request, so the composer stays in stop mode
 * and the request card, not a new prompt, is the way forward.
 */
export function isBusy(phase: WebSessionPhase | undefined): boolean {
  return phase === 'working' || phase === 'retrying' || phase === 'compacting' || phase === 'awaiting-input'
}
