import { describe, expect, it, vi } from 'vitest'

import { createScheduleRoutes } from './schedule.js'
import type { ScheduleSnapshot } from '../../workspaces/schedule/declaration.js'
import type { WorkspaceService } from '../../workspaces/service.js'

describe('GET /api/schedule', () => {
  it('returns ScheduleSnapshot including deferred and parked skipState transparently', async () => {
    const snapshot: ScheduleSnapshot = {
      workspaces: [
        {
          wsId: 'w1',
          tag: 'w1',
          status: 'ok',
          tasks: [
            {
              id: 'healthy',
              issue: 'Healthy task',
              when: { kind: 'every', every: '30m' },
              what: 'go',
              assignee: '@new-each-run',
              enabled: true,
              lastFiredAtMs: 1_700_000_000_000,
              nextDueAtMs: 1_700_001_800_000,
            },
            {
              id: 'cooling',
              issue: 'Cooling down task',
              when: { kind: 'every', every: '6h' },
              what: 'go',
              assignee: '@resume-1',
              enabled: true,
              lastFiredAtMs: null,
              nextDueAtMs: 1_700_000_000_000,
              skipState: {
                kind: 'deferred',
                code: 'session_blocked',
                reason: 'User interrupted this Session; new starts are cooling down.',
                retryAtMs: 1_700_000_600_000,
                sinceMs: 1_700_000_000_000,
              },
            },
            {
              id: 'blocked',
              issue: 'Blocked task',
              when: { kind: 'cron', cron: '0 9 * * *' },
              what: 'go',
              assignee: '@resume-2',
              enabled: true,
              lastFiredAtMs: null,
              nextDueAtMs: 1_700_000_000_000,
              skipState: {
                kind: 'parked',
                code: 'session_blocked',
                reason: 'Three consecutive executions failed.',
                sinceMs: 1_700_000_000_000,
              },
            },
          ],
        },
      ],
    }

    const svc = {
      scheduleSnapshot: vi.fn(async () => snapshot),
    } as unknown as WorkspaceService
    const app = createScheduleRoutes(svc)

    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(snapshot)
  })
})
