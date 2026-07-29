import { parseDuration } from '../../core/duration.js'
import type { Migration } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function repairSnapshotInterval(raw: unknown): { value: unknown; updated: boolean } {
  if (!isRecord(raw) || !Object.prototype.hasOwnProperty.call(raw, 'every')) {
    return { value: raw, updated: false }
  }

  const every = raw.every
  if (typeof every !== 'string' || parseDuration(every) === null) {
    return { value: { ...raw, every: '15m' }, updated: true }
  }

  const normalized = every.trim()
  if (normalized === every) return { value: raw, updated: false }
  return { value: { ...raw, every: normalized }, updated: true }
}

export const migration: Migration = {
  id: '0027_repair_snapshot_interval',
  appVersion: '0.87.0-beta',
  introducedAt: '2026-07-29',
  affects: ['snapshot.json'],
  summary: 'Repair invalid historical portfolio snapshot intervals before strict duration validation loads them.',
  rationale: 'Older Portfolio UI versions persisted arbitrary strings even though the UTA snapshot pump accepts only positive h/m/s durations.',
  up: async (ctx) => {
    const snapshot = await ctx.readJson('snapshot.json')
    const repaired = repairSnapshotInterval(snapshot)
    if (repaired.updated) await ctx.writeJson('snapshot.json', repaired.value)
  },
}
