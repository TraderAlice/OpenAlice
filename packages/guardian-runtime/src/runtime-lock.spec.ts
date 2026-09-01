import { closeSync, existsSync, openSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProcessController } from './process-control.js'
import {
  RuntimeAlreadyRunningError,
  acquireGuardianRuntime,
  acquireOpenAliceRuntimeLocks,
  acquireRuntimeLock,
  inspectRuntimeLock,
  prepareOpenAliceRuntime,
  resolveRuntimeLockOwnerAuthority,
  runtimeLockDir,
} from './runtime-lock.js'

class FakeProcesses implements ProcessController {
  readonly alive = new Map<number, boolean>()
  readonly starts = new Map<number, number>()
  readonly signals: Array<{ pid: number; signal: NodeJS.Signals }> = []
  readonly cascade = new Map<number, number[]>()
  ignoreTerm = new Set<number>()
  currentMachineId = 'machine-a'
  machineIdHook: (() => Promise<void>) | undefined
  sleepHook: ((ms: number) => Promise<void>) | undefined

  add(pid: number, startedAt = 1_000): void {
    this.alive.set(pid, true)
    this.starts.set(pid, startedAt)
  }

  isAlive(pid: number): boolean {
    return this.alive.get(pid) === true
  }

  async startedAt(pid: number): Promise<number | null> {
    return this.starts.get(pid) ?? null
  }

  async machineId(): Promise<string> {
    await this.machineIdHook?.()
    return this.currentMachineId
  }

  async signalTree(pid: number, signal: NodeJS.Signals): Promise<void> {
    this.signals.push({ pid, signal })
    if (signal === 'SIGTERM' && this.ignoreTerm.has(pid)) return
    this.alive.set(pid, false)
    for (const child of this.cascade.get(pid) ?? []) this.alive.set(child, false)
  }

  async sleep(ms: number): Promise<void> {
    await this.sleepHook?.(ms)
  }
}

let home: string
let controller: FakeProcesses
const PRIOR_FENCING_INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
const CURRENT_FENCING_INSTANCE_ID = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  home = join(tmpdir(), `guardian-runtime-${process.pid}-${Math.random().toString(16).slice(2)}`)
  await mkdir(home, { recursive: true })
  controller = new FakeProcesses()
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function railwayOwner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    pid: 101,
    hostname: 'prior-container',
    machineId: 'env:railway-service-service-test',
    token: 'prior-owner',
    launcher: 'guardian-cli-server',
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    fencingProtocol: 'railway-flock-v1',
    fencingInstanceId: PRIOR_FENCING_INSTANCE_ID,
    processStartedAt: new Date(10_000).toISOString(),
    ...overrides,
  }
}

