/**
 * Read-only projection of the agent runtime lifecycle journal.
 * Occupancy history for Automation; never a spawn or replay-control surface.
 */
import { Hono } from 'hono'
import { z } from 'zod'

import { isAgentRuntimeEventType } from '../../workspaces/agent-runtime-log.js'
import type { WorkspaceService } from '../../workspaces/service.js'

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function createAgentRuntimeLogRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()
  const activityJournal = svc.activityJournal ?? svc.agentRuntimeLog

  app.post('/sonner-test', async (c) => {
    const parsed = z.object({
      state: z.enum(['running', 'success', 'error']),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'state must be running, success, or error' }, 400)

    const now = Date.now()
    const entry = await activityJournal.record('dev.sonner_test', {
      workspaceId: '__dev__',
      resumeId: `sonner-test-${now}`,
      agent: 'Dev Panel',
      testState: parsed.data.state,
      message: `Sonner ${parsed.data.state} test`,
    })
    return c.json({ entry }, 201)
  })

  app.post('/product-test', async (c) => {
    const parsed = z.object({
      family: z.enum(['inbox', 'news']),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'family must be inbox or news' }, 400)

    const now = Date.now()
    if (parsed.data.family === 'inbox') {
      const recorder = activityJournal.registerFamily({
        family: 'inbox',
        types: ['inbox.received'] as const,
      })
      const entry = await recorder.record('inbox.received', {
        workspaceId: '__dev__',
        workspaceLabel: 'Frontend lab',
        inboxEntryId: `inbox-test-${now}`,
        agent: 'Dev Panel',
        originKind: 'headless',
        summary: 'Product activity journal Inbox test',
        documentCount: 0,
      })
      return c.json({ entry }, 201)
    }

    const recorder = activityJournal.registerFamily({
      family: 'news',
      types: ['news.ingested'] as const,
    })
    const entry = await recorder.record('news.ingested', {
      newsItemId: now,
      dedupKey: `dev:${now}`,
      title: 'Product activity journal News test',
      source: 'Frontend lab',
      publishedAt: now,
      ingestSource: 'dev',
    })
    return c.json({ entry }, 201)
  })

  app.get('/', async (c) => {
    const afterSeqRaw = c.req.query('afterSeq')
    const typeRaw = c.req.query('type')
    const type = typeRaw && isAgentRuntimeEventType(typeRaw) ? typeRaw : undefined
    if (afterSeqRaw !== undefined) {
      const afterSeq = Math.max(0, Number.parseInt(afterSeqRaw, 10) || 0)
      const limit = Math.min(500, positiveInteger(c.req.query('limit'), 100))
      const entries = await activityJournal.read({
        afterSeq,
        limit,
        ...(type ? { type } : {}),
      })
      return c.json({
        entries,
        lastSeq: activityJournal.lastSeq(),
      })
    }
    const page = positiveInteger(c.req.query('page'), 1)
    const pageSize = Math.min(100, positiveInteger(c.req.query('pageSize'), 50))
    const family = c.req.query('family')?.trim() || undefined
    const types = c.req.query('types')
      ?.split(',')
      .map((value) => value.trim())
      .filter(isAgentRuntimeEventType)
    const result = await activityJournal.query({
      page,
      pageSize,
      ...(type ? { type } : {}),
      ...(!type && types?.length ? { types } : {}),
      ...(!type && !types?.length && family ? { family } : {}),
    })
    return c.json({
      ...result,
      lastSeq: activityJournal.lastSeq(),
    })
  })

  return app
}
