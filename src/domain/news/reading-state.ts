import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { z } from 'zod'
import { newsReadProgressSchema } from './reading-contract.js'

const timestamp = z.number().finite().nonnegative()
const stateSchema = z.object({
  version: z.literal(1),
  followedTopics: z.array(z.string().trim().min(1).max(80)).optional(),
  reports: z.record(z.string().regex(/^\d+$/), z.object({ status: z.enum(['pending', 'review', 'failed']), reason: z.string().max(1000), attempts: z.number().int().nonnegative(), retryAt: timestamp.optional() }).strict()),
  events: z.record(z.string(), z.object({ following: z.boolean().optional(), observedDevelopments: z.array(z.string()).optional(), bookmarked: z.boolean().optional(), locked: z.boolean().optional(), important: z.boolean().optional(), firstSeen: timestamp.optional(), lastDevelopmentAt: timestamp.optional(), readProgress: newsReadProgressSchema.nullable().optional() }).strict()),
  history: z.array(z.object({ at: timestamp, coverage: z.array(z.string()), scores: z.record(z.string(), z.number().finite().nonnegative()) }).strict()).max(192),
}).strict()
export type ReadingState = z.infer<typeof stateSchema>

/** One optional, project-owned sidecar; original reports and event artifacts stay unchanged. */
export class NewsReadingState {
  private writes: Promise<unknown> = Promise.resolve()
  constructor(private path: string) {}

  async read(): Promise<ReadingState> {
    try { return stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, reports: {}, events: {}, history: [] }
      throw error
    }
  }

  update(change: (state: ReadingState) => boolean | void): Promise<ReadingState> {
    const next = this.writes.then(async () => {
      const state = await this.read()
      if (change(state) === false) return state
      stateSchema.parse(state)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.path)
      } finally { await rm(temporary, { force: true }) }
      return state
    })
    this.writes = next.catch(() => {})
    return next
  }
}
