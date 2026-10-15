import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectPreviousUpdateAttempt, recordUpdateAttempt } from './update-attempt.js'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'openalice-update-attempt-'))
  temporaryDirectories.push(path)
  return path
}

describe('desktop update attempt persistence', () => {
  it('keeps a fresh handoff pending and resolves it after the approved version starts', async () => {
    const dir = await temporaryDirectory()
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
    const dir = await temporaryDirectory()
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

it('does not report success when an unapproved newer binary starts', async () => {
  const dir = await temporaryDirectory()
  const path = join(dir, 'update-attempt.json')
  const now = new Date('2026-08-01T00:00:00.000Z')
  await recordUpdateAttempt(path, { fromVersion: '0.94.1', toVersion: '0.94.2', now })
  await expect(inspectPreviousUpdateAttempt(path, '0.94.3', { now })).resolves.toMatchObject({ kind: 'failed' })
  await expect(readFile(`${path}.failed`, 'utf8')).resolves.toContain('0.94.2')
})
