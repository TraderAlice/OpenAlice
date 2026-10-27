import { mkdir, readFile, writeFile, rename, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { seal, unseal, type SealedEnvelope } from '../../../core/sealing.js'

function canonicalBase(value: string): string {
  const u = new URL(value)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Invalid RSSHub base URL')
  return u.href.replace(/\/+$/, '')
}

export class RssHubSecretStore {
  private readonly path: string
  constructor(private readonly directory: string) { this.path = join(directory, 'rsshub-key.json') }
  private async read(): Promise<{ baseUrl: string; key: string } | null> {
    try {
      const value = await unseal<{baseUrl:string;key:string}>(JSON.parse(await readFile(this.path, 'utf8')) as SealedEnvelope)
      if (typeof value.baseUrl !== 'string' || typeof value.key !== 'string' || !value.key) throw new Error('Invalid sealed credential')
      return value
    }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('RSSHub credential unavailable; replace or clear it') }
  }
  async status() {
    try { const v = await this.read(); return { configured: !!v, available: true, baseUrl: v?.baseUrl ?? null } }
    catch { return { configured: true, available: false, baseUrl: null } }
  }
  async assertBase(base: string): Promise<void> {
    const v = await this.read()
    if (v && v.baseUrl !== canonicalBase(base)) throw new Error('Clear the RSSHub credential before changing its instance')
  }
  async get(base: string): Promise<string | undefined> {
    const value = await this.read()
    if (!value) return undefined
    if (value.baseUrl !== canonicalBase(base)) throw new Error('RSSHub credential belongs to another instance')
    const url = new URL(value.baseUrl)
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('RSSHub credentials require HTTPS outside loopback')
    return value.key
  }
  async set(base: string, key: string): Promise<void> {
    if (!key || key.length > 4096 || /[\r\n\0]/.test(key)) throw new Error('Enter a non-empty RSSHub key (maximum 4096 characters)')
    const baseUrl = canonicalBase(base)
    const u = new URL(baseUrl)
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error('RSSHub credentials require HTTPS outside loopback')
    const envelope = await seal({ baseUrl, key })
    await mkdir(this.directory, { recursive: true })
    const temp = this.path + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(envelope) + '\n', { mode: 0o600, flag: 'wx' })
      await chmod(temp, 0o600)
      await rename(temp, this.path)
    } finally { await rm(temp, { force: true }) }
  }
  async clear(): Promise<void> { await rm(this.path, { force: true }) }
}
