import { headers } from './client'
import type { CronJob, CronSchedule } from './types'

export const cronApi = {
  async list(): Promise<{ jobs: CronJob[] }> {
    const res = await fetch('/api/cron/jobs')
    if (!res.ok) throw new Error('Failed to load cron jobs')
    return res.json()
  },

  async add(params: { name: string; payload: string; schedule: CronSchedule; enabled?: boolean }): Promise<{ id: string }> {
    const res = await fetch('/api/cron/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Create failed' }))
      throw new Error(err.error || 'Create failed')
    }
    return res.json()
  },

  async update(id: string, patch: Partial<{ name: string; payload: string; schedule: CronSchedule; enabled: boolean }>): Promise<void> {
    const res = await fetch(`/api/cron/jobs/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Update failed' }))
      throw new Error(err.error || 'Update failed')
    }
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/cron/jobs/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Delete failed' }))
      throw new Error(err.error || 'Delete failed')
    }
  },

  async runNow(id: string): Promise<void> {
    const res = await fetch(`/api/cron/jobs/${id}/run`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Run failed' }))
      throw new Error(err.error || 'Run failed')
    }
  },
}
