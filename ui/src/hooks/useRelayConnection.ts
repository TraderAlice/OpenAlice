import { useCallback, useEffect, useRef, useState } from 'react'

export interface RelayProject {
  key: string
  id: string
  home?: string
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
  targetConnection?: 'healthy' | 'reconnecting' | 'unavailable' | null
}

export interface RelayStartupPreference {
  target: { machine: string; project: string } | null
  error: string | null
}

const RELAY_SETTLED_EVENT = 'openalice:relay-settled'

async function relayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/relay/v1/${path}`, { ...init, cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Relay returned HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchRelayStatus(): Promise<RelayStatus> {
  return relayJson<RelayStatus>('status')
}

export function reconnectRelayTarget(): Promise<RelayStatus> {
  return relayJson<RelayStatus>('reconnect', { method: 'POST', headers: { 'content-type': 'application/json' } })
}

export function useRelayConnection(initial: RelayStatus | null = null) {
  const discoveryGeneration = useRef(0)
  const startupRevision = useRef(0)
  const desktop = window.openAlice?.desktopConnection
  const [status, setStatus] = useState<RelayStatus | null>(initial)
  const [fleet, setFleet] = useState<RelayMachine[]>([])
  const [startup, setStartup] = useState<RelayStartupPreference | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A replacement Desktop renderer may mount before Default is committed.
  // Read the final preference when the shared selection finishes.
  useEffect(() => {
    let active = true
    const settled = (event: Event) => {
      const next = (event as CustomEvent<RelayStatus>).detail
      if (next) setStatus(next)
      const request = ++startupRevision.current
      void (desktop ? desktop.startupTarget() : relayJson<RelayStartupPreference>('startup-target'))
        .then(preference => { if (active && startupRevision.current === request) setStartup(preference) })
        .catch(cause => { if (active && startupRevision.current === request) setError(cause instanceof Error ? cause.message : String(cause)) })
    }
    window.addEventListener(RELAY_SETTLED_EVENT, settled)
    return () => { active = false; window.removeEventListener(RELAY_SETTLED_EVENT, settled) }
  }, [desktop])

  const refresh = useCallback(async () => {
    const generation = ++discoveryGeneration.current
    const preferenceRevision = ++startupRevision.current
    setLoading(true)
    setError(null)
    try {
      const [nextStatus, inventory, preference] = await Promise.all([
        desktop ? desktop.status() : relayJson<RelayStatus>('status'),
        desktop ? desktop.fleet() : relayJson<{ machines: RelayMachine[] }>('fleet'),
        desktop ? desktop.startupTarget() : relayJson<RelayStartupPreference>('startup-target'),
      ])
      if (generation !== discoveryGeneration.current) return
      if (preferenceRevision === startupRevision.current) setStatus(nextStatus)
      setFleet(inventory.machines)
      if (preferenceRevision === startupRevision.current) setStartup(preference)
    } catch (cause) {
      if (generation === discoveryGeneration.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (generation === discoveryGeneration.current) setLoading(false) }
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
        // The generation observer owns browser navigation for every tab.
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally { setBusy(false) }
  }, [desktop])

  const controlProject = useCallback(async (input: { machine: string; project: string; action: 'create' | 'start'; home?: string }) => {
    setBusy(true)
    setError(null)
    try {
      if (desktop) await desktop.controlProject(input)
      else await relayJson('projects/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally { setBusy(false) }
  }, [desktop, refresh])

  useEffect(() => {
    // Child effects may already have requested inventory during this mount.
    // Status initialization must not cancel that refresh and strand loading.
    const generation = discoveryGeneration.current
    const preferenceRevision = startupRevision.current
    if (!initial) void (desktop ? desktop.status() : relayJson<RelayStatus>('status')).then((next) => {
      if (generation === discoveryGeneration.current && preferenceRevision === startupRevision.current) setStatus(next)
    }).catch(() => undefined)
    return () => { discoveryGeneration.current++ }
  }, [desktop])

  return { status, fleet, startup, loading, busy, error, refresh, connect, controlProject }
}

/** All tabs must retire their backend caches and sockets on a target switch. */
export function monitorRelayGeneration(initial: RelayStatus): () => void {
  const events = new EventSource('/relay/v1/events')
  let reloading = false
  events.onmessage = (message) => {
    try {
      const next = JSON.parse(message.data) as RelayStatus
      // Desktop is presenting the replacement page while switching is true.
      // Reloading here would abort loadURL and skip the Default commit.
      if (next.switching || reloading) return
      if (next.generation !== initial.generation) {
        reloading = true
        events.close()
        window.location.reload()
      } else window.dispatchEvent(new CustomEvent(RELAY_SETTLED_EVENT, { detail: next }))
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
