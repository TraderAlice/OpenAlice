import { useCallback, useEffect, useRef, useState } from 'react'
import { useRelayConnection, type RelayStatus } from './useRelayConnection'
import { useDiscoverySnapshot } from '../lib/updates/useDiscoverySnapshot'
import type { MachinePlan, MachinePlanInput, MachineOperation } from '../lib/updates/machine-types'

// Mounted once by the public provider; presentation consumers never poll.
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
export function useMachineControls(initial: RelayStatus | null = null) {
  const relay = useRelayConnection(initial)
  const desktop = window.openAlice?.desktopMachine
  const [plan, setPlan] = useState<MachinePlan | null>(null)
  const [probing, setProbing] = useState(false)
  const [applying, setApplying] = useState(false)
  const operationDiscovery = useDiscoverySnapshot<MachineOperation | null>('local-machine-control')
  const operation = operationDiscovery.value
  const checkOperation = operationDiscovery.check
  const planRef = useRef(plan)
  planRef.current = plan
  const planRequestKey = useRef<string | null>(null)
  const probeFlight = useRef<{ key: string; promise: Promise<MachinePlan> } | null>(null)
  const probeGeneration = useRef(0)
  const approvedGeneration = useRef<number | null>(null)
  const applyFlight = useRef<Promise<{ machineKey: string }> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshOperation = useCallback(() => checkOperation(async () => {
    if (desktop) return await desktop.operation() as MachineOperation | null
    const response = await fetch('/relay/v1/machines/operation', { cache: 'no-store' })
    if (response.status === 404 || response.headers?.get('content-type')?.includes('text/html')) return null
    if (!response.ok) throw new Error(`Operation status failed: HTTP ${response.status}`)
    return response.json() as Promise<MachineOperation | null>
  }), [desktop, checkOperation])
  useEffect(() => () => { probeGeneration.current++ }, [])

  useEffect(() => { void refreshOperation() }, [refreshOperation])
  useEffect(() => {
    if (!applying && operation?.phase !== 'running') return
    const timer = window.setInterval(() => { void refreshOperation() }, 700)
    return () => window.clearInterval(timer)
  }, [applying, operation?.phase, refreshOperation])

  const clearPlan = useCallback(() => { probeGeneration.current++; probeFlight.current = null; planRequestKey.current = null; planRef.current = null; setPlan(null); setError(null); setProbing(false) }, [])
  const probe = useCallback((input: MachinePlanInput, options: { force?: boolean } = {}): Promise<MachinePlan> => {
    if (applyFlight.current) return Promise.reject(new Error('Wait for the current operation to finish'))
    const key = JSON.stringify([input.mode, input.machineKey, input.projectKey, input.sshTarget, input.label, input.sshPort, input.identityFile])
    if (probeFlight.current?.key === key) return probeFlight.current.promise
    if (!options.force && input.mode === 'upgrade' && planRef.current && planRequestKey.current === key) return Promise.resolve(planRef.current)
    // A fresh review also retries a failed operation-status read. Reopening a
    // cached review returns above and does not start either read again.
    void refreshOperation()
    const generation = ++probeGeneration.current
    setProbing(true)
    if (planRequestKey.current !== key) setPlan(null)
    setError(null)
    const promise = Promise.resolve().then(async () => {
      try {
        const next = desktop ? await desktop.plan(input) as MachinePlan : await relayMutation<MachinePlan>('plan', input)
        if (generation !== probeGeneration.current) throw new Error('This probe was superseded')
        planRequestKey.current = key
        approvedGeneration.current = generation
        planRef.current = next
        setPlan(next)
        return next
      } catch (cause) {
        if (generation === probeGeneration.current) setError(cause instanceof Error ? cause.message : String(cause))
        throw cause
      } finally {
        if (generation === probeGeneration.current) { setProbing(false); probeFlight.current = null }
      }
    })
    probeFlight.current = { key, promise }
    return promise
  }, [desktop, refreshOperation])

  const apply = useCallback((): Promise<{ machineKey: string }> => {
    if (applyFlight.current) return applyFlight.current
    if (!plan || plan !== planRef.current || approvedGeneration.current !== probeGeneration.current || plan.blocker || probing || error) return Promise.reject(new Error('A reviewed unblocked plan is required'))
    const approved = plan
    setApplying(true)
    setError(null)
    const flight = Promise.resolve().then(async () => {
      try {
        // Plans are single-use, including failed applications. Never resubmit
        // an approval after failure; probe and review the current state again.
        const result = desktop
          ? await desktop.apply(approved.id) as { machineKey: string }
          : await relayMutation<{ machineKey: string }>('apply', { id: approved.id })
        await refreshOperation()
        planRef.current = null
        planRequestKey.current = null
        setPlan(null)
        await relay.refresh()
        return result
      } catch (cause) {
        planRef.current = null
        planRequestKey.current = null
        setPlan(null)
        setError(cause instanceof Error ? cause.message : String(cause))
        await refreshOperation()
        throw cause
      } finally {
        setApplying(false)
        applyFlight.current = null
      }
    })
    applyFlight.current = flight
    return flight
  }, [desktop, plan, probing, error, relay.refresh, refreshOperation])

  return { ...relay, plan, probing, applying, operation, operationError: error ?? operationDiscovery.error, clearPlan, probe, apply }
}
