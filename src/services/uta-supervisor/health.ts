import { waitForOptionalCarrier } from '../optional-carrier/health.js'

/**
 * Poll UTA `/__uta/health` until it returns 200 or timeout. Used by Alice and
 * Guardian for observability only: UTA is an optional carrier, so callers can
 * continue in lite mode when this returns null.
 */

export interface HealthBody {
  ok: boolean
  startedAt: string
  utas: number
}

export interface WaitOpts {
  /** Full UTA base URL, e.g. `http://127.0.0.1:47333`. */
  baseUrl: string
  /** Time budget. Default 15s. */
  timeoutMs?: number
  /** Poll interval. Default 200ms. */
  intervalMs?: number
}

export function decodeUTAHealth(value: unknown): HealthBody {
  const body = value as Partial<HealthBody>
  if (body.ok !== true || typeof body.startedAt !== 'string' || typeof body.utas !== 'number') {
    throw new Error('Invalid UTA health response.')
  }
  return body as HealthBody
}

export async function waitForUTAReady(opts: WaitOpts): Promise<HealthBody | null> {
  const result = await waitForOptionalCarrier({
    id: 'uta',
    enabled: true,
    baseUrl: opts.baseUrl,
    healthPath: '/__uta/health',
    waitTimeoutMs: opts.timeoutMs ?? 15_000,
    intervalMs: opts.intervalMs ?? 200,
    decode: decodeUTAHealth,
  })
  return result.phase === 'healthy' ? result.body! : null
}
