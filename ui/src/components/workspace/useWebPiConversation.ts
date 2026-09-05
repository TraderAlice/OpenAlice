import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { abortWebPiSession, getWebPiSession, promptWebPiSession, type WebPiSnapshot } from './api'
import { presentPiTranscript } from './webpi-presentation'

/** One mounted identity; WebPiView keys this hook's owner by workspace/session. */
export function useWebPiConversation(wsId: string, sessionId: string) {
  const [snapshot, setSnapshot] = useState<WebPiSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<WebPiSnapshot | null>(null)
  const alive = useRef(false)
  const accept = useCallback((next: WebPiSnapshot) => {
    if (!alive.current || (current.current && next.revision < current.current.revision)) return
    current.current = next
    setSnapshot(next)
    setError(next.error)
  }, [])
  const refresh = useCallback(async () => {
    try {
      const next = await getWebPiSession(wsId, sessionId, current.current?.revision)
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
  const items = useMemo(() => presentPiTranscript(snapshot ? [...snapshot.messages, ...(snapshot.streamingMessage ? [snapshot.streamingMessage] : [])] : []), [snapshot])
  return {
    snapshot, error, items, busy: isBusy(snapshot?.phase), refresh,
    send: async (message: string) => { accept(await promptWebPiSession(wsId, sessionId, message)) },
    stop: async () => { accept(await abortWebPiSession(wsId, sessionId)) },
  }
}

function isBusy(phase: WebPiSnapshot['phase'] | undefined) { return phase === 'working' || phase === 'retrying' || phase === 'compacting' }