describe('runtime lock ownership', () => {
  it('treats an exact Railway service identity without a locked fence as observer-only', () => {
    expect(resolveRuntimeLockOwnerAuthority({
      OPENALICE_SERVICE_MANAGER: 'railway',
      OPENALICE_MACHINE_ID: 'railway-service-service-test',
      RAILWAY_ENVIRONMENT_ID: 'environment-test',
      RAILWAY_SERVICE_ID: 'service-test',
    })).toBe('railway-observer')
    expect(resolveRuntimeLockOwnerAuthority({
      OPENALICE_SERVICE_MANAGER: 'railway',
      OPENALICE_MACHINE_ID: 'railway-service-other',
      RAILWAY_ENVIRONMENT_ID: 'environment-test',
      RAILWAY_SERVICE_ID: 'service-test',
    })).toBe('process')
  })

  it.runIf(process.platform === 'linux' && existsSync('/dev/shm'))('recognizes only an inherited FD that actually holds the Railway lifecycle flock', async () => {
    const volumeRoot = '/dev/shm'
    const railwayHome = join(volumeRoot, `openalice-fence-${process.pid}-${Math.random().toString(16).slice(2)}`)
    const installDir = join(railwayHome, 'install')
    await mkdir(installDir, { recursive: true })
    const fd = openSync(volumeRoot, 'r')
    try {
      const locked = spawnSync('/usr/bin/flock', ['--exclusive', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', fd],
      })
      expect(locked.status).toBe(0)
      expect(resolveRuntimeLockOwnerAuthority({
        OPENALICE_HOME: railwayHome,
        OPENALICE_INSTALL_DIR: installDir,
        OPENALICE_RAILWAY_VOLUME_ROOT: volumeRoot,
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        OPENALICE_RAILWAY_FENCE_FD: String(fd),
        OPENALICE_RAILWAY_INSTANCE_ID: CURRENT_FENCING_INSTANCE_ID,
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      })).toBe('railway-fenced-handoff')
      expect(resolveRuntimeLockOwnerAuthority({
        OPENALICE_HOME: railwayHome,
        OPENALICE_INSTALL_DIR: installDir,
        OPENALICE_RAILWAY_VOLUME_ROOT: volumeRoot,
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        OPENALICE_RAILWAY_FENCE_FD: String(fd),
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      })).toBe('railway-observer')
    } finally {
      closeSync(fd)
      await rm(railwayHome, { recursive: true, force: true })
    }
  })

  it('publishes inspectable owner metadata and releases cleanly', async () => {
    controller.add(101, 10_000)
    const lockDir = join(home, 'runtime.lock')
    const lock = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      launcher: 'dev',
      heartbeatMs: 0,
      processController: controller,
    })

    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 101, launcher: 'dev' },
      heartbeatStale: false,
    })
    await lock.release()
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({ state: 'missing' })
  })

  it('never restores a retired marker into a newer claim-directory generation', async () => {
    controller.add(101, 10_000)
    const lockDir = join(home, 'runtime-with-claim-directory-reuse.lock')
    const claimDir = join(lockDir, 'reclaiming')
    const newToken = '55555555-5555-4555-8555-555555555555'
    let markerRetired: (() => void) | undefined
    let resumeCleanup: (() => void) | undefined
    let paused = false
    const markerWasRetired = new Promise<void>((resolvePromise) => { markerRetired = resolvePromise })
    const cleanupResume = new Promise<void>((resolvePromise) => { resumeCleanup = resolvePromise })
    controller.sleepHook = async (ms) => {
      if (ms !== 0 || paused) return
      paused = true
      markerRetired?.()
      await cleanupResume
    }

    const acquisition = acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    await markerWasRetired
    await rmdir(claimDir)
    await mkdir(claimDir)
    const newMarker = join(claimDir, `owner.${newToken}.json`)
    await writeFile(newMarker, JSON.stringify({
      schemaVersion: 1,
      pid: 505,
      hostname: hostname(),
      machineId: 'machine-a',
      token: newToken,
      launcher: 'runtime-lock-reaper',
      acquiredAt: new Date(50_000).toISOString(),
      heartbeatAt: new Date(50_000).toISOString(),
      processStartedAt: new Date(50_000).toISOString(),
    }))
    resumeCleanup?.()

    const lock = await acquisition
    expect(await readdir(claimDir)).toEqual([`owner.${newToken}.json`])
    expect(JSON.parse(await readFile(newMarker, 'utf8'))).toMatchObject({ token: newToken })

    controller.sleepHook = undefined
    await rm(newMarker)
    await rmdir(claimDir)
    await lock.release()
  })

  it('refuses a second live owner without takeover', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime.lock')
    const first = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })

    await expect(acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    expect(controller.signals).toEqual([])
    await first.release()
  })

  it('reclaims a dead owner regardless of hostname drift', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime.lock')
    const stale = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    controller.alive.set(101, false)

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 202 },
    })

    await stale.release()
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 202 },
    })
    await fresh.release()
  })

  it('reclaims a stale lock even when an older reaper left its marker behind', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime-with-abandoned-reclaimer.lock')
    const stale = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    await mkdir(join(lockDir, 'reclaiming'))
    controller.alive.set(101, false)

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      initializationGraceMs: 0,
      processController: controller,
    })

    await stale.release()
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 202 },
    })
    await fresh.release()
  })

  it('recovers a complete mutation claim whose claimant process died', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime-with-dead-claimant.lock')
    const stale = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    const claimDir = join(lockDir, 'reclaiming')
    const deadClaimToken = '44444444-4444-4444-8444-444444444444'
    await mkdir(claimDir)
    await writeFile(join(claimDir, `owner.${deadClaimToken}.json`), JSON.stringify({
      schemaVersion: 1,
      pid: 404,
      hostname: hostname(),
      machineId: 'machine-a',
      token: deadClaimToken,
      launcher: 'runtime-lock-reaper',
      acquiredAt: new Date(40_000).toISOString(),
      heartbeatAt: new Date(40_000).toISOString(),
      processStartedAt: new Date(40_000).toISOString(),
    }))
    controller.alive.set(101, false)

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 202 },
    })

    await stale.release()
    await fresh.release()
  })

  it('cannot retire a newer mutation-claim generation after inspecting an abandoned one', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    controller.add(505, 50_000)
    const lockDir = join(home, 'runtime-with-replaced-claim.lock')
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    controller.alive.set(101, false)
    const claimDir = join(lockDir, 'reclaiming')
    const oldToken = '44444444-4444-4444-8444-444444444444'
    const newToken = '55555555-5555-4555-8555-555555555555'
    await mkdir(claimDir)
    await writeFile(join(claimDir, `owner.${oldToken}.json`), JSON.stringify({
      schemaVersion: 1,
      pid: 404,
      hostname: hostname(),
      machineId: 'machine-a',
      token: oldToken,
      launcher: 'runtime-lock-reaper',
      acquiredAt: new Date(40_000).toISOString(),
      heartbeatAt: new Date(40_000).toISOString(),
      processStartedAt: new Date(40_000).toISOString(),
    }))

    let machineIdReads = 0
    let inspectedOldClaim: (() => void) | undefined
    let resumeRecovery: (() => void) | undefined
    const oldClaimInspected = new Promise<void>((resolvePromise) => { inspectedOldClaim = resolvePromise })
    const recoveryResume = new Promise<void>((resolvePromise) => { resumeRecovery = resolvePromise })
    controller.machineIdHook = async () => {
      machineIdReads += 1
      if (machineIdReads === 3) {
        inspectedOldClaim?.()
        await recoveryResume
      }
    }

    const acquisition = acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })
    await oldClaimInspected
    await rm(join(claimDir, `owner.${oldToken}.json`))
    await rmdir(claimDir)
    await mkdir(claimDir)
    const newClaimPath = join(claimDir, `owner.${newToken}.json`)
    await writeFile(newClaimPath, JSON.stringify({
      schemaVersion: 1,
      pid: 505,
      hostname: hostname(),
      machineId: 'machine-a',
      token: newToken,
      launcher: 'runtime-lock-reaper',
      acquiredAt: new Date(50_000).toISOString(),
      heartbeatAt: new Date(50_000).toISOString(),
      processStartedAt: new Date(50_000).toISOString(),
    }))
    resumeRecovery?.()

    await expect(acquisition).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    controller.machineIdHook = undefined
    expect(JSON.parse(await readFile(newClaimPath, 'utf8'))).toMatchObject({ token: newToken, pid: 505 })
  })

  it('serializes two reapers that inspected the same stale lock generation', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    controller.add(303, 30_000)
    const lockDir = join(home, 'runtime-with-concurrent-reapers.lock')
    const stale = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    controller.alive.set(101, false)

    let machineIdReads = 0
    let releaseInspectionBarrier: (() => void) | undefined
    const inspectionBarrier = new Promise<void>((resolvePromise) => {
      releaseInspectionBarrier = resolvePromise
    })
    controller.machineIdHook = async () => {
      machineIdReads += 1
      if (machineIdReads === 4) releaseInspectionBarrier?.()
      if (machineIdReads === 3 || machineIdReads === 4) await inspectionBarrier
    }

    const results = await Promise.allSettled([
      acquireRuntimeLock(lockDir, {
        pid: 202,
        processStartedAt: 20_000,
        heartbeatMs: 0,
        processController: controller,
      }),
      acquireRuntimeLock(lockDir, {
        pid: 303,
        processStartedAt: 30_000,
        heartbeatMs: 0,
        processController: controller,
      }),
    ])
    controller.machineIdHook = undefined

    const acquired = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireRuntimeLock>>> => (
      result.status === 'fulfilled'
    ))
    const blocked = results.filter((result) => result.status === 'rejected')
    expect(acquired).toHaveLength(1)
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ reason: expect.any(RuntimeAlreadyRunningError) })
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: acquired[0]!.value.owner.pid },
    })

    await stale.release()
    await acquired[0]!.value.release()
  })

  it('keeps a live owner authoritative even when its heartbeat is stale', async () => {
    controller.add(101, 10_000)
    const lockDir = join(home, 'runtime.lock')
    const lock = await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })

    await expect(inspectRuntimeLock(lockDir, {
      processController: controller,
      staleHeartbeatMs: -1,
    })).resolves.toMatchObject({ state: 'active', heartbeatStale: true })
    await lock.release()
  })

  it('never signals or reclaims an owner recorded on another machine', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime.lock')
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    controller.currentMachineId = 'machine-b'
    controller.alive.set(101, false)

    await expect(inspectRuntimeLock(lockDir, {
      processController: controller,
      staleHeartbeatMs: -1,
    })).resolves.toMatchObject({
      state: 'active',
      heartbeatStale: true,
      reason: expect.stringContaining('another machine'),
    })
    await expect(acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      takeover: true,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toThrow(/another machine/)
    expect(controller.signals).toEqual([])
  })

  it('keeps another Railway container active for an observer regardless of heartbeat age', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    controller.add(202, 20_000)
    const lockDir = join(home, 'railway-runtime.lock')
    const owner = railwayOwner({
      pid: 202,
      hostname: hostname(),
      heartbeatAt: new Date().toISOString(),
      processStartedAt: new Date(20_000).toISOString(),
    })
    await mkdir(lockDir)
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify(owner))

    for (const heartbeatAt of [new Date().toISOString(), new Date(0).toISOString()]) {
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify({ ...owner, heartbeatAt }))
      await expect(inspectRuntimeLock(lockDir, {
        ownerAuthority: 'railway-observer',
        processController: controller,
        staleHeartbeatMs: 1,
      })).resolves.toMatchObject({
        state: 'active',
        reason: expect.stringContaining('observer refuses automatic recovery'),
      })
    }

    await expect(acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      ownerAuthority: 'railway-observer',
      takeover: true,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toThrow(/another Railway container/)
    expect(controller.signals).toEqual([])
  })

  it('uses the fencing instance to replace a prior Railway container with the same hostname and PID', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    controller.add(303, 30_000)
    const lockDir = join(home, 'railway-runtime.lock')
    await mkdir(lockDir)
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify(railwayOwner({
      pid: 303,
      hostname: hostname(),
      processStartedAt: new Date(30_000).toISOString(),
    })))

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 303,
      processStartedAt: 30_000,
      ownerAuthority: 'railway-fenced-handoff',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      heartbeatMs: 0,
      processController: controller,
    })
    expect(fresh.owner).toMatchObject({
      pid: 303,
      fencingProtocol: 'railway-flock-v1',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
    })
    expect(controller.signals).toEqual([])
    await fresh.release()
  })

  it('fails closed when a fenced writer lacks its per-start instance identity', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    const lockDir = join(home, 'railway-missing-instance.lock')

    await expect(acquireRuntimeLock(lockDir, {
      pid: 303,
      processStartedAt: 30_000,
      ownerAuthority: 'railway-fenced-handoff',
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toThrow('missing or invalid Railway fencing instance identity')
  })

  it('fails closed on a legacy Railway owner even while holding the lifecycle fence', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    controller.add(303, 30_000)
    const lockDir = join(home, 'railway-legacy.lock')
    await mkdir(lockDir)
    const legacyOwner = railwayOwner()
    delete legacyOwner['fencingProtocol']
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify(legacyOwner))

    await expect(inspectRuntimeLock(lockDir, {
      ownerAuthority: 'railway-fenced-handoff',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      processController: controller,
    })).resolves.toMatchObject({
      state: 'active',
      reason: expect.stringContaining('does not belong to this Railway service'),
    })

    await expect(acquireRuntimeLock(lockDir, {
      pid: 303,
      processStartedAt: 30_000,
      ownerAuthority: 'railway-fenced-handoff',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    expect(controller.signals).toEqual([])
  })

  it('fails closed when a Railway owner publishes a malformed fencing instance', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    const lockDir = join(home, 'railway-invalid-instance.lock')
    await mkdir(lockDir)
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify(railwayOwner({
      fencingInstanceId: 'not valid',
    })))

    await expect(inspectRuntimeLock(lockDir, {
      ownerAuthority: 'railway-fenced-handoff',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      processController: controller,
    })).resolves.toMatchObject({
      state: 'active',
      reason: expect.stringContaining('does not belong to this Railway service'),
    })
  })

  it('keeps a live Railway sibling with the same fencing instance authoritative', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    controller.add(101, 10_000)
    const lockDir = join(home, 'railway-same-container.lock')
    await mkdir(lockDir)
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      pid: 101,
      hostname: hostname(),
      machineId: 'env:railway-service-service-test',
      token: 'same-container-owner',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date(0).toISOString(),
      heartbeatAt: new Date(0).toISOString(),
      fencingProtocol: 'railway-flock-v1',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      processStartedAt: new Date(10_000).toISOString(),
    }))

    await expect(inspectRuntimeLock(lockDir, {
      ownerAuthority: 'railway-fenced-handoff',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      processController: controller,
      staleHeartbeatMs: -1,
    })).resolves.toMatchObject({
      state: 'active',
      reason: 'owner process is alive but its heartbeat is stale',
    })
  })

  it('keeps missing or foreign Railway identity fail closed', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    for (const [index, machineId] of [undefined, 'env:railway-service-other'].entries()) {
      const lockDir = join(home, `railway-foreign-${index}.lock`)
      await mkdir(lockDir)
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
        schemaVersion: 1,
        pid: 101,
        hostname: 'foreign-container',
        ...(machineId ? { machineId } : {}),
        token: `foreign-${index}`,
        launcher: 'guardian-cli-server',
        acquiredAt: new Date(0).toISOString(),
        heartbeatAt: new Date(0).toISOString(),
      }))

      await expect(inspectRuntimeLock(lockDir, {
        ownerAuthority: 'railway-observer',
        processController: controller,
        staleHeartbeatMs: -1,
      })).resolves.toMatchObject({
        state: 'active',
        reason: expect.stringContaining('does not belong to this Railway service'),
      })
    }
  })

  it('keeps missing or invalid Railway heartbeats observer-only', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    for (const [index, heartbeatAt] of [undefined, 'not-a-date', 0].entries()) {
      const lockDir = join(home, `railway-heartbeat-${index}.lock`)
      await mkdir(lockDir)
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
        schemaVersion: 1,
        pid: 101,
        hostname: 'prior-container',
        machineId: 'env:railway-service-service-test',
        token: `owner-${index}`,
        launcher: 'guardian-cli-server',
        acquiredAt: new Date(0).toISOString(),
        fencingProtocol: 'railway-flock-v1',
        ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
      }))

      await expect(inspectRuntimeLock(lockDir, {
        ownerAuthority: 'railway-observer',
        processController: controller,
        staleHeartbeatMs: -1,
      })).resolves.toMatchObject({
        state: 'active',
        reason: expect.stringContaining('missing or invalid'),
      })
    }
  })

  it('aborts reclamation when owner evidence changes after inspection', async () => {
    controller.currentMachineId = 'env:railway-service-service-test'
    controller.add(202, 20_000)
    const lockDir = join(home, 'railway-racing-owner.lock')
    const ownerPath = join(lockDir, 'owner.json')
    await mkdir(lockDir)
    await writeFile(ownerPath, JSON.stringify(railwayOwner({ heartbeatAt: new Date(0).toISOString() })))
    let machineIdReads = 0
    controller.machineIdHook = async () => {
      machineIdReads += 1
      if (machineIdReads < 2) return
      const latest = JSON.parse(await readFile(ownerPath, 'utf8')) as Record<string, unknown>
      await writeFile(ownerPath, JSON.stringify({
        ...latest,
        heartbeatAt: new Date(machineIdReads * 1_000).toISOString(),
      }))
    }

    await expect(acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      ownerAuthority: 'railway-fenced-handoff',
      fencingInstanceId: CURRENT_FENCING_INSTANCE_ID,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    expect(JSON.parse(await readFile(ownerPath, 'utf8'))).toMatchObject({ token: 'prior-owner' })
  })

  it('performs a controlled takeover before acquiring the lock', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime.lock')
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      takeover: true,
      heartbeatMs: 0,
      processController: controller,
    })
    expect(controller.signals).toEqual([{ pid: 101, signal: 'SIGTERM' }])
    await expect(inspectRuntimeLock(lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 202 },
    })
    await fresh.release()
  })

  it('falls back to SIGKILL when the owner ignores graceful shutdown', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    controller.ignoreTerm.add(101)
    const lockDir = join(home, 'runtime.lock')
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      takeover: true,
      heartbeatMs: 0,
      processController: controller,
    })
    expect(controller.signals).toEqual([
      { pid: 101, signal: 'SIGTERM' },
      { pid: 101, signal: 'SIGKILL' },
    ])
    await fresh.release()
  })

  it('treats a reused pid as stale without killing the unrelated process', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const lockDir = join(home, 'runtime.lock')
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    controller.starts.set(101, 99_000)

    const fresh = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      takeover: true,
      heartbeatMs: 0,
      processController: controller,
    })
    expect(controller.signals).toEqual([])
    expect(controller.isAlive(101)).toBe(true)
    await fresh.release()
  })

  it('allows only one concurrent contender to replace a stale owner', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    controller.add(303, 30_000)
    const lockDir = join(home, 'runtime.lock')
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })
    controller.alive.set(101, false)

    const results = await Promise.allSettled([
      acquireRuntimeLock(lockDir, { pid: 202, processStartedAt: 20_000, heartbeatMs: 0, processController: controller }),
      acquireRuntimeLock(lockDir, { pid: 303, processStartedAt: 30_000, heartbeatMs: 0, processController: controller }),
    ])
    expect(
      results.filter((row) => row.status === 'fulfilled'),
      results.map((row) => row.status === 'rejected' ? String(row.reason) : `winner:${row.value.owner.pid}`).join(' | '),
    ).toHaveLength(1)
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1)
    const winner = results.find((row): row is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireRuntimeLock>>> => row.status === 'fulfilled')!
    const current = await inspectRuntimeLock(lockDir, { processController: controller })
    expect(current.owner?.pid).toBe(winner.value.owner.pid)
    await winner.value.release()
  })

  it('does not reap a directory while its owner metadata is being initialized', async () => {
    const lockDir = join(home, 'runtime.lock')
    await mkdir(lockDir)
    await expect(inspectRuntimeLock(lockDir, {
      processController: controller,
      initializationGraceMs: 60_000,
    })).resolves.toMatchObject({ state: 'initializing' })
  })

  it('reports ownership loss when the heartbeat directory disappears', async () => {
    controller.add(101, 10_000)
    const lockDir = join(home, 'runtime.lock')
    let ownershipError: Error | null = null
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 5,
      processController: controller,
      onOwnershipLost: (err) => { ownershipError = err },
    })
    await rm(lockDir, { recursive: true, force: true })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(ownershipError).toBeInstanceOf(Error)
  })
})

