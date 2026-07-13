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

export async function waitForUTAReady(opts: WaitOpts): Promise<HealthBody | null> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/__uta/health`
  const timeoutMs = opts.timeoutMs ?? 15_000
  const intervalMs = opts.intervalMs ?? 200
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return (await res.json()) as HealthBody
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
}
