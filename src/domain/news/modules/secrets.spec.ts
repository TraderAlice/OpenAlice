import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home: string
let savedHome: string | undefined

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'openalice-rsshub-secrets-'))
  process.env['OPENALICE_HOME'] = home
  vi.resetModules()
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

async function createSecretStore() {
  const { RssHubSecretStore } = await import('./secrets.js')
  return new RssHubSecretStore(join(home, 'data', 'news-modules'))
}

const BASE = 'http://127.0.0.1:1200'
const KEY = 'rsshub-test-private-key'
const KEY_PATH = () => join(home, 'data', 'news-modules', 'rsshub-key.json')

describe('RSSHub credential storage', () => {
  it('seals the credential on disk and exposes key-free status', async () => {
    const store = await createSecretStore()
    await store.set(BASE, KEY)

    const envelope = JSON.parse(await readFile(KEY_PATH(), 'utf8')) as unknown
    const { isSealedEnvelope } = await import('../../../core/sealing.js')
    expect(isSealedEnvelope(envelope)).toBe(true)
    expect(JSON.stringify(envelope)).not.toContain(KEY)
    expect(await store.get(BASE)).toBe(KEY)

    const status = await store.status()
    expect(status).toEqual({ configured: true, available: true, baseUrl: BASE })
    expect(JSON.stringify(status)).not.toContain(KEY)
  })

  it('reports a corrupted seal unavailable instead of returning a credential', async () => {
    const store = await createSecretStore()
    await store.set(BASE, KEY)

    const envelope = JSON.parse(await readFile(KEY_PATH(), 'utf8')) as { tag: string }
    envelope.tag = (envelope.tag[0] === 'A' ? 'B' : 'A') + envelope.tag.slice(1)
    await writeFile(KEY_PATH(), JSON.stringify(envelope))

    expect(await store.status()).toEqual({ configured: true, available: false, baseUrl: null })
    await expect(store.get(BASE)).rejects.toThrow('RSSHub credential unavailable; replace or clear it')
  })

  it('rejects non-loopback HTTP instances', async () => {
    const store = await createSecretStore()

    await expect(store.set('http://rsshub.example.test', KEY)).rejects.toThrow(
      'RSSHub credentials require HTTPS outside loopback',
    )
    expect(await store.status()).toEqual({ configured: false, available: true, baseUrl: null })
  })
})
