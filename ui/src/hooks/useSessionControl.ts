import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionExecutionDetail } from './useSessionDetails'

export interface SessionBlock {
  id: string; kind: 'user-cooldown' | 'execution-fault'; reason: string
  createdAt: number; expiresAt?: number; executionId: string
  actor: { kind: string; entry: string }
}
export interface SessionControl {
  execution: (SessionExecutionDetail & { stopError?: string }) | null
  blocks: SessionBlock[]
  cooldownSeconds: number
  serverNow: number
}
export function useSessionControl(workspaceId: string, recordId: string) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(recordId)}`
  const [data, setData] = useState<SessionControl | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++generation.current
    const response = await fetch(`${base}/control`)
    const result = await response.json()
    if (!response.ok) throw new Error(result.message ?? `Request failed (${response.status})`)
    if (version === generation.current) setData(result)
  }, [base])
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    setData(null); setError(null); setPollError(null)
    const poll = async () => {
      try { await refresh(); if (live) setPollError(null) } catch (cause) { if (live) setPollError(String(cause)) }
      if (live) timer = setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => { live = false; generation.current++; clearTimeout(timer) }
  }, [refresh])
  const act = useCallback(async (path: string, body: unknown, method = 'POST') => {
    setBusy(true); setError(null)
    try {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message ?? `Request failed (${response.status})`)
      await refresh()
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }, [refresh])
  return { data, error: error ?? pollError, busy,
    interrupt: (executionId: string) => act(`${base}/interrupt`, { executionId }),
    release: (id: string) => act(`${base}/blocks/${encodeURIComponent(id)}/release`, {}),
    configure: (cooldownSeconds: number) => act('/api/workspaces/session-controls/settings', { cooldownSeconds }, 'PUT'),
  }
}
