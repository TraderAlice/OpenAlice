export type OptionalCarrierPhase = 'disabled' | 'healthy' | 'degraded'

export interface OptionalCarrierHealth<T> {
  id: string
  phase: OptionalCarrierPhase
  checkedAt: string
  latencyMs: number
  reason?: 'not_configured' | 'http_error' | 'invalid_response' | 'timeout' | 'unreachable'
  detail?: string
  body?: T
}

export interface OptionalCarrierProbeOptions<T> {
  id: string
  enabled: boolean
  baseUrl?: string
  healthPath: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  decode(value: unknown): T
  now?: () => number
}

/**
 * One health probe contract shared by optional service carriers. Disabled is
 * an intentional state, while configured-but-unreachable is degraded. The
 * caller owns policy; this function never throws or decides to stop Alice.
 */
export async function probeOptionalCarrier<T>(
  options: OptionalCarrierProbeOptions<T>,
): Promise<OptionalCarrierHealth<T>> {
  const now = options.now ?? Date.now
  const started = now()
  const base = options.baseUrl?.replace(/\/+$/, '')
  const baseResult = {
    id: options.id,
    checkedAt: new Date(started).toISOString(),
    latencyMs: 0,
  }
  if (!options.enabled) return { ...baseResult, phase: 'disabled' }
  if (!base) {
    return { ...baseResult, phase: 'degraded', reason: 'not_configured', detail: 'Carrier URL is not configured.' }
  }

  const timeoutMs = options.timeoutMs ?? 1_000
  try {
    const response = await (options.fetchImpl ?? fetch)(`${base}${options.healthPath}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    const latencyMs = Math.max(0, now() - started)
    if (!response.ok) {
      return {
        ...baseResult,
        latencyMs,
        phase: 'degraded',
        reason: 'http_error',
        detail: `Health endpoint returned HTTP ${response.status}.`,
      }
    }
    try {
      const body = options.decode(await response.json())
      return { ...baseResult, latencyMs, phase: 'healthy', body }
    } catch (error) {
      return {
        ...baseResult,
        latencyMs,
        phase: 'degraded',
        reason: 'invalid_response',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  } catch (error) {
    const latencyMs = Math.max(0, now() - started)
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return {
      ...baseResult,
      latencyMs,
      phase: 'degraded',
      reason: timedOut ? 'timeout' : 'unreachable',
      detail: timedOut
        ? `Health probe timed out after ${timeoutMs}ms.`
        : error instanceof Error ? error.message : String(error),
    }
  }
}

export interface WaitForOptionalCarrierOptions<T> extends OptionalCarrierProbeOptions<T> {
  waitTimeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

export async function waitForOptionalCarrier<T>(
  options: WaitForOptionalCarrierOptions<T>,
): Promise<OptionalCarrierHealth<T>> {
  if (!options.enabled) return probeOptionalCarrier(options)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + (options.waitTimeoutMs ?? 15_000)
  let latest = await probeOptionalCarrier(options)
  while (latest.phase !== 'healthy' && now() < deadline) {
    const remaining = deadline - now()
    await sleep(Math.min(options.intervalMs ?? 200, remaining))
    latest = await probeOptionalCarrier(options)
  }
  return latest
}
