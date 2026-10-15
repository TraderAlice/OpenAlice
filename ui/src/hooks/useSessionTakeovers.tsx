import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export interface TakeoverRequest {
  id: string; workspaceId: string; recordId: string; resumeId: string; sessionTitle: string
  origin: { kind: string; entry: string; workspaceId?: string; issueId?: string }
  requestedAt: number; deadline: number; idleSeconds: number
  state: 'pending' | 'waiting-idle' | 'handoff' | 'running' | 'completed' | 'rejected' | 'canceled' | 'failed'
  blocker?: 'working' | 'terminal' | 'queued'
  decision?: string
}
export const awaitingTakeover = (row: TakeoverRequest) => row.state === 'pending' || row.state === 'waiting-idle'
async function request<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspaces/session-takeovers${path}`, init)
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `Request failed (${response.status})`)
  return response.json()
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const Context = createContext<ReturnType<typeof useTakeoverData> | null>(null)
function useTakeoverData() {
  const [requests, setRequests] = useState<TakeoverRequest[]>([])
  const [idleSeconds, setIdleSeconds] = useState(60)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [selected, select] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seen = useRef(new Set<string>())
  const alive = useRef(false)
  const generation = useRef(0)
  const lastActivity = useRef(new Map<string, number>())
  const refresh = useCallback(async () => {
    const version = ++generation.current
    try {
      const data = await request<{ requests: TakeoverRequest[]; idleSeconds: number; serverNow: number }>()
      if (!alive.current || version !== generation.current) return
      setRequests(data.requests); setIdleSeconds(data.idleSeconds); setOffset(data.serverNow - Date.now()); setPollError(null)
      const unseen = data.requests.find(row => awaitingTakeover(row) && !seen.current.has(row.id))
      if (unseen) { seen.current.add(unseen.id); select(previous => previous ?? unseen.id) }
    } catch (cause) { if (alive.current && version === generation.current) setPollError(String(cause)) }
  }, [])
  useEffect(() => {
    alive.current = true
    let canceled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => { await refresh(); if (!canceled) timer = setTimeout(() => void poll(), 1000) }
    void poll()
    return () => { canceled = true; alive.current = false; clearTimeout(timer) }
  }, [refresh])
  const decide = useCallback(async (id: string, decision: 'approve' | 'reject') => {
    setBusy(true); setError(null)
    try { await request(`/${encodeURIComponent(id)}/decision`, json({ decision })); await refresh(); if (decision === 'reject') select(null) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }, [refresh])
  const configure = useCallback(async (seconds: number) => {
    setBusy(true); setError(null)
    try { await request('/settings', json({ idleSeconds: seconds }, 'PUT')); await refresh() }
    catch (cause) { setError(String(cause)); throw cause }
    finally { setBusy(false) }
  }, [refresh])
  const activity = useCallback((wsId: string, recordId: string) => {
    const key = `${wsId}/${recordId}`
    if (Date.now() - (lastActivity.current.get(key) ?? 0) < 500) return
    lastActivity.current.set(key, Date.now())
    void fetch(`/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(recordId)}/activity`, json({})).catch(() => {})
  }, [])
  return { requests, idleSeconds, offset, error: error ?? pollError, selected, select, busy, decide, configure, activity }
}
export function SessionTakeoverProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useTakeoverData()}>{children}</Context.Provider>
}
export const useSessionTakeovers = () => useContext(Context)
