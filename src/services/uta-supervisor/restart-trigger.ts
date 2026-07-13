/**
 * Trigger a Guardian-mediated UTA restart from Alice.
 *
 * Protocol:
 *   1. Atomic-write `data/control/restart-uta.flag` (write to .tmp + rename)
 *      with content = ISO timestamp of the request.
 *   2. Guardian's fs.watch fires (debounced 100ms), Guardian SIGTERMs UTA,
 *      waits exit, respawns with fresh `accounts.json`.
 *   3. Alice polls `${OPENALICE_UTA_URL}/__uta/health` until `startedAt` is
 *      newer than the pre-trigger value, or until timeout.
 *
 * Step 5 wires this into `trading-config.ts` so broker setup saves trigger
 * UTA reload automatically. Step 4 just exposes the helper.
 */

import { writeFile, rename, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { dataPath } from '@/core/paths.js'
import { isUTADisabled, resolveUTAUrl } from './url.js'

export interface TriggerOpts {
  /** UTA service base URL. Default: resolved local UTA carrier URL. */
  utaUrl?: string
  /** Flag path. Default: `dataPath('control', 'restart-uta.flag')`. */
  flagPath?: string
  /** Total wait budget for new UTA to come back. Default 20s. */
  timeoutMs?: number
  /** Health poll interval. Default 200ms. */
  intervalMs?: number
}

export interface TriggerResult {
  triggered: boolean
  ready: boolean
  /** UTA startedAt before trigger; useful for debugging churn. */
  oldStartedAt?: string
  /** UTA startedAt after trigger if ready. */
  newStartedAt?: string
  error?: string
}

interface HealthBody {
  ok?: boolean
  startedAt?: string
  utas?: number
}

async function fetchHealth(url: string): Promise<HealthBody | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as HealthBody
  } catch { return null }
}

export async function triggerUTARestart(opts: TriggerOpts = {}): Promise<TriggerResult> {
  if (isUTADisabled()) {
    return { triggered: false, ready: false, error: 'UTA disabled by OPENALICE_LITE_MODE' }
  }
  const utaUrl = opts.utaUrl ?? resolveUTAUrl()
  const flagPath = opts.flagPath ?? dataPath('control', 'restart-uta.flag')
  const healthUrl = `${utaUrl.replace(/\/$/, '')}/__uta/health`
  const timeoutMs = opts.timeoutMs ?? 20_000
  const intervalMs = opts.intervalMs ?? 200

  const pre = await fetchHealth(healthUrl)
  const oldStartedAt = pre?.startedAt

  // Atomic-write so Guardian's watcher never sees a half-written flag.
  await mkdir(dirname(flagPath), { recursive: true })
  const tmpPath = `${flagPath}.tmp`
  await writeFile(tmpPath, new Date().toISOString(), 'utf-8')
  await rename(tmpPath, flagPath)

  // Poll for `startedAt` change.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const cur = await fetchHealth(healthUrl)
    if (cur?.startedAt && cur.startedAt !== oldStartedAt) {
      return { triggered: true, ready: true, oldStartedAt, newStartedAt: cur.startedAt }
    }
  }
  return { triggered: true, ready: false, oldStartedAt, error: 'UTA did not come back within timeout' }
}
