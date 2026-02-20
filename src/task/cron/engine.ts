/**
 * Cron Engine — job scheduler that fires events into the EventLog.
 *
 * Three schedule types:
 *   - at:    one-shot, ISO timestamp ("2025-03-01T09:00:00Z")
 *   - every: interval ("2h", "30m", "5m30s")
 *   - cron:  5-field expression ("0 9 * * 1-5")
 *
 * On fire: appends a `cron.fire` event to the EventLog. Does NOT call
 * the AI engine directly — that's the listener's job.
 *
 * Jobs are stored as a single JSON file on disk (atomic write).
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EventLog } from '../../core/event-log.js'

// ==================== Types ====================

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string }

export interface CronJobState {
  nextRunAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: 'ok' | 'error' | null
  consecutiveErrors: number
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: CronSchedule
  payload: string
  state: CronJobState
  createdAt: number
}

export interface CronFirePayload {
  jobId: string
  jobName: string
  payload: string
}

// ==================== CRUD Types ====================

export interface CronJobCreate {
  name: string
  schedule: CronSchedule
  payload: string
  enabled?: boolean
}

export interface CronJobPatch {
  name?: string
  schedule?: CronSchedule
  payload?: string
  enabled?: boolean
}

// ==================== Engine Interface ====================

export interface CronEngine {
  start(): Promise<void>
  stop(): void
  add(params: CronJobCreate): Promise<string>
  update(id: string, patch: CronJobPatch): Promise<void>
  remove(id: string): Promise<void>
  list(): CronJob[]
  runNow(id: string): Promise<void>
  get(id: string): CronJob | undefined
}

export interface CronEngineOpts {
  eventLog: EventLog
  storePath?: string
  /** Inject clock for testing. */
  now?: () => number
}

// ==================== Factory ====================

