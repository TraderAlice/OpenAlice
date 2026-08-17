import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectPreviousUpdateAttempt, recordUpdateAttempt } from './update-attempt.js'

describe('desktop update attempt persistence', () => {
  it('keeps a fresh handoff pending and resolves it after the version changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-update-attempt-'))
    const path = join(dir, 'update-attempt.json')
    const now = new Date('2026-08-01T00:00:00.000Z')
    await recordUpdateAttempt(path, {
      fromVersion: '0.87.0-beta',
      toVersion: '0.88.0-beta',
      now,
    })

    await expect(inspectPreviousUpdateAttempt(path, '0.87.0-beta', {
      now: new Date(now.getTime() + 30_000),
    })).resolves.toMatchObject({ kind: 'pending' })
    await expect(inspectPreviousUpdateAttempt(path, '0.88.0-beta', {
      now: new Date(now.getTime() + 45_000),
    })).resolves.toMatchObject({ kind: 'succeeded' })
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('archives a stale attempt when the old version launches again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-update-attempt-'))
    const path = join(dir, 'update-attempt.json')
    const now = new Date('2026-08-01T00:00:00.000Z')
    await recordUpdateAttempt(path, {
      fromVersion: '0.87.0-beta',
      toVersion: '0.88.0-beta',
      now,
    })

    const result = await inspectPreviousUpdateAttempt(path, '0.87.0-beta', {
      now: new Date(now.getTime() + 120_000),
    })
    expect(result).toMatchObject({ kind: 'failed', archivedPath: `${path}.failed` })
    await expect(readFile(`${path}.failed`, 'utf8')).resolves.toContain('0.88.0-beta')
  })
})
