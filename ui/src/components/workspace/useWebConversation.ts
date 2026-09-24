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
export function useWebConversation(wsId: string, sessionId: string, readOnly = false) {
  const [launchPrompt] = useState(() => getLaunchPreview(wsId, sessionId))
  const [snapshot, setSnapshot] = useState<WebSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<WebSessionSnapshot | null>(null)
  const alive = useRef(false)
  const generation = useRef(0)
  const restarting = useRef(false)
  const [reconfiguring, setReconfiguring] = useState(false)
  useEffect(() => { if (snapshot) clearLaunchPreview(wsId, sessionId) }, [snapshot, wsId, sessionId])
  useEffect(() => () => clearLaunchPreview(wsId, sessionId), [wsId, sessionId])
  const accept = useCallback((next: WebSessionSnapshot) => {
    if (!alive.current || (current.current && next.revision < current.current.revision)) return
    current.current = next
    setSnapshot(next)
    setError(next.error)
  }, [])
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
      timer = window.setTimeout(() => void poll(), isBusy(current.current?.phase) ? 350 : 1500)
    }
    void poll()
    return () => { alive.current = false; cancelled = true; window.clearTimeout(timer) }
  }, [refresh])
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
  const items = useMemo(() => presentWebTranscript(snapshot ? [...snapshot.messages, ...(snapshot.streamingMessage ? [snapshot.streamingMessage] : [])] : []), [snapshot])
  return {
    snapshot,
    error,
    reconfiguring,
    reconfigure,
    items: !snapshot && launchPrompt ? [{ kind: 'user', key: 'launch-preview', content: [{ kind: 'markdown', text: launchPrompt }] }] as ConversationItem[] : items,
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
