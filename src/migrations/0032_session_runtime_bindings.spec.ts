import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateSessionRuntimeBindings } from './0032_session_runtime_bindings/index.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'session-runtime-binding-migration-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0032 Session runtime bindings', () => {
  it('versions the identity envelope without fabricating a binding and keeps a backup', async () => {
    const state = join(root, 'state')
    const backup = join(root, 'backup')
    const path = join(state, 'resume-identities.json')
    await mkdir(state, { recursive: true })
    const original = {
      version: 1,
      records: [{ resumeId: 'resume-calm-river', wsId: 'ws-1', agent: 'pi' }],
    }
    await writeFile(path, JSON.stringify(original))

    await expect(migrateSessionRuntimeBindings(root, { backupRoot: backup }))
      .resolves.toEqual({ updated: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ...original, version: 2 })
    expect(JSON.parse(await readFile(join(backup, 'resume-identities.json'), 'utf8')))
      .toEqual(original)
    await expect(migrateSessionRuntimeBindings(root, { backupRoot: backup }))
      .resolves.toEqual({ updated: false })
  })

  it('leaves missing, malformed, and future files untouched', async () => {
    await expect(migrateSessionRuntimeBindings(root)).resolves.toEqual({ updated: false })
    const path = join(root, 'state', 'resume-identities.json')
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(path, '{broken')
    await expect(migrateSessionRuntimeBindings(root)).resolves.toEqual({ updated: false })
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })
})
