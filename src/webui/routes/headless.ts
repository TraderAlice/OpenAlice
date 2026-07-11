/**
 * /api/headless — the headless-task management plane (cross-workspace).
 *
 * Read-only view over `WorkspaceService.headlessTasks`: "what are the workers
 * doing" across every workspace. Dispatch lives at POST /api/workspaces/:id/
 * headless (it's per-workspace); this surface is the panel + per-task status
 * + its normalized reply/tool timeline and size-capped runtime diagnostics.
 */
import { open, readFile, stat } from 'node:fs/promises'

import { Hono } from 'hono'

import {
  headlessLogPaths,
  type HeadlessTaskRecord,
  type HeadlessTaskStatus,
} from '../../workspaces/headless-task-registry.js'
import {
  parseHeadlessOutputText,
  type HeadlessStructuredOutput,
} from '../../workspaces/headless-output.js'
import type { WorkspaceService } from '../../workspaces/service.js'

const STATUSES = new Set<HeadlessTaskStatus>(['running', 'done', 'failed', 'interrupted'])

const DEFAULT_TAIL_BYTES = 64 * 1024
const MAX_TAIL_BYTES = 1024 * 1024
const STRUCTURED_TAIL_BYTES = 2 * 1024 * 1024

/** Read the last `tailBytes` of a file; null when the file doesn't exist. */
async function readTail(
  path: string,
  tailBytes: number,
): Promise<{ text: string; sizeBytes: number; truncated: boolean } | null> {
  let sizeBytes: number
  try {
    sizeBytes = (await stat(path)).size
  } catch {
    return null
  }
  const start = Math.max(0, sizeBytes - tailBytes)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(sizeBytes - start)
    await fh.read(buf, 0, buf.length, start)
    return { text: buf.toString('utf8'), sizeBytes, truncated: start > 0 }
  } finally {
    await fh.close()
  }
}

async function readStructured(path: string): Promise<HeadlessStructuredOutput | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as HeadlessStructuredOutput
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.blocks)) return null
    return parsed
  } catch {
    return null
  }
}

export function createHeadlessRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()
  const publicTask = (task: HeadlessTaskRecord) => {
    const { agentSessionId: _nativeSessionId, ...publicFields } = task
    return {
      ...publicFields,
      resumable: !!svc.resumeRegistry.get(task.resumeId)?.agentSessionId,
    }
  }

  // GET /api/headless?wsId=&status=&limit=&cursor= → tasks, newest-first.
  // Cursor is the last task id from the previous page. Unlike an offset it
  // remains stable while polling inserts newer runs at the front.
  app.get('/', (c) => {
    const wsId = c.req.query('wsId') || undefined
    const statusRaw = c.req.query('status')
    const status =
      statusRaw && STATUSES.has(statusRaw as HeadlessTaskStatus)
        ? (statusRaw as HeadlessTaskStatus)
        : undefined
    const limitRaw = Number(c.req.query('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100
    const cursor = c.req.query('cursor') || undefined
    const filters = { wsId, status }
    const page = svc.headlessTasks.list({ ...filters, cursor, limit: limit + 1 })
    const hasMore = page.length > limit
    const tasks = hasMore ? page.slice(0, limit) : page
    const total = svc.headlessTasks.count(filters)
    return c.json({
      tasks: tasks.map(publicTask),
      page: {
        total,
        hasMore,
        nextCursor: hasMore ? tasks.at(-1)?.taskId ?? null : null,
      },
      summary: {
        done:
          !status || status === 'done'
            ? svc.headlessTasks.count({ wsId, status: 'done' })
            : 0,
        needsAttention:
          (!status || status === 'failed'
            ? svc.headlessTasks.count({ wsId, status: 'failed' })
            : 0) +
          (!status || status === 'interrupted'
            ? svc.headlessTasks.count({ wsId, status: 'interrupted' })
            : 0),
      },
      capacity: {
        running: svc.headlessTasks.runningCount(),
        limit: svc.headlessCapacity,
      },
    })
  })

  // GET /api/headless/:taskId → one task's record.
  app.get('/:taskId', (c) => {
    const rec = svc.headlessTasks.get(c.req.param('taskId'))
    if (!rec) return c.json({ error: 'not_found' }, 404)
    return c.json(publicTask(rec))
  })

  // GET /api/headless/:taskId/output?tailBytes= → compact normalized output +
  // bounded diagnostic tails. New runs read their live structured snapshot;
  // historical runs are parsed from a bounded stdout tail. Streams are null
  // when the log file doesn't exist (legacy task, manual deletion, or spawn failure).
  app.get('/:taskId/output', async (c) => {
    const taskId = c.req.param('taskId')
    const rec = svc.headlessTasks.get(taskId)
    if (!rec) return c.json({ error: 'not_found' }, 404)
    const tailRaw = Number(c.req.query('tailBytes'))
    const tailBytes =
      Number.isFinite(tailRaw) && tailRaw > 0 ? Math.min(tailRaw, MAX_TAIL_BYTES) : DEFAULT_TAIL_BYTES
    const paths = headlessLogPaths(svc.headlessLogsDir, taskId)
    const [stdout, stderr, storedStructured] = await Promise.all([
      readTail(paths.stdout, tailBytes),
      readTail(paths.stderr, tailBytes),
      readStructured(paths.structured),
    ])
    const adapter = svc.adapters.get(rec.agent)
    const structuredSource = storedStructured ? null : await readTail(paths.stdout, STRUCTURED_TAIL_BYTES)
    const structured = storedStructured ?? parseHeadlessOutputText({
      text: structuredSource?.text ?? '',
      ...(adapter?.extractHeadlessOutputEvents
        ? { extractEvents: adapter.extractHeadlessOutputEvents.bind(adapter) }
        : {}),
      ...(adapter?.extractHeadlessAssistantText
        ? { extractAssistantText: adapter.extractHeadlessAssistantText.bind(adapter) }
        : {}),
      sourceTruncated: structuredSource?.truncated ?? false,
      runStillActive: rec.status === 'running',
    })
    return c.json({ taskId, status: rec.status, structured, stdout, stderr })
  })

  return app
}
