import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkspaceMetadata, WORKSPACE_METADATA_REL, writeWorkspaceMetadata } from './workspace-metadata.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'workspace-meta-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeMetadata(raw: string): Promise<void> {
  await mkdir(join(dir, '.alice'), { recursive: true })
  await writeFile(join(dir, WORKSPACE_METADATA_REL), raw, 'utf8')
}

describe('workspace metadata', () => {
  it('reports absent when the workspace has no self-description file', async () => {
    expect(await readWorkspaceMetadata(dir)).toEqual({ ok: false, reason: 'absent' })
  })

  it('reads display metadata from .alice/workspace.json', async () => {
    await writeMetadata(JSON.stringify({
      displayName: 'NVDA earnings thesis',
      description: 'Research the earnings setup.',
    }))

    expect(await readWorkspaceMetadata(dir)).toEqual({
      ok: true,
      metadata: {
        displayName: 'NVDA earnings thesis',
        description: 'Research the earnings setup.',
      },
    })
  })

  it('trims accepted string fields', async () => {
    await writeMetadata(JSON.stringify({ displayName: '  Macro desk  ' }))

    expect(await readWorkspaceMetadata(dir)).toEqual({
      ok: true,
      metadata: { displayName: 'Macro desk' },
    })
  })

  it('reports invalid JSON without throwing', async () => {
    await writeMetadata('{ "displayName": ')

    const r = await readWorkspaceMetadata(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('invalid')
      if (r.reason === 'invalid') expect(r.error).toMatch(/invalid JSON/)
    }
  })

  it('rejects unknown keys so the file cannot become a shadow registry', async () => {
    await writeMetadata(JSON.stringify({ displayName: 'A', id: 'not-authority' }))

    const r = await readWorkspaceMetadata(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('invalid')
      if (r.reason === 'invalid') expect(r.error).toMatch(/Unrecognized key/)
    }
  })

  it('writes canonical JSON through the same schema the reader uses', async () => {
    await writeWorkspaceMetadata(dir, { displayName: '  AAPL review  ' })

    expect(await readWorkspaceMetadata(dir)).toEqual({
      ok: true,
      metadata: { displayName: 'AAPL review' },
    })
  })
})
