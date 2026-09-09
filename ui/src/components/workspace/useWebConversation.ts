import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  abortWebSession,
  getWebSession,
  promptWebSession,
  respondWebSession,
  type WebSessionPhase,
  type WebSessionSnapshot,
} from './api'
import { presentWebTranscript } from './web-presentation'

/**
 * Live view of one Web conversation. Polls faster while the runtime works and
 * only accepts monotonically newer revisions so a late response from a
 * previous poll can never roll the transcript back.
 *
 * One mounted identity; WebSessionView keys this hook's owner by workspace/session.
 */
export function useWebConversation(wsId: string, sessionId: string) {
  const [snapshot, setSnapshot] = useState<WebSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<WebSessionSnapshot | null>(null)
  const alive = useRef(false)
  const accept = useCallback((next: WebSessionSnapshot) => {
    if (!alive.current || (current.current && next.revision < current.current.revision)) return
    current.current = next
    setSnapshot(next)
    setError(next.error)
  }, [])
  const refresh = useCallback(async () => {
    try {
      const next = await getWebSession(wsId, sessionId, current.current?.revision)
      if (next) accept(next)
      else if (alive.current) setError(current.current?.error ?? null)
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)) }
  }, [accept, wsId, sessionId])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    let timer: number | undefined
    async function poll() {
      await refresh()
      if (cancelled) return
      timer = window.setTimeout(() => void poll(), isBusy(current.current?.phase) ? 350 : 1500)
    }
    void poll()
    return () => { alive.current = false; cancelled = true; window.clearTimeout(timer) }
  }, [refresh])
  const items = useMemo(() => presentWebTranscript(snapshot ? [...snapshot.messages, ...(snapshot.streamingMessage ? [snapshot.streamingMessage] : [])] : []), [snapshot])
  return {
    snapshot,
    error,
    items,
    busy: isBusy(snapshot?.phase),
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
