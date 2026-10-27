import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rename, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { seal, unseal, type SealedEnvelope } from '../../../core/sealing.js'
import { checkpointSchema, type NewsCheckpoint, type NewsSubscription } from './contract.js'

export function checkpointIdentity(hash: string, row: Pick<NewsSubscription, 'id' | 'sourceKey' | 'params'>): string {
  return createHash('sha256').update(JSON.stringify([hash, row.id, row.sourceKey, Object.entries(row.params).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])).digest('hex')
}

/** Private additive state; immutable artifacts and existing archives stay byte-identical. */
export class NewsModuleState {
  constructor(private readonly directory: string) {}
  private path(prefix: string, identity: string, key?: string): string {
    if (!/^[a-f0-9]{64}$/.test(identity) || (key !== undefined && !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(key))) throw new Error('Invalid news state identity')
    return join(this.directory, `.${prefix}-${identity}${key ? '-' + key : ''}.json`)
  }
  private async write(path: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const temporary = path + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' })
      await chmod(temporary, 0o600)
      await rename(temporary, path)
    } finally { await rm(temporary, { force: true }) }
  }
  async checkpoint(identity: string): Promise<NewsCheckpoint> {
    const path = this.path('checkpoint', identity)
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      if (value.version !== 1) throw new Error('Unsupported checkpoint version')
      return checkpointSchema.parse(value.checkpoint)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('News checkpoint unavailable; collection stopped to avoid skipping content')
    }
  }
  async commitCheckpoint(identity: string, value: NewsCheckpoint): Promise<void> {
    await this.write(this.path('checkpoint', identity), { version: 1, checkpoint: checkpointSchema.parse(value) })
  }
  async credential(hash: string, key: string): Promise<string | undefined> {
    const path = this.path('credential', hash, key)
    try {
      const value = await unseal<{ version: number; value: string }>(JSON.parse(await readFile(path, 'utf8')) as SealedEnvelope)
      if (value.version !== 1 || typeof value.value !== 'string' || !value.value) throw new Error('Invalid credential')
      return value.value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('News credential unavailable; replace or clear it')
    }
  }
  async setCredential(hash: string, key: string, value: string): Promise<void> {
    const path = this.path('credential', hash, key)
    if (!value || value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error('Invalid news credential')
    await this.write(path, await seal({ version: 1, value }))
  }
  async clearCredential(hash: string, key: string): Promise<void> { await rm(this.path('credential', hash, key), { force: true }) }
  async clearArtifactCredentials(hash: string): Promise<void> {
    this.path('credential', hash)
    let names: string[]
    try { names = await readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of names) if (name.startsWith('.credential-' + hash + '-') && name.endsWith('.json')) await rm(join(this.directory, name), { force: true })
  }
}
