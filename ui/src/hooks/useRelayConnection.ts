import { useCallback, useEffect, useState } from 'react'

export interface RelayProject {
  key: string
  id: string
  displayName: string
  available: boolean
  runtime: { class: string; state: string; webEndpoint: string | null }
}

export interface RelayMachine {
  key: string
  displayName: string
  connection: string
  sshTarget?: string | null
  platform?: string | null
  cliVersion?: string | null
  defaultProject?: string | null
  projects: RelayProject[]
  issue: { message: string } | null
}

export interface RelayStatus {
  schemaVersion: 1
  generation: number
  target: { machine: string; machineName?: string; project: string; projectName?: string } | null
  switching: boolean
}

async function relayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/relay/v1/${path}`, { ...init, cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Relay returned HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function useRelayConnection(initial: RelayStatus | null = null) {
  const desktop = window.openAlice?.runtime ? window.openAlice.desktopConnection : undefined
  const [status, setStatus] = useState<RelayStatus | null>(initial)
  const [fleet, setFleet] = useState<RelayMachine[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextStatus, inventory] = await Promise.all([
        desktop ? desktop.status() : relayJson<RelayStatus>('status'),
        desktop ? desktop.fleet() : relayJson<{ machines: RelayMachine[] }>('fleet'),
      ])
      setStatus(nextStatus)
      setFleet(inventory.machines)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }, [desktop])

  const connect = useCallback(async (machine: string, project: string) => {
    setBusy(true)
    setError(null)
    try {
      if (desktop) {
        await desktop.connect(machine, project)
      } else {
        const next = await relayJson<RelayStatus>('connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ machine, project }),
        })
        setStatus(next)
        window.location.replace('/settings')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally { setBusy(false) }
  }, [desktop])

  useEffect(() => {
    let alive = true
    void (desktop ? desktop.status() : relayJson<RelayStatus>('status')).then((next) => {
      if (alive) setStatus(next)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [desktop])

  return { status, fleet, loading, busy, error, refresh, connect }
}

/** All tabs must retire their backend caches and sockets on a target switch. */
export function monitorRelayGeneration(initial: RelayStatus): () => void {
  const events = new EventSource('/relay/v1/events')
  events.onmessage = (message) => {
    try {
      const next = JSON.parse(message.data) as RelayStatus
      if (next.generation !== initial.generation) window.location.reload()
    } catch { /* Ignore an incomplete event and wait for the next one. */ }
  }
  return () => events.close()
}

export async function getRelayStatus(): Promise<RelayStatus | null> {
  try {
    const status = await relayJson<RelayStatus>('status')
    return status.schemaVersion === 1 ? status : null
  } catch { return null }
}
