import { useCallback, useEffect, useState } from 'react'

import { useRelayConnection } from './useRelayConnection'

export interface MachinePlan {
  id: string
  mode: 'add' | 'upgrade'
  machine: { key: string | null; label: string; sshTarget: string }
  project: { key: string; displayName: string } | null
  platform: string
  installedVersion: string
  targetVersion: string
  runtime: string
  actions: string[]
  blocker: string | null
  deferredUpdate: boolean
  expiresAt: string
}

export interface MachineOperation {
  id: string
  planId: string
  mode: 'add' | 'upgrade'
  phase: 'running' | 'succeeded' | 'failed'
  stage: 'checking' | 'installing' | 'verifying-install' | 'preparing-source' | 'restarting' | 'verifying'
  startedAt: string
  error: string | null
}

export type MachinePlanInput = {
  mode: 'add' | 'upgrade'
  sshTarget?: string
  label?: string
  sshPort?: number
  identityFile?: string
  machineKey?: string
  projectKey?: string
}

async function relayMutation<T>(path: string, input: unknown): Promise<T> {
  const response = await fetch(`/relay/v1/machines/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Relay returned HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

/** Machine operations are local client controls, never proxied backend API calls. */
export function useMachineManagement() {
  const relay = useRelayConnection()
  const desktop = window.openAlice?.desktopMachine
  const [plan, setPlan] = useState<MachinePlan | null>(null)
  const [probing, setProbing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [operation, setOperation] = useState<MachineOperation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshOperation = useCallback(async () => {
    try {
      const next = desktop
        ? await desktop.operation() as MachineOperation | null
        : await fetch('/relay/v1/machines/operation', { cache: 'no-store' }).then((response) => response.ok ? response.json() as Promise<MachineOperation | null> : null)
      setOperation(next)
      return next
    } catch { return null }
  }, [desktop])

  useEffect(() => { void refreshOperation() }, [refreshOperation])
  useEffect(() => {
    if (!applying && operation?.phase !== 'running') return
    const timer = window.setInterval(() => { void refreshOperation() }, 700)
    return () => window.clearInterval(timer)
  }, [applying, operation?.phase, refreshOperation])

  const clearPlan = useCallback(() => { setPlan(null); setError(null) }, [])
  const probe = useCallback(async (input: MachinePlanInput) => {
    setProbing(true)
    setPlan(null)
    setError(null)
    try {
      const next = desktop
        ? await desktop.plan(input) as MachinePlan
        : await relayMutation<MachinePlan>('plan', input)
      setPlan(next)
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally { setProbing(false) }
  }, [desktop])

  const apply = useCallback(async () => {
    if (!plan || plan.blocker) return
    setApplying(true)
    setError(null)
    setOperation(null)
    try {
      const request = desktop ? desktop.apply(plan.id) : relayMutation('apply', { id: plan.id })
      // Start polling while the apply request is pending; the relay owns the operation.
      await request
      await refreshOperation()
      setPlan(null)
      await relay.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      await refreshOperation()
      throw cause
    } finally { setApplying(false) }
  }, [desktop, plan, relay.refresh, refreshOperation])

  return { ...relay, plan, probing, applying, operation, operationError: error, clearPlan, probe, apply }
}
