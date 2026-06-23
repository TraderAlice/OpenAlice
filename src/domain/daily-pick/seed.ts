/**
 * Seeds the three daily-pick cron jobs into data/cron/jobs.json on startup.
 * Idempotent — checks by job name before adding.
 *
 *   __daily_pick_open__    09:00 weekdays  → pick today's stock
 *   __daily_pick_hourly__  10–13 weekdays  → hourly council deliberation
 *   __daily_pick_wrap__    14:00 Friday    → 5-day wrap + lessons RAG ingest
 */

import type { CronEngine } from '../../task/cron/engine.js'
import {
  DAILY_PICK_OPEN_JOB,
  DAILY_PICK_HOURLY_JOB,
  DAILY_PICK_WRAP_JOB,
} from './listener.js'

interface SeedJob {
  name: string
  cron: string
}

const JOBS: SeedJob[] = [
  // 09:00 Mon-Fri (Taipei) → server runs in UTC, so 01:00 UTC.
  { name: DAILY_PICK_OPEN_JOB, cron: '0 1 * * 1-5' },
  // 10:00–13:00 Mon-Fri (Taipei) = 02:00–05:00 UTC, hourly.
  { name: DAILY_PICK_HOURLY_JOB, cron: '0 2-5 * * 1-5' },
  // 14:00 Fri (Taipei) = 06:00 UTC.
  { name: DAILY_PICK_WRAP_JOB, cron: '0 6 * * 5' },
]

export async function seedDailyPickCronJobs(engine: CronEngine): Promise<void> {
  const existing = await engine.list()
  const byName = new Map(existing.map((j) => [j.name, j]))

  for (const seed of JOBS) {
    if (byName.has(seed.name)) continue
    await engine.add({
      name: seed.name,
      schedule: { kind: 'cron', cron: seed.cron },
      payload: '', // internal jobs ignore payload
      enabled: true,
    })
    console.log(`[daily-pick] seeded cron job: ${seed.name} (${seed.cron} UTC)`)
  }
}
