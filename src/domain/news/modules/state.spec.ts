import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NewsModuleState, checkpointIdentity } from './state.js'

const row = { id: 'one', sourceKey: 'latest', params: { query: 'from:example', role: 'official' } }
const hash = 'a'.repeat(64)
let home: string
let state: NewsModuleState
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'news-module-state-')); state = new NewsModuleState(home) })
afterEach(async () => { vi.restoreAllMocks(); await rm(home, { recursive: true, force: true }) })

it('scopes query checkpoints to the exact artifact and canonical params', async () => {
  const id = checkpointIdentity(hash, row)
  expect(checkpointIdentity(hash, { ...row, params: { role: 'official', query: 'from:example' } })).toBe(id)
  await state.commitCheckpoint(id, { sinceId: '123' })
  expect(await new NewsModuleState(home).checkpoint(id)).toEqual({ sinceId: '123' })
  expect(await state.checkpoint(checkpointIdentity('b'.repeat(64), row))).toBeNull()
  expect(await state.checkpoint(checkpointIdentity(hash, { ...row, params: { query: 'from:other' } }))).toBeNull()
})
it('seals credentials, keeps them private per artifact and distinguishes unavailable from missing', async () => {
  await state.setCredential(hash, 'apiKey', 'unit-test-private-value')
  expect(await state.credential(hash, 'apiKey')).toBe('unit-test-private-value')
  expect(await state.credential('b'.repeat(64), 'apiKey')).toBeUndefined()
  const file = (await readdir(home)).find(name => name.startsWith('.credential-'))!
  expect(await readFile(join(home, file), 'utf8')).not.toContain('unit-test-private-value')
  await writeFile(join(home, file), '{}')
  await expect(state.credential(hash, 'apiKey')).rejects.toThrow(/unavailable/i)
  await state.clearCredential(hash, 'apiKey')
  expect(await state.credential(hash, 'apiKey')).toBeUndefined()
})
it('rejects invalid state identities and corrupt checkpoint versions', async () => {
  await expect(state.commitCheckpoint('../outside', null)).rejects.toThrow()
  const id = checkpointIdentity(hash, row)
  await state.commitCheckpoint(id, null)
  const file = (await readdir(home)).find(name => name.startsWith('.checkpoint-'))!
  await writeFile(join(home, file), '{"version":99,"checkpoint":null}')
  await expect(state.checkpoint(id)).rejects.toThrow(/checkpoint/i)
})