export function createCronEngine(opts: CronEngineOpts): CronEngine {
  const { eventLog } = opts
  const storePath = opts.storePath ?? 'data/cron/jobs.json'
  const now = opts.now ?? Date.now

  let jobs: CronJob[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  // ---------- persistence ----------

  async function load(): Promise<void> {
    try {
      const raw = await readFile(storePath, 'utf-8')
      const data = JSON.parse(raw)
      jobs = Array.isArray(data.jobs) ? data.jobs : []
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        jobs = []
        return
      }
      throw err
    }
  }

  async function save(): Promise<void> {
    await mkdir(dirname(storePath), { recursive: true })
    const tmp = `${storePath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ jobs }, null, 2), 'utf-8')
    await rename(tmp, storePath)
  }

  // ---------- timer ----------

  function armTimer(): void {
    if (stopped) return

    const nextMs = jobs
      .filter((j) => j.enabled && j.state.nextRunAtMs !== null)
      .reduce<number | null>((min, j) => {
        const n = j.state.nextRunAtMs!
        return min === null ? n : Math.min(min, n)
      }, null)

    if (nextMs === null) return

    // Clamp to 60s to prevent long setTimeout drift
    const delayMs = Math.max(0, Math.min(nextMs - now(), 60_000))
    timer = setTimeout(onTick, delayMs)
  }

  async function onTick(): Promise<void> {
    timer = null
    if (stopped) return

    const currentMs = now()
    const dueJobs = jobs.filter(
      (j) => j.enabled && j.state.nextRunAtMs !== null && j.state.nextRunAtMs <= currentMs,
    )

    for (const job of dueJobs) {
      await fireJob(job, currentMs)
    }

    if (!stopped) {
      await save()
      armTimer()
    }
  }

  async function fireJob(job: CronJob, currentMs: number): Promise<void> {
    job.state.lastRunAtMs = currentMs

    try {
      await eventLog.append('cron.fire', {
        jobId: job.id,
        jobName: job.name,
        payload: job.payload,
      } satisfies CronFirePayload)

      job.state.lastStatus = 'ok'
      job.state.consecutiveErrors = 0
    } catch (err) {
      job.state.lastStatus = 'error'
      job.state.consecutiveErrors += 1
    }

    // Compute next run
    if (job.schedule.kind === 'at') {
      // One-shot — disable after execution
      job.enabled = false
      job.state.nextRunAtMs = null
    } else if (job.state.consecutiveErrors > 0) {
      job.state.nextRunAtMs = currentMs + errorBackoffMs(job.state.consecutiveErrors)
    } else {
      job.state.nextRunAtMs = computeNextRun(job.schedule, currentMs)
    }
  }

  // ---------- public ----------

  return {
    async start() {
      await load()

      const currentMs = now()
      for (const job of jobs) {
        if (!job.enabled) continue
        if (job.state.nextRunAtMs === null || job.state.nextRunAtMs < currentMs) {
          job.state.nextRunAtMs = computeNextRun(job.schedule, currentMs)
          if (job.schedule.kind === 'at' && job.state.nextRunAtMs === null) {
            job.enabled = false
          }
        }
      }

      await save()
      armTimer()
    },

    stop() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
    },

    async add(params) {
      const id = randomUUID().slice(0, 8)
      const currentMs = now()

      const job: CronJob = {
        id,
        name: params.name,
        enabled: params.enabled ?? true,
        schedule: params.schedule,
        payload: params.payload,
        state: {
          nextRunAtMs: computeNextRun(params.schedule, currentMs),
          lastRunAtMs: null,
          lastStatus: null,
          consecutiveErrors: 0,
        },
        createdAt: currentMs,
      }

      jobs.push(job)
      await save()

      // Re-arm in case this job is sooner
      if (timer) { clearTimeout(timer); timer = null }
      armTimer()

      return id
    },

    async update(id, patch) {
      const job = jobs.find((j) => j.id === id)
      if (!job) throw new Error(`cron job not found: ${id}`)

      if (patch.name !== undefined) job.name = patch.name
      if (patch.payload !== undefined) job.payload = patch.payload
      if (patch.enabled !== undefined) job.enabled = patch.enabled

      if (patch.schedule !== undefined) {
        job.schedule = patch.schedule
        job.state.nextRunAtMs = computeNextRun(patch.schedule, now())
        job.state.consecutiveErrors = 0
      }

      await save()
      if (timer) { clearTimeout(timer); timer = null }
      armTimer()
    },

    async remove(id) {
      const idx = jobs.findIndex((j) => j.id === id)
      if (idx === -1) throw new Error(`cron job not found: ${id}`)
      jobs.splice(idx, 1)
      await save()
    },

    list() {
      return [...jobs]
    },

    async runNow(id) {
      const job = jobs.find((j) => j.id === id)
      if (!job) throw new Error(`cron job not found: ${id}`)
      await fireJob(job, now())
      await save()
    },

    get(id) {
      return jobs.find((j) => j.id === id)
    },
  }
}

// ==================== Schedule Helpers ====================

export function computeNextRun(schedule: CronSchedule, afterMs: number): number | null {
  switch (schedule.kind) {
    case 'at': {
      const t = new Date(schedule.at).getTime()
      return Number.isNaN(t) ? null : (t > afterMs ? t : null)
    }
    case 'every': {
      const ms = parseDuration(schedule.every)
      return ms ? afterMs + ms : null
    }
    case 'cron':
      return nextCronFire(schedule.cron, afterMs)
  }
}

export function parseDuration(s: string): number | null {
  const re = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/
  const m = re.exec(s.trim())
  if (!m) return null
  const h = Number(m[1] ?? 0)
  const min = Number(m[2] ?? 0)
  const sec = Number(m[3] ?? 0)
  if (h === 0 && min === 0 && sec === 0) return null
  return (h * 3600 + min * 60 + sec) * 1000
}

/**
 * Minimal cron expression parser (minute hour dom month dow).
 * Returns the next fire time after `afterMs`, or null if unparseable.
 */
export function nextCronFire(expr: string, afterMs: number): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const fields = parts.map(parseFieldValues)
  if (fields.some((f) => f === null)) return null

  const [minutes, hours, doms, months, dows] = fields as number[][]

  const start = new Date(afterMs)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)

  const limit = afterMs + 366 * 24 * 60 * 60 * 1000
  const cursor = new Date(start)

  while (cursor.getTime() < limit) {
    if (
      months.includes(cursor.getMonth() + 1) &&
      doms.includes(cursor.getDate()) &&
      dows.includes(cursor.getDay()) &&
      hours.includes(cursor.getHours()) &&
      minutes.includes(cursor.getMinutes())
    ) {
      return cursor.getTime()
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  return null
}

function parseFieldValues(field: string): number[] | null {
  const result: number[] = []

  for (const part of field.split(',')) {
    const stepMatch = /^(\*|\d+-\d+)\/(\d+)$/.exec(part)
    if (stepMatch) {
      const step = Number(stepMatch[2])
      if (step === 0) return null
      let start: number, end: number
      if (stepMatch[1] === '*') {
        start = 0; end = 59
      } else {
        const [a, b] = stepMatch[1].split('-').map(Number)
        start = a; end = b
      }
      for (let i = start; i <= end; i += step) result.push(i)
      continue
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch) {
      const a = Number(rangeMatch[1])
      const b = Number(rangeMatch[2])
      for (let i = a; i <= b; i++) result.push(i)
      continue
    }

    if (part === '*') {
      for (let i = 0; i <= 59; i++) result.push(i)
      continue
    }

    const n = Number(part)
    if (Number.isNaN(n)) return null
    result.push(n)
  }

  return result.length > 0 ? result : null
}

// ==================== Error Backoff ====================

const ERROR_BACKOFF_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(consecutiveErrors - 1, ERROR_BACKOFF_MS.length - 1)
  return ERROR_BACKOFF_MS[Math.max(0, idx)]
}
