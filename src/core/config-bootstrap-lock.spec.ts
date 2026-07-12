import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireRuntimeLock } from '@traderalice/guardian-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { withConfigBootstrapLock } from './config-bootstrap-lock.js'

const roots: string[] = []

async function lockPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-config-bootstrap-'))
  roots.push(root)
  return join(root, 'config-bootstrap.lock')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('withConfigBootstrapLock', () => {
  it('serializes concurrent config bootstraps', async () => {
    const lockDir = await lockPath()
    let active = 0
    let maxActive = 0
    const run = async () => withConfigBootstrapLock(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 40))
      active -= 1
    }, { lockDir, waitMs: 5_000, pollMs: 5 })

    await Promise.all([run(), run()])

    expect(maxActive).toBe(1)
  })

  it('waits for a live owner without taking it over', async () => {
    const lockDir = await lockPath()
    const owner = await acquireRuntimeLock(lockDir, {
      launcher: 'live-config-bootstrap-test',
      heartbeatMs: 0,
    })

    await expect(withConfigBootstrapLock(async () => undefined, {
      lockDir,
      waitMs: 25,
      pollMs: 5,
    })).rejects.toThrow(new RegExp(`pid=${process.pid}`))

    await owner.release()
  })

  it('reclaims a lock whose owner process is gone', async () => {
    const lockDir = await lockPath()
    const stale = await acquireRuntimeLock(lockDir, {
      launcher: 'dead-config-bootstrap-test',
      pid: 2_147_483_647,
      processStartedAt: 0,
      heartbeatMs: 0,
    })
    let ran = false

    await withConfigBootstrapLock(async () => {
      ran = true
    }, { lockDir, waitMs: 5_000, pollMs: 5 })

    expect(ran).toBe(true)
    await stale.release()
  })

  it('releases ownership when config bootstrap throws', async () => {
    const lockDir = await lockPath()

    await expect(withConfigBootstrapLock(async () => {
      throw new Error('bootstrap failed')
    }, { lockDir, waitMs: 5_000, pollMs: 5 })).rejects.toThrow('bootstrap failed')

    await expect(withConfigBootstrapLock(async () => 'recovered', {
      lockDir,
      waitMs: 5_000,
      pollMs: 5,
    })).resolves.toBe('recovered')
  })
})
