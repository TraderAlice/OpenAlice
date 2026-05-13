import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { writeFile, rm, stat } from 'node:fs/promises'
import { pruneBrainArtifacts } from './0006_retire_brain/index.js'

function tempPath(ext: string): string {
  return join(tmpdir(), `migration-0006-${randomUUID()}.${ext}`)
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

describe('0006_retire_brain', () => {
  let commitPath: string
  let frontalLobePath: string

  beforeEach(() => {
    commitPath = tempPath('json')
    frontalLobePath = tempPath('md')
  })

  afterEach(async () => {
    await rm(commitPath, { force: true })
    await rm(frontalLobePath, { force: true })
  })

  it('removes both files when present', async () => {
    await writeFile(commitPath, '{"commits":[],"head":null,"state":{"frontalLobe":""}}')
    await writeFile(frontalLobePath, 'stale note')

    const result = await pruneBrainArtifacts(commitPath, frontalLobePath)

    expect(result.removed.sort()).toEqual([commitPath, frontalLobePath].sort())
    expect(await exists(commitPath)).toBe(false)
    expect(await exists(frontalLobePath)).toBe(false)
  })

  it('no-op when neither file exists', async () => {
    const result = await pruneBrainArtifacts(commitPath, frontalLobePath)
    expect(result.removed).toEqual([])
  })

  it('removes only the file that exists when the other is missing', async () => {
    await writeFile(commitPath, '{}')
    const result = await pruneBrainArtifacts(commitPath, frontalLobePath)
    expect(result.removed).toEqual([commitPath])
    expect(await exists(commitPath)).toBe(false)
  })

  it('idempotent — second run after pruning is a no-op', async () => {
    await writeFile(commitPath, '{}')
    await writeFile(frontalLobePath, 'note')

    await pruneBrainArtifacts(commitPath, frontalLobePath)
    const second = await pruneBrainArtifacts(commitPath, frontalLobePath)

    expect(second.removed).toEqual([])
  })
})