describe('OpenAlice global + legacy lock composition', () => {
  it('keeps exactly one Guardian in front of child startup and supports explicit replacement', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const first = await acquireGuardianRuntime({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces'),
      launcher: 'guardian-dev',
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })

    await expect(acquireGuardianRuntime({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces'),
      launcher: 'guardian-electron',
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    expect(controller.signals).toEqual([])

    const second = await acquireGuardianRuntime({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces'),
      launcher: 'guardian-electron',
      pid: 202,
      processStartedAt: 20_000,
      takeover: true,
      heartbeatMs: 0,
      processController: controller,
    })
    expect(controller.signals).toEqual([{ pid: 101, signal: 'SIGTERM' }])
    await first.release()
    await expect(inspectRuntimeLock(second.lockDir, { processController: controller })).resolves.toMatchObject({
      state: 'active',
      owner: { pid: 202 },
    })
    await second.release()
  })

  it('prevents two launcher roots from writing the same OPENALICE_HOME', async () => {
    controller.add(101, 10_000)
    controller.add(202, 20_000)
    const first = await acquireOpenAliceRuntimeLocks({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces-a'),
      pid: 101,
      processStartedAt: 10_000,
      heartbeatMs: 0,
      processController: controller,
    })

    await expect(acquireOpenAliceRuntimeLocks({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces-b'),
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    await expect(inspectRuntimeLock(join(home, 'workspaces-b', 'state', 'runtime.lock'), {
      processController: controller,
    })).resolves.toMatchObject({ state: 'missing' })
    await first.release()
  })

  it('reads and reclaims the legacy owner shape that caused hostname-drift lockouts', async () => {
    const lockDir = join(home, 'workspaces', 'state', 'runtime.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
      pid: 51515,
      hostname: 'AmedeMacBook-Pro.local',
      token: 'legacy-token',
      acquiredAt: '2026-07-09T00:09:33.243Z',
    }))
    controller.add(202, 20_000)

    const lock = await acquireRuntimeLock(lockDir, {
      pid: 202,
      processStartedAt: 20_000,
      heartbeatMs: 0,
      processController: controller,
    })
    const owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { pid: number }
    expect(owner.pid).toBe(202)
    await lock.release()
  })

  it('Guardian preflight targets the recorded Guardian tree before Alice', async () => {
    controller.add(100, 5_000)
    controller.add(101, 10_000)
    controller.cascade.set(100, [101])
    const lockDir = runtimeLockDir(home)
    await acquireRuntimeLock(lockDir, {
      pid: 101,
      processStartedAt: 10_000,
      guardianPid: 100,
      guardianStartedAt: 5_000,
      heartbeatMs: 0,
      processController: controller,
    })

    await expect(prepareOpenAliceRuntime({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces'),
      processController: controller,
    })).rejects.toBeInstanceOf(RuntimeAlreadyRunningError)
    expect(controller.signals).toEqual([])

    await prepareOpenAliceRuntime({
      userDataHome: home,
      launcherRoot: join(home, 'workspaces'),
      takeover: true,
      processController: controller,
    })
    expect(controller.signals).toEqual([{ pid: 100, signal: 'SIGTERM' }])
    expect(controller.isAlive(101)).toBe(false)
  })
})
