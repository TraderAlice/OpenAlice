import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessController } from './process-control.js'

const renameFault = vi.hoisted(() => ({
  calls: 0,
  code: 'EPERM',
  remaining: 0,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      renameFault.calls += 1
      if (renameFault.remaining > 0) {
        renameFault.remaining -= 1
        throw Object.assign(new Error(`simulated ${renameFault.code}`), { code: renameFault.code })
      }
      return actual.rename(...args)
    },
  }
})

const { acquireRuntimeLock } = await import('./runtime-lock.js')

let home: string
let originalPlatform: PropertyDescriptor | undefined
let retryDelays: number[]
let controller: ProcessController

beforeEach(async () => {
  home = join(tmpdir(), `guardian-runtime-windows-retry-${process.pid}-${Math.random().toString(16).slice(2)}`)
  await mkdir(home, { recursive: true })
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  renameFault.calls = 0
  renameFault.code = 'EPERM'
  renameFault.remaining = 0
  retryDelays = []
  controller = {
    isAlive: () => true,
    startedAt: async () => 10_000,
    machineId: async () => 'machine-a',
    signalTree: async () => {},
    sleep: async (ms) => {
      retryDelays.push(ms)
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
})

afterEach(async () => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('Windows owner replacement retry', () => {
  it('keeps ownership through transient heartbeat rename failures', async () => {
    const lockDir = join(home, 'runtime.lock')
    let ownershipError: Error | null = null
    const lock = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 5,
      processController: controller,
      onOwnershipLost: (error) => { ownershipError = error },
    })
    const callsAfterAcquire = renameFault.calls
    renameFault.remaining = 2

    await waitFor(() => renameFault.calls >= callsAfterAcquire + 3)

    expect(ownershipError).toBeNull()
    expect(retryDelays).toEqual([10, 25])
    await expect(readFile(join(lockDir, 'owner.json'), 'utf8')).resolves.toContain(lock.owner.token)
    await lock.release()
  })

  it('stops retrying after the bounded transient-error schedule', async () => {
    const lockDir = join(home, 'runtime.lock')
    renameFault.remaining = 10

    await expect(acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toMatchObject({ code: 'EPERM' })

    expect(renameFault.calls).toBe(5)
    expect(retryDelays).toEqual([10, 25, 50, 100])
  })

  it('does not retry unrelated rename failures', async () => {
    const lockDir = join(home, 'runtime.lock')
    renameFault.code = 'EIO'
    renameFault.remaining = 1

    await expect(acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toMatchObject({ code: 'EIO' })

    expect(renameFault.calls).toBe(1)
    expect(retryDelays).toEqual([])
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for the heartbeat rename retry')
}
