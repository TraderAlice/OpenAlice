import type { ScheduleSnapshot } from '../../api/schedule'

const HOUR = 60 * 60 * 1000
const now = Date.now()

export const demoScheduleSnapshot: ScheduleSnapshot = {
  workspaces: [
    {
      wsId: 'demo-ws-auto-quant',
      tag: 'auto-quant',
      status: 'ok',
      tasks: [
        {
          id: 'morning-scan',
          issue: 'Morning movers scan',
          when: { kind: 'cron', cron: '30 8 * * 1-5' },
          what: 'Pull pre-market movers and overnight news for the watchlist, write a brief, then push it to the inbox.',
          enabled: true,
          lastFiredAtMs: now - HOUR,
          nextDueAtMs: now + 16 * HOUR,
        },
        {
          id: 'thesis-watch',
          issue: 'Thesis invalidation watch',
          when: { kind: 'every', every: '1h' },
          what: 'Re-check the thesis vs the latest quote; alert only if the invalidation level broke, otherwise exit.',
          agent: 'codex',
          enabled: true,
          lastFiredAtMs: now - HOUR / 2,
          nextDueAtMs: now + HOUR / 2,
        },
      ],
    },
    {
      wsId: 'demo-ws-macro',
      tag: 'macro-research',
      status: 'ok',
      tasks: [
        {
          id: 'weekly-digest',
          issue: 'Weekly macro digest',
          when: { kind: 'cron', cron: '0 16 * * 5' },
          what: 'Summarize the week across tracked entities and push a digest to the inbox.',
          enabled: false,
          lastFiredAtMs: null,
          nextDueAtMs: null,
        },
      ],
    },
  ],
}
