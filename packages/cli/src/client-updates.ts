/** Local control-plane adapter shared by relay and Electron. Project switching
 * cannot change this store's path, policy, installed identity or observation. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { DiscoveryStore, type ClientReleaseObservation, type ClientUpdatePreferences, type ClientUpdateSnapshot } from '@traderalice/update-lifecycle'
import { resolveSupervisorRootPath } from './launch-context.ts'
import { CLI_VERSION } from './install-source.mjs'
import { checkForUpdate } from './update.mjs'

const policySchema = z.object({ autoCheck: z.boolean() }).strict()
const INTERVAL = 60 * 60_000
export function clientUpdatePreferencesPath(): string {
  return join(resolveSupervisorRootPath(), 'client-updates.json')
}
export async function readClientUpdatePreferences(path = clientUpdatePreferencesPath()): Promise<ClientUpdatePreferences> {
  try { return policySchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { autoCheck: true }
    throw error
  }
}
export interface ClientUpdateServiceOptions {
  path?: string
  kind?: 'cli' | 'desktop'
  discover?: (currentVersion: string) => Promise<Omit<ClientReleaseObservation, 'currentVersion'>>
}
export class ClientUpdateService {
  private readonly discovery = new DiscoveryStore<ClientReleaseObservation>({ successTtlMs: INTERVAL, errorTtlMs: 60_000 })
  private readonly path: string
  private readonly kind: 'cli' | 'desktop'
  readonly currentVersion = CLI_VERSION
  private readonly discover: () => Promise<ClientReleaseObservation>
  private writes: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  constructor(options: ClientUpdateServiceOptions = {}) {
    this.path = options.path ?? clientUpdatePreferencesPath()
    this.kind = options.kind ?? 'cli'
    const discover = options.discover ?? (async () => {
      const result = await checkForUpdate({ currentVersion: this.currentVersion })
      // Project/UI consumers receive observations, never installer commands.
      return { status: result.status === 'available' || result.status === 'current' ? result.status : 'unsupported',
        channel: result.channel ?? 'unknown',
        latestVersion: result.latestVersion, latestCommit: 'latestCommit' in result ? result.latestCommit : undefined,
        releaseNotesUrl: result.releaseNotesUrl, message: result.message }
    })
    this.discover = async () => ({ ...await discover(this.currentVersion), currentVersion: this.currentVersion })
  }
  async snapshot(): Promise<ClientUpdateSnapshot> {
    return { kind: this.kind, currentVersion: this.currentVersion,
      preferences: await readClientUpdatePreferences(this.path), discovery: this.discovery.getSnapshot() }
  }
  async check(): Promise<ClientUpdateSnapshot> {
    await this.discovery.check(this.discover, true)
    return this.snapshot()
  }
  /** Called after shell paint. No startup network dependency; repeated tabs join
   * one host-owned check/timer. The native adapter may prepare a download, but
   * installation/restart is still a separately approved owner command. */
  activate(): void {
    if (this.timer) return
    this.stopped = false
    const run = () => { void this.applyCheckPolicy().catch(() => undefined) }
    run()
    this.timer = setInterval(run, INTERVAL)
    this.timer.unref?.()
  }
  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
  private async applyCheckPolicy(): Promise<void> {
    const preferences = await readClientUpdatePreferences(this.path)
    if (!this.stopped && preferences.autoCheck) await this.discovery.check(this.discover)
  }
  async savePreferences(input: unknown): Promise<ClientUpdateSnapshot> {
    const value = policySchema.parse(input)
    const write = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
        await rename(temporary, this.path)
      } finally { await rm(temporary, { force: true }) }
    })
    this.writes = write
    await write
    if (this.timer) void this.applyCheckPolicy().catch(() => undefined)
    return this.snapshot()
  }
}
