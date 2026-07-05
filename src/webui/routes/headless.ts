/**
 * /api/headless — the headless-task management plane (cross-workspace).
 *
 * Read-only view over `WorkspaceService.headlessTasks`: "what are the workers
 * doing" across every workspace. Dispatch lives at POST /api/workspaces/:id/
 * headless (it's per-workspace); this surface is the panel + per-task status
 * + the task's full output log (the run's own stdout/stderr on disk).
 */
import { open, stat } from 'node:fs/promises'

import { Hono } from 'hono'

import { headlessLogPaths, type HeadlessTaskStatus } from '../../workspaces/headless-task-registry.js'
import type { WorkspaceService } from '../../workspaces/service.js'

const STATUSES = new Set<HeadlessTaskStatus>(['running', 'done', 'failed', 'interrupted'])

const DEFAULT_TAIL_BYTES = 64 * 1024
const MAX_TAIL_BYTES = 1024 * 1024

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

export function createHeadlessRoutes(svc: WorkspaceService): Hono {
  const app = new Hono()

  // GET /api/headless?wsId=&status=&limit=  → tasks, newest-first.
  app.get('/', (c) => {
    const wsId = c.req.query('wsId') || undefined
    const statusRaw = c.req.query('status')
    const status =
      statusRaw && STATUSES.has(statusRaw as HeadlessTaskStatus)
        ? (statusRaw as HeadlessTaskStatus)
        : undefined
    const limitRaw = Number(c.req.query('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100
    return c.json({ tasks: svc.headlessTasks.list({ wsId, status, limit }) })
  })

  // GET /api/headless/:taskId → one task's record.
  app.get('/:taskId', (c) => {
    const rec = svc.headlessTasks.get(c.req.param('taskId'))
    if (!rec) return c.json({ error: 'not_found' }, 404)
    return c.json(rec)
  })

  // GET /api/headless/:taskId/output?tailBytes= → the task's on-disk log
  // tails (stdout = the agent's structured event stream, stderr = CLI
  // diagnostics). Tail-bounded so a chatty run can't flood the panel; the
  // viewer polls this while the task runs. Streams are null when the log file
  // doesn't exist (task predates log capture, or spawn failed before output).
  app.get('/:taskId/output', async (c) => {
    const taskId = c.req.param('taskId')
    const rec = svc.headlessTasks.get(taskId)
    if (!rec) return c.json({ error: 'not_found' }, 404)
    const tailRaw = Number(c.req.query('tailBytes'))
    const tailBytes =
      Number.isFinite(tailRaw) && tailRaw > 0 ? Math.min(tailRaw, MAX_TAIL_BYTES) : DEFAULT_TAIL_BYTES
    const paths = headlessLogPaths(svc.headlessLogsDir, taskId)
    const [stdout, stderr] = await Promise.all([
      readTail(paths.stdout, tailBytes),
      readTail(paths.stderr, tailBytes),
    ])
    return c.json({ taskId, status: rec.status, stdout, stderr })
  })

  return app
}
