/**
 * Brain route — exposes Alice's frontal-lobe state + commit history.
 *
 * Read-only dashboard feed. Reads `data/brain/commit.json` (written by
 * `brainOnCommit` in main.ts) so the data is session-agnostic — brain changes
 * from chat sessions show up alongside heartbeat ones.
 */

import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import type { BrainExportState, BrainCommit } from '../../../domain/brain/index.js'

const BRAIN_FILE = 'data/brain/commit.json'

export interface BrainStateResponse {
  frontalLobe: string
  commits: BrainCommit[]
}

const EMPTY: BrainStateResponse = { frontalLobe: '', commits: [] }

export function createBrainRoutes() {
  const app = new Hono()

  app.get('/state', async (c) => {
    try {
      const raw = await readFile(BRAIN_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as BrainExportState
      // Legacy data may include emotion-type commits — strip them so the UI
      // doesn't have to know about the retired dimension.
      const commits = (parsed.commits ?? []).filter((c) => c.type === 'frontal_lobe')
      const res: BrainStateResponse = {
        frontalLobe: parsed.state?.frontalLobe ?? '',
        commits,
      }
      return c.json(res)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return c.json(EMPTY)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}
