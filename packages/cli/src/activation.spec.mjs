import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  confirmActivation,
  markActivationRolledBack,
  readActivationReceipt,
  recordPendingActivation,
} from './activation.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice direct-install activation receipt', () => {
  it('records, confirms, and rolls back activation state atomically', async () => {
    const layout = await makeLayout()
    const pending = await recordPendingActivation(layout, {
      activeRelease: '0.92.0-linux-x64-bbbbbbbbbbbbbbbb',
      previousRelease: '0.91.0-linux-x64-aaaaaaaaaaaaaaaa',
      productVersion: '0.92.0',
      activatedAt: '2026-08-30T01:00:00.000Z',
    })
    expect(await readActivationReceipt(layout)).toEqual(pending)

    const confirmed = await confirmActivation(layout, pending, {
      now: () => new Date('2026-08-30T01:01:00.000Z'),
    })
    expect(confirmed).toMatchObject({
      state: 'confirmed',
      confirmedAt: '2026-08-30T01:01:00.000Z',
    })

    const nextPending = await recordPendingActivation(layout, {
      activeRelease: pending.activeRelease,
      previousRelease: pending.previousRelease,
      productVersion: pending.productVersion,
      activatedAt: '2026-08-30T01:01:30.000Z',
    })
    const rolledBack = await markActivationRolledBack(layout, nextPending, { code: 'early-exit' }, {
      now: () => new Date('2026-08-30T01:02:00.000Z'),
    })
    expect(rolledBack).toMatchObject({
      state: 'rolled_back',
      rolledBackAt: '2026-08-30T01:02:00.000Z',
      failureCode: 'EARLY_EXIT',
    })
  })

  it('does not overwrite a newer activation receipt with a stale confirmation', async () => {
    const layout = await makeLayout()
    const stale = await recordPendingActivation(layout, {
      activeRelease: '0.92.0-linux-x64-bbbbbbbbbbbbbbbb',
      previousRelease: '0.91.0-linux-x64-aaaaaaaaaaaaaaaa',
      productVersion: '0.92.0',
      activatedAt: '2026-08-30T01:00:00.000Z',
    })
    const current = await recordPendingActivation(layout, {
      activeRelease: '0.93.0-linux-x64-cccccccccccccccc',
      previousRelease: '0.92.0-linux-x64-bbbbbbbbbbbbbbbb',
      productVersion: '0.93.0',
      activatedAt: '2026-08-30T01:01:00.000Z',
    })

    await expect(confirmActivation(layout, stale)).resolves.toEqual(current)
    await expect(readActivationReceipt(layout)).resolves.toEqual(current)
  })

  it('rejects corrupt metadata instead of silently trusting it', async () => {
    const layout = await makeLayout()
    await writeFile(layout.activationPath, '{broken')
    await expect(readActivationReceipt(layout)).rejects.toThrow('activation metadata is unreadable')
  })

  it('removes a temporary receipt when the atomic rename fails', async () => {
    const layout = await makeLayout()
    const renameImpl = vi.fn(async () => {
      const error = new Error('rename failed')
      error.code = 'EIO'
      throw error
    })
    await expect(recordPendingActivation(layout, {
      activeRelease: '0.92.0-linux-x64-bbbbbbbbbbbbbbbb',
      previousRelease: null,
      productVersion: '0.92.0',
    }, { renameImpl })).rejects.toMatchObject({ code: 'EIO' })
    expect(await readdir(join(layout.cliDir))).toEqual([])
  })
})

async function makeLayout() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-activation-'))
  temporaryPaths.push(root)
  const cliDir = join(root, 'cli')
  await mkdir(cliDir, { recursive: true })
  return {
    cliDir,
    activationPath: join(cliDir, 'activation.json'),
  }
}
