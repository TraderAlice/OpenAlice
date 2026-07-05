import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  WorkspaceRootLockedError,
  acquireWorkspaceProcessLock,
} from './process-lock.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'oa-root-lock-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('workspace process root lock', () => {
  it('prevents two Alice backends from owning the same launcher root', async () => {
    const first = await acquireWorkspaceProcessLock(root, {
      owner: { pid: 111, hostname: 'host-a' },
      isProcessAlive: () => true,
    })

    await expect(
      acquireWorkspaceProcessLock(root, {
        owner: { pid: 222, hostname: 'host-b' },
        isProcessAlive: () => true,
      }),
    ).rejects.toBeInstanceOf(WorkspaceRootLockedError)

    await first.release()
    const second = await acquireWorkspaceProcessLock(root, {
      owner: { pid: 222, hostname: 'host-b' },
      isProcessAlive: () => true,
    })
    await second.release()
  })

  it('reclaims a stale lock when the recorded owner process is gone', async () => {
    const stale = await acquireWorkspaceProcessLock(root, {
      owner: { pid: 111, hostname: 'host-a' },
      isProcessAlive: () => true,
    })

    const fresh = await acquireWorkspaceProcessLock(root, {
      owner: { pid: 222, hostname: 'host-b' },
      isProcessAlive: (pid) => pid !== 111,
    })

    const owner = JSON.parse(await readFile(join(root, 'state', 'runtime.lock', 'owner.json'), 'utf8')) as {
      pid: number
      hostname: string
    }
    expect(owner.pid).toBe(222)
    expect(owner.hostname).toBe('host-b')

    // The stale handle must not remove the fresh owner when it later releases.
    await stale.release()
    await fresh.release()
  })
})
