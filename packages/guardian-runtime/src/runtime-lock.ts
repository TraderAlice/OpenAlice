import { randomUUID } from 'node:crypto'
import { fstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  currentProcessStartedAt,
  defaultProcessController,
  isSameProcess,
  terminateProcessTree,
  type ProcessController,
} from './process-control.js'

const OWNER_FILE = 'owner.json'
const RECLAIM_DIR = 'reclaiming'
const MUTATION_CLAIM_OWNER_PATTERN = /^owner\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i
const UUID_PATTERN_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const MUTATION_CLAIM_TEMP_PATTERN = new RegExp(`^\\.owner\\.(${UUID_PATTERN_SOURCE})\\.(${UUID_PATTERN_SOURCE})\\.tmp$`, 'i')
const ACQUIRE_RETRY_DELAY_MS = 25
const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100] as const
const RAILWAY_FENCING_INSTANCE_PATTERN = /^[A-Za-z0-9-]{16,128}$/

export const DEFAULT_HEARTBEAT_MS = 30_000
export const DEFAULT_STALE_HEARTBEAT_MS = 90_000
export const DEFAULT_INITIALIZATION_GRACE_MS = 2_000

export interface RuntimeLockOwner {
  readonly schemaVersion: 1
  readonly pid: number
  readonly hostname: string
  readonly machineId?: string
  readonly token: string
  readonly launcher: string
  readonly acquiredAt: string
  readonly heartbeatAt: string
  readonly fencingProtocol?: 'railway-flock-v1'
  readonly fencingInstanceId?: string
  readonly processStartedAt?: string
  readonly guardianPid?: number
  readonly guardianStartedAt?: string
}

export interface RuntimeLockInspection {
  readonly lockDir: string
  readonly state: 'missing' | 'initializing' | 'active' | 'stale' | 'invalid'
  readonly owner: RuntimeLockOwner | null
  readonly heartbeatAgeMs: number | null
  readonly heartbeatStale: boolean
  readonly directoryIdentity: string | null
  readonly reason: string
}

export interface RuntimeProcessLock {
  readonly lockDir: string
  readonly owner: RuntimeLockOwner
  release(): Promise<void>
}

export interface RuntimeLockOptions {
  readonly launcher?: string
  readonly pid?: number
  readonly processStartedAt?: number
  readonly guardianPid?: number
  readonly guardianStartedAt?: number
  readonly takeover?: boolean
  readonly heartbeatMs?: number
  readonly staleHeartbeatMs?: number
  readonly initializationGraceMs?: number
  readonly ownerAuthority?: RuntimeLockOwnerAuthority
  readonly fencingInstanceId?: string
  readonly processController?: ProcessController
  readonly onOwnershipLost?: (error: Error) => void
}

export type RuntimeLockOwnerAuthority =
  | 'process'
  | 'railway-observer'
  | 'railway-fenced-owner'
  | 'railway-fenced-handoff'

export interface RailwayRuntimeFence {
  readonly fd: number
  readonly path: string
}

let adoptedRailwayFence: RailwayRuntimeFence | null = null

export interface OpenAliceRuntimeOptions extends RuntimeLockOptions {
  readonly userDataHome: string
  readonly launcherRoot: string
}

export interface OpenAliceRuntimeLock {
  readonly lockDirs: readonly string[]
  readonly owners: readonly RuntimeLockOwner[]
  release(): Promise<void>
}

export interface GuardianRuntimeOptions extends OpenAliceRuntimeOptions {}

export interface PrepareOpenAliceRuntimeOptions {
  readonly userDataHome: string
  readonly launcherRoot: string
  readonly takeover?: boolean
  readonly ownerAuthority?: RuntimeLockOwnerAuthority
  readonly fencingInstanceId?: string
  readonly processController?: ProcessController
  readonly staleHeartbeatMs?: number
  readonly initializationGraceMs?: number
}

export class RuntimeAlreadyRunningError extends Error {
  constructor(readonly inspection: RuntimeLockInspection) {
    const owner = inspection.owner
    super(owner
      ? `OpenAlice ${owner.launcher} is already running as pid ${owner.pid} (last heartbeat ${owner.heartbeatAt})`
      : `OpenAlice runtime lock is not available: ${inspection.lockDir} (${inspection.reason})`)
    this.name = 'RuntimeAlreadyRunningError'
  }
}

export function runtimeLockDir(userDataHome: string): string {
  return resolve(userDataHome, 'state', 'runtime.lock')
}

export function guardianLockDir(userDataHome: string): string {
  return resolve(userDataHome, 'state', 'guardian.lock')
}

export function legacyWorkspaceLockDir(launcherRoot: string): string {
  return resolve(launcherRoot, 'state', 'runtime.lock')
}

export function openAliceLockDirs(userDataHome: string, launcherRoot: string): string[] {
  return [...new Set([
    legacyWorkspaceLockDir(launcherRoot),
    runtimeLockDir(userDataHome),
  ])]
}

export function takeoverRequested(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): boolean {
  if (argv.includes('--takeover')) return true
  return /^(1|true|yes|on)$/i.test(env['OPENALICE_TAKEOVER']?.trim() ?? '')
}

export function resolveRuntimeLockOwnerAuthority(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeLockOwnerAuthority {
  if (env === process.env && adoptedRailwayFence && railwayFenceMatches(adoptedRailwayFence)) {
    return 'railway-fenced-owner'
  }
  const serviceManager = env['OPENALICE_SERVICE_MANAGER']?.trim()
  const machineId = env['OPENALICE_MACHINE_ID']?.trim()
  const serviceId = env['RAILWAY_SERVICE_ID']?.trim()
  const environmentId = env['RAILWAY_ENVIRONMENT_ID']?.trim()
  if (
    serviceManager !== 'railway'
    || !environmentId
    || !/^[A-Za-z0-9-]{1,128}$/.test(serviceId ?? '')
    || machineId !== `railway-service-${serviceId}`
  ) return 'process'
  return resolveRailwayRuntimeFence(env) && resolveRailwayFencingInstanceId(env)
    ? 'railway-fenced-handoff'
    : 'railway-observer'
}

function resolveRailwayFencingInstanceId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env['OPENALICE_RAILWAY_INSTANCE_ID']?.trim()
  return value && RAILWAY_FENCING_INSTANCE_PATTERN.test(value) ? value : undefined
}

export function resolveRailwayRuntimeFence(
  env: NodeJS.ProcessEnv = process.env,
): RailwayRuntimeFence | null {
  const rawFd = env['OPENALICE_RAILWAY_FENCE_FD']?.trim()
  const fd = Number(rawFd)
  const path = railwayRuntimeFencePath(env)
  if (!path || !/^[0-9]{1,4}$/.test(rawFd ?? '') || !Number.isInteger(fd) || fd < 3) return null
  try {
    const fence = { fd, path }
    return railwayFenceMatches(fence) ? fence : null
  } catch {
    return null
  }
}

export function railwayRuntimeFencePath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const serviceId = env['RAILWAY_SERVICE_ID']?.trim()
  if (!/^[A-Za-z0-9-]{1,128}$/.test(serviceId ?? '')) return null
  const configuredRoots = [
    env['RAILWAY_VOLUME_MOUNT_PATH']?.trim(),
    env['OPENALICE_RAILWAY_VOLUME_ROOT']?.trim(),
  ].filter((value): value is string => Boolean(value)).map((value) => resolve(value))
  if (configuredRoots.length === 0 || new Set(configuredRoots).size !== 1) return null
  const volumeRoot = configuredRoots[0]
  const home = env['OPENALICE_HOME']?.trim()
  const installDir = env['OPENALICE_INSTALL_DIR']?.trim()
  if (!volumeRoot || volumeRoot === '/' || !home || !installDir) return null
  if (!pathIsWithin(volumeRoot, home) || !pathIsWithin(volumeRoot, installDir)) return null
  return isLinuxMountPoint(volumeRoot) ? volumeRoot : null
}

function pathIsWithin(root: string, candidate: string): boolean {
  try {
    const canonicalRoot = realpathSync(root)
    const canonicalCandidate = realpathSync(candidate)
    return canonicalCandidate !== canonicalRoot
      && canonicalCandidate.startsWith(`${canonicalRoot}/`)
  } catch {
    return false
  }
}

function isLinuxMountPoint(path: string): boolean {
  if (process.platform !== 'linux') return false
  try {
    const canonical = realpathSync(path)
    return readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .some((line) => decodeMountInfoPath(line.split(' ')[4] ?? '') === canonical)
  } catch {
    return false
  }
}

function decodeMountInfoPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) => (
    String.fromCharCode(Number.parseInt(octal, 8))
  ))
}

/**
 * Adopt the inherited Railway lifecycle capability inside a trusted writer.
 *
 * The returned authority may be passed explicitly to the child's initial lock
 * acquisitions. The writer keeps its duplicate for its complete lifetime so a
 * Guardian crash cannot release the Volume fence while Alice, UTA, or Connector
 * is still alive. Node child-process and node-pty launch boundaries do not map
 * this extra descriptor; the environment marker and descriptor number are also
 * removed before any untrusted descendant can start.
 */
export function adoptRailwayRuntimeFence(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeLockOwnerAuthority {
  const ownerAuthority = resolveRuntimeLockOwnerAuthority(env)
  const fence = resolveRailwayRuntimeFence(env)

  delete env['OPENALICE_RAILWAY_FENCE_FD']
  delete env['OPENALICE_RAILWAY_ENTRYPOINT_OWNER']
  if (fence && env === process.env && ownerAuthority === 'railway-fenced-handoff') {
    adoptedRailwayFence = fence
  }
  return ownerAuthority
}

function railwayFenceMatches(fence: RailwayRuntimeFence): boolean {
  try {
    const openFile = fstatSync(fence.fd)
    const fenceFile = statSync(fence.path)
    return openFile.isDirectory()
      && fenceFile.isDirectory()
      && openFile.dev === fenceFile.dev
      && openFile.ino === fenceFile.ino
      && inheritedFdHoldsExclusiveFlock(fence.fd)
  } catch {
    return false
  }
}

export async function inspectRuntimeLock(
  lockDir: string,
  opts: Pick<RuntimeLockOptions, 'processController' | 'staleHeartbeatMs' | 'initializationGraceMs' | 'ownerAuthority' | 'fencingInstanceId'> = {},
): Promise<RuntimeLockInspection> {
  const controller = opts.processController ?? defaultProcessController
  const staleMs = opts.staleHeartbeatMs ?? DEFAULT_STALE_HEARTBEAT_MS
  const initGraceMs = opts.initializationGraceMs ?? DEFAULT_INITIALIZATION_GRACE_MS
  let lockStat
  try {
    lockStat = await stat(lockDir)
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return inspection(lockDir, 'missing', null, null, false, null, 'lock directory is absent')
    throw err
  }
  const directoryIdentity = `${lockStat.dev}:${lockStat.ino}:${lockStat.birthtimeMs}`
  const ageMs = Math.max(0, Date.now() - lockStat.mtimeMs)
  let owner: RuntimeLockOwner
  let hasExplicitHeartbeat: boolean
  try {
    const parsedOwner = await readOwnerRecord(lockDir)
    owner = parsedOwner.owner
    hasExplicitHeartbeat = parsedOwner.hasExplicitHeartbeat
  } catch {
    if (ageMs < initGraceMs) {
      return inspection(lockDir, 'initializing', null, null, false, directoryIdentity, 'owner metadata is still being published')
    }
    return inspection(lockDir, 'invalid', null, null, true, directoryIdentity, 'owner metadata is missing or invalid')
  }

  const heartbeatAt = Date.parse(owner.heartbeatAt)
  const heartbeatAgeMs = Number.isFinite(heartbeatAt) ? Math.max(0, Date.now() - heartbeatAt) : null
  const heartbeatStale = heartbeatAgeMs === null || heartbeatAgeMs > staleMs
  const currentMachineId = await controller.machineId()
  const ownerAuthority = opts.ownerAuthority ?? resolveRuntimeLockOwnerAuthority()
  const railwayScope = railwayOwnerScope(
    owner,
    currentMachineId,
    ownerAuthority,
    opts.fencingInstanceId ?? resolveRailwayFencingInstanceId(),
  )
  if (railwayScope === 'cross-container-fenced') {
    return inspection(
      lockDir,
      'stale',
      owner,
      heartbeatAgeMs,
      heartbeatStale,
      directoryIdentity,
      'Railway lifecycle fence is held and the prior container owner is eligible for handoff',
    )
  }
  if (railwayScope === 'cross-container-observer') {
    return inspection(
      lockDir,
      'active',
      owner,
      heartbeatAgeMs,
      heartbeatStale,
      directoryIdentity,
      !hasExplicitHeartbeat || heartbeatAgeMs === null
        ? 'Railway owner heartbeat is missing or invalid; observer refuses automatic recovery'
        : 'Railway owner belongs to another container namespace; observer refuses automatic recovery',
    )
  }
  if (railwayScope === 'foreign') {
    return inspection(
      lockDir,
      'active',
      owner,
      heartbeatAgeMs,
      heartbeatStale,
      directoryIdentity,
      'owner does not belong to this Railway service; refusing automatic recovery',
    )
  }
  if (owner.machineId && owner.machineId !== currentMachineId && railwayScope !== 'same-container') {
    return inspection(
      lockDir,
      'active',
      owner,
      heartbeatAgeMs,
      heartbeatStale,
      directoryIdentity,
      heartbeatStale
        ? 'owner belongs to another machine and its heartbeat is stale; refusing automatic takeover'
        : 'owner belongs to another machine',
    )
  }
  if (!controller.isAlive(owner.pid)) {
    return inspection(lockDir, 'stale', owner, heartbeatAgeMs, heartbeatStale, directoryIdentity, 'owner process is not running')
  }
  if (!(await isSameProcess(owner.pid, owner.processStartedAt, controller))) {
    return inspection(lockDir, 'stale', owner, heartbeatAgeMs, heartbeatStale, directoryIdentity, 'owner pid has been reused')
  }
  return inspection(
    lockDir,
    'active',
    owner,
    heartbeatAgeMs,
    heartbeatStale,
    directoryIdentity,
    heartbeatStale ? 'owner process is alive but its heartbeat is stale' : 'owner process is alive',
  )
}

function railwayOwnerScope(
  owner: RuntimeLockOwner,
  currentMachineId: string,
  ownerAuthority: RuntimeLockOwnerAuthority | undefined,
  currentFencingInstanceId: string | undefined,
): 'same-container' | 'cross-container-observer' | 'cross-container-fenced' | 'foreign' | null {
  if (
    ownerAuthority !== 'railway-observer'
    && ownerAuthority !== 'railway-fenced-owner'
    && ownerAuthority !== 'railway-fenced-handoff'
  ) return null
  if (!/^env:railway-service-[A-Za-z0-9-]+$/.test(currentMachineId)) return 'foreign'
  if (owner.machineId !== currentMachineId) return 'foreign'
  if (owner.fencingProtocol !== 'railway-flock-v1') return 'foreign'
  if (
    owner.fencingInstanceId !== undefined
    && !RAILWAY_FENCING_INSTANCE_PATTERN.test(owner.fencingInstanceId)
  ) return 'foreign'
  if (ownerAuthority === 'railway-observer') return 'cross-container-observer'
  if (!currentFencingInstanceId) return 'foreign'
  if (owner.fencingInstanceId === currentFencingInstanceId) return 'same-container'
  return ownerAuthority === 'railway-fenced-handoff'
    ? 'cross-container-fenced'
    : 'cross-container-observer'
}

export async function acquireRuntimeLock(
  lockDir: string,
  opts: RuntimeLockOptions = {},
): Promise<RuntimeProcessLock> {
  const controller = opts.processController ?? defaultProcessController
  const ownerAuthority = opts.ownerAuthority ?? resolveRuntimeLockOwnerAuthority()
  const fencingInstanceId = opts.fencingInstanceId ?? resolveRailwayFencingInstanceId()
  if (
    (ownerAuthority === 'railway-fenced-handoff' || ownerAuthority === 'railway-fenced-owner')
    && !fencingInstanceId
  ) {
    throw new Error('missing or invalid Railway fencing instance identity')
  }
  const processStartedAt = opts.processStartedAt ?? currentProcessStartedAt()
  const machineId = await controller.machineId()
  const now = new Date().toISOString()
  const owner: RuntimeLockOwner = {
    schemaVersion: 1,
    pid: opts.pid ?? process.pid,
    hostname: hostname(),
    machineId,
    token: randomUUID(),
    launcher: opts.launcher ?? process.env['OPENALICE_LAUNCHER'] ?? 'standalone',
    acquiredAt: now,
    heartbeatAt: now,
    ...(ownerAuthority === 'railway-fenced-handoff' || ownerAuthority === 'railway-fenced-owner'
      ? { fencingProtocol: 'railway-flock-v1' as const }
      : {}),
    ...(fencingInstanceId ? { fencingInstanceId } : {}),
    processStartedAt: new Date(processStartedAt).toISOString(),
    ...(opts.guardianPid ? { guardianPid: opts.guardianPid } : {}),
    ...(opts.guardianStartedAt ? { guardianStartedAt: new Date(opts.guardianStartedAt).toISOString() } : {}),
  }

  await mkdir(dirname(lockDir), { recursive: true })
  const acquireAttempts = Math.max(
    40,
    Math.ceil(((opts.initializationGraceMs ?? DEFAULT_INITIALIZATION_GRACE_MS) + 2_000) / ACQUIRE_RETRY_DELAY_MS),
  )
  for (let attempt = 0; attempt < acquireAttempts; attempt++) {
    let created = false
    try {
      await mkdir(lockDir)
      created = true
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err
    }

    if (created) {
      const directoryIdentity = await readLockDirectoryIdentity(lockDir)
      const claim = await acquireLockMutationClaim(lockDir, owner, {
        ...opts,
        ownerAuthority,
        fencingInstanceId,
      })
      if (!directoryIdentity || !claim) {
        await controller.sleep(ACQUIRE_RETRY_DELAY_MS)
        continue
      }
      let published = false
      let claimReleased = false
      try {
        const latestIdentity = await readLockDirectoryIdentity(lockDir)
        const latestOwner = await readOwner(lockDir).catch(() => null)
        if (latestIdentity === directoryIdentity && !latestOwner && await claim.isCurrent()) {
          await writeOwnerAtomic(lockDir, owner, controller)
          const verifiedIdentity = await readLockDirectoryIdentity(lockDir)
          const verifiedOwner = await readOwner(lockDir).catch(() => null)
          published = verifiedIdentity === directoryIdentity
            && verifiedOwner?.token === owner.token
            && await claim.isCurrent()
        }
      } finally {
        claimReleased = await claim.release()
      }
      if (!claimReleased) throw new Error(`runtime mutation claim could not be released at ${lockDir}`)
      if (published) return makeLock(lockDir, owner, { ...opts, ownerAuthority, fencingInstanceId })
      await controller.sleep(ACQUIRE_RETRY_DELAY_MS)
      continue
    }

    const current = await inspectRuntimeLock(lockDir, { ...opts, ownerAuthority })
    if (current.state === 'missing' || current.state === 'initializing') {
      await controller.sleep(ACQUIRE_RETRY_DELAY_MS)
      continue
    }
    if (current.state === 'active') {
      if (!opts.takeover || !current.owner) throw new RuntimeAlreadyRunningError(current)
      await recoverRuntimeOwner(current.owner, {
        processController: controller,
        ownerAuthority,
        fencingInstanceId,
      })
      await controller.sleep(ACQUIRE_RETRY_DELAY_MS)
      continue
    }

    if (await claimAndRemove(current, owner, { ...opts, ownerAuthority, fencingInstanceId })) continue
    await controller.sleep(ACQUIRE_RETRY_DELAY_MS)
  }

  throw new RuntimeAlreadyRunningError(await inspectRuntimeLock(lockDir, { ...opts, ownerAuthority }))
}

export async function acquireOpenAliceRuntimeLocks(opts: OpenAliceRuntimeOptions): Promise<OpenAliceRuntimeLock> {
  const locks: RuntimeProcessLock[] = []
  try {
    for (const lockDir of openAliceLockDirs(opts.userDataHome, opts.launcherRoot)) {
      locks.push(await acquireRuntimeLock(lockDir, opts))
    }
  } catch (err) {
    for (const lock of locks.reverse()) await lock.release().catch(() => undefined)
    throw err
  }
  return {
    lockDirs: locks.map((lock) => lock.lockDir),
    owners: locks.map((lock) => lock.owner),
    release: async () => {
      for (const lock of [...locks].reverse()) await lock.release()
    },
  }
}

export async function inspectOpenAliceRuntime(opts: PrepareOpenAliceRuntimeOptions): Promise<RuntimeLockInspection[]> {
  return Promise.all(openAliceLockDirs(opts.userDataHome, opts.launcherRoot).map((lockDir) => inspectRuntimeLock(lockDir, opts)))
}

export async function inspectOpenAliceInstance(opts: PrepareOpenAliceRuntimeOptions): Promise<RuntimeLockInspection[]> {
  return Promise.all([
    inspectRuntimeLock(guardianLockDir(opts.userDataHome), opts),
    ...openAliceLockDirs(opts.userDataHome, opts.launcherRoot).map((lockDir) => inspectRuntimeLock(lockDir, opts)),
  ])
}

/** Acquire the control-plane singleton before a Guardian reads or mutates the
 * selected home, then reconcile any standalone/orphaned Alice writer. */
export async function acquireGuardianRuntime(opts: GuardianRuntimeOptions): Promise<RuntimeProcessLock> {
  const guardianLock = await acquireRuntimeLock(guardianLockDir(opts.userDataHome), {
    ...opts,
    launcher: opts.launcher ?? 'guardian',
  })
  try {
    await prepareOpenAliceRuntime(opts)
    return guardianLock
  } catch (err) {
    await guardianLock.release().catch(() => undefined)
    throw err
  }
}

/**
 * Guardian preflight. It never deletes a live owner's lock: takeover first
 * terminates the recorded process tree and waits for the Alice owner to exit.
 * The next Alice process performs the atomic stale-lock reclamation itself.
 */
export async function prepareOpenAliceRuntime(opts: PrepareOpenAliceRuntimeOptions): Promise<RuntimeLockInspection[]> {
  const inspections = await inspectOpenAliceRuntime(opts)
  const active = dedupeOwners(inspections.filter((row) => row.state === 'active' && row.owner !== null))
  if (active.length > 0 && !opts.takeover) throw new RuntimeAlreadyRunningError(active[0]!)
  for (const row of active) {
    await recoverRuntimeOwner(row.owner!, {
      processController: opts.processController,
      ownerAuthority: opts.ownerAuthority,
      fencingInstanceId: opts.fencingInstanceId,
    })
  }
  return inspections
}

export async function recoverRuntimeOwner(
  owner: RuntimeLockOwner,
  opts: {
    readonly processController?: ProcessController
    readonly ownerAuthority?: RuntimeLockOwnerAuthority
    readonly fencingInstanceId?: string
  } = {},
): Promise<void> {
  const controller = opts.processController ?? defaultProcessController
  const currentMachineId = await controller.machineId()
  const ownerAuthority = opts.ownerAuthority ?? resolveRuntimeLockOwnerAuthority()
  const railwayScope = railwayOwnerScope(
    owner,
    currentMachineId,
    ownerAuthority,
    opts.fencingInstanceId ?? resolveRailwayFencingInstanceId(),
  )
  if (railwayScope === 'cross-container-observer' || railwayScope === 'cross-container-fenced') {
    throw new Error(`OpenAlice owner ${owner.pid} belongs to another Railway container; refusing to signal it`)
  }
  if (railwayScope === 'foreign') {
    throw new Error(`OpenAlice owner ${owner.pid} does not belong to this Railway service; refusing to signal it`)
  }
  if (owner.machineId && owner.machineId !== currentMachineId && railwayScope !== 'same-container') {
    throw new Error(`OpenAlice owner ${owner.pid} belongs to another machine; refusing to signal it`)
  }
  if (!controller.isAlive(owner.pid)) return
  if (!(await isSameProcess(owner.pid, owner.processStartedAt, controller))) return

  let targetPid = owner.pid
  if (
    owner.guardianPid &&
    owner.guardianPid !== process.pid &&
    await isSameProcess(owner.guardianPid, owner.guardianStartedAt, controller)
  ) {
    targetPid = owner.guardianPid
  }
  await terminateProcessTree(targetPid, { controller })
  if (controller.isAlive(owner.pid)) {
    await terminateProcessTree(owner.pid, { controller })
  }
  if (controller.isAlive(owner.pid)) {
    throw new Error(`OpenAlice owner pid ${owner.pid} is still alive; refusing to unlock`)
  }
}

function makeLock(lockDir: string, initialOwner: RuntimeLockOwner, opts: RuntimeLockOptions): RuntimeProcessLock {
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  let owner = initialOwner
  let released = false
  let updating = false
  let timer: ReturnType<typeof setInterval> | undefined

  const loseOwnership = (err: unknown): void => {
    if (released) return
    released = true
    if (timer) clearInterval(timer)
    const error = err instanceof Error ? err : new Error(String(err))
    opts.onOwnershipLost?.(error)
  }

  const heartbeat = async (): Promise<void> => {
    if (released || updating) return
    updating = true
    try {
      const current = await readOwner(lockDir)
      if (current.token !== owner.token) throw new Error(`runtime lock ownership changed at ${lockDir}`)
      owner = { ...owner, heartbeatAt: new Date().toISOString() }
      await writeOwnerAtomic(lockDir, owner, opts.processController ?? defaultProcessController)
    } catch (err) {
      loseOwnership(err)
    } finally {
      updating = false
    }
  }

  if (heartbeatMs > 0) {
    timer = setInterval(() => { void heartbeat() }, heartbeatMs)
    timer.unref()
  }

  return {
    lockDir,
    owner: initialOwner,
    release: async () => {
      if (released) return
      released = true
      if (timer) clearInterval(timer)
      while (updating) await (opts.processController ?? defaultProcessController).sleep(5)
      const current = await readOwner(lockDir).catch(() => null)
      if (current?.token !== owner.token) return
      const directoryIdentity = await readLockDirectoryIdentity(lockDir)
      if (!directoryIdentity) return
      let retiredDir: string | null = null
      for (let attempt = 0; attempt < 40 && !retiredDir; attempt++) {
        retiredDir = await retireLockDirectory(
          lockDir,
          directoryIdentity,
          current,
          owner,
          opts,
          'released',
        )
        if (retiredDir) break
        const latest = await readOwner(lockDir).catch(() => null)
        if (latest?.token !== owner.token) return
        await (opts.processController ?? defaultProcessController).sleep(25)
      }
      if (!retiredDir) return
      await rm(retiredDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 }).catch(() => undefined)
    },
  }
}

async function claimAndRemove(
  current: RuntimeLockInspection,
  claimant: RuntimeLockOwner,
  opts: RuntimeLockOptions,
): Promise<boolean> {
  if (!current.directoryIdentity) return current.state === 'missing'
  const retiredDir = await retireLockDirectory(
    current.lockDir,
    current.directoryIdentity,
    current.owner,
    claimant,
    opts,
    'reaped',
  )
  if (!retiredDir) return false
  await rm(retiredDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 }).catch(() => undefined)
  return true
}

async function readLockDirectoryIdentity(lockDir: string): Promise<string | null> {
  try {
    const lockStat = await stat(lockDir)
    return lockDirectoryIdentity(lockStat)
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return null
    throw err
  }
}

function lockDirectoryIdentity(lockStat: { dev: number; ino: number; birthtimeMs: number }): string {
  return `${lockStat.dev}:${lockStat.ino}:${lockStat.birthtimeMs}`
}

async function retireLockDirectory(
  lockDir: string,
  expectedIdentity: string,
  expectedOwner: RuntimeLockOwner | null,
  claimant: RuntimeLockOwner,
  opts: RuntimeLockOptions,
  reason: 'released' | 'reaped',
): Promise<string | null> {
  const claim = await acquireLockMutationClaim(lockDir, claimant, opts)
  if (!claim) return null
  const retiredDir = `${lockDir}.${reason}-${randomUUID()}`
  let retired = false
  try {
    const latestIdentity = await readLockDirectoryIdentity(lockDir)
    if (latestIdentity !== expectedIdentity) return null
    const latestOwner = await readOwner(lockDir).catch(() => null)
    if (expectedOwner && !sameReclaimEvidence(expectedOwner, latestOwner)) return null
    if (!expectedOwner && latestOwner) return null
    if (!(await claim.isCurrent())) return null
    await renameAtomic(lockDir, retiredDir, opts.processController ?? defaultProcessController)
    retired = true
    return retiredDir
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return null
    throw err
  } finally {
    if (!retired && !(await claim.release())) {
      throw new Error(`runtime mutation claim could not be released at ${lockDir}`)
    }
  }
}

interface LockMutationClaim {
  isCurrent(): Promise<boolean>
  release(): Promise<boolean>
}

async function acquireLockMutationClaim(
  lockDir: string,
  claimant: RuntimeLockOwner,
  opts: RuntimeLockOptions,
): Promise<LockMutationClaim | null> {
  const claimDir = join(lockDir, RECLAIM_DIR)
  const ownerFileName = mutationClaimOwnerFileName(claimant.token)
  try {
    await mkdir(claimDir)
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return null
    if (isErrno(err, 'EEXIST')) {
      await recoverAbandonedMutationClaim(lockDir, opts)
      return null
    }
    throw err
  }
  const claimDirectoryIdentity = await readLockDirectoryIdentity(claimDir)
  if (!claimDirectoryIdentity) return null

  const tempPath = join(claimDir, `.owner.${claimant.token}.${randomUUID()}.tmp`)
  const ownerPath = join(claimDir, ownerFileName)
  try {
    await writeFile(tempPath, JSON.stringify(claimant, null, 2) + '\n', 'utf8')
    await renameAtomic(tempPath, ownerPath, opts.processController ?? defaultProcessController)
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    await rmdir(claimDir).catch(() => undefined)
    if (isErrno(err, 'ENOENT')) return null
    throw err
  }

  const claim: LockMutationClaim = {
    isCurrent: async () => {
      if (await readLockDirectoryIdentity(claimDir) !== claimDirectoryIdentity) return false
      const entries = await readdir(claimDir).catch(() => null)
      if (entries === null || entries.length !== 1 || entries[0] !== ownerFileName) return false
      const latest = await readOwnerFile(ownerPath).catch(() => null)
      return sameReclaimEvidence(claimant, latest)
    },
    release: async () => {
      return retireMutationClaimMarker(lockDir, claimDirectoryIdentity, claimant, opts).catch(() => false)
    },
  }
  if (!(await claim.isCurrent())) {
    await claim.release()
    return null
  }
  return claim
}

async function recoverAbandonedMutationClaim(
  lockDir: string,
  opts: RuntimeLockOptions,
): Promise<boolean> {
  const controller = opts.processController ?? defaultProcessController
  const claimDir = join(lockDir, RECLAIM_DIR)
  let claimStat
  try {
    claimStat = await stat(claimDir)
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return true
    throw err
  }

  const entries = await readdir(claimDir).catch(() => null)
  if (entries === null) return false
  const ownerEntry = entries.length === 1 && MUTATION_CLAIM_OWNER_PATTERN.test(entries[0]!)
    ? entries[0]!
    : null
  if (!ownerEntry) {
    const ageMs = Math.max(0, Date.now() - claimStat.mtimeMs)
    const initializationGraceMs = opts.initializationGraceMs ?? DEFAULT_INITIALIZATION_GRACE_MS
    const incompleteTemp = entries.length === 1 && MUTATION_CLAIM_TEMP_PATTERN.test(entries[0]!)
      ? entries[0]!
      : null
    if ((entries.length > 0 && !incompleteTemp) || ageMs < initializationGraceMs) return false
    try {
      if (incompleteTemp) await rm(join(claimDir, incompleteTemp), { force: true })
      await rmdir(claimDir)
      return true
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return true
      if (isErrno(err, 'ENOTEMPTY') || isErrno(err, 'EEXIST')) return false
      throw err
    }
  }

  let claimant: RuntimeLockOwner
  try {
    claimant = await readOwnerFile(join(claimDir, ownerEntry))
  } catch {
    return false
  }
  const fileToken = MUTATION_CLAIM_OWNER_PATTERN.exec(ownerEntry)?.[1]
  if (!fileToken || fileToken.toLowerCase() !== claimant.token.toLowerCase()) return false

  const currentMachineId = await controller.machineId()
  const ownerAuthority = opts.ownerAuthority ?? resolveRuntimeLockOwnerAuthority()
  const railwayScope = railwayOwnerScope(
    claimant,
    currentMachineId,
    ownerAuthority,
    opts.fencingInstanceId ?? resolveRailwayFencingInstanceId(),
  )
  if (railwayScope === 'cross-container-observer' || railwayScope === 'foreign') return false
  let abandoned = railwayScope === 'cross-container-fenced'
  if (!abandoned) {
    if (claimant.machineId && claimant.machineId !== currentMachineId && railwayScope !== 'same-container') return false
    abandoned = !controller.isAlive(claimant.pid)
      || !(await isSameProcess(claimant.pid, claimant.processStartedAt, controller))
  }
  if (!abandoned) return false

  return retireMutationClaimMarker(lockDir, lockDirectoryIdentity(claimStat), claimant, opts)
}

function mutationClaimOwnerFileName(token: string): string {
  const ownerFileName = `owner.${token}.json`
  if (!MUTATION_CLAIM_OWNER_PATTERN.test(ownerFileName)) {
    throw new Error('runtime mutation claim token is not a UUID')
  }
  return ownerFileName
}

async function retireMutationClaimMarker(
  lockDir: string,
  expectedClaimDirectoryIdentity: string,
  claimant: RuntimeLockOwner,
  opts: RuntimeLockOptions,
): Promise<boolean> {
  const controller = opts.processController ?? defaultProcessController
  const claimDir = join(lockDir, RECLAIM_DIR)
  const ownerPath = join(claimDir, mutationClaimOwnerFileName(claimant.token))
  const retiredOwnerPath = `${lockDir}.mutation-${claimant.token}-${randomUUID()}.retired`
  if (await readLockDirectoryIdentity(claimDir) !== expectedClaimDirectoryIdentity) return false
  const entries = await readdir(claimDir).catch(() => null)
  if (entries === null || entries.length !== 1 || entries[0] !== mutationClaimOwnerFileName(claimant.token)) {
    return false
  }
  try {
    await renameAtomic(ownerPath, retiredOwnerPath, controller)
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return false
    throw err
  }

  const movedOwner = await readOwnerFile(retiredOwnerPath).catch(() => null)
  if (!sameReclaimEvidence(claimant, movedOwner)) {
    return false
  }

  // The marker move fences this exact claim generation. Correctness must not
  // depend on uninterrupted cleanup: another contender may remove the now-empty
  // directory after its grace and create a new generation at the same path.
  await controller.sleep(0)
  try {
    await rmdir(claimDir)
  } catch (err) {
    if (!isErrno(err, 'ENOENT')) {
      if (isErrno(err, 'ENOTEMPTY') || isErrno(err, 'EEXIST')) {
        const latestIdentity = await readLockDirectoryIdentity(claimDir)
        if (latestIdentity !== expectedClaimDirectoryIdentity) {
          await rm(retiredOwnerPath, { force: true }).catch(() => undefined)
          return true
        }
        return false
      }
      throw err
    }
  }
  await rm(retiredOwnerPath, { force: true }).catch(() => undefined)
  return true
}

async function writeOwnerAtomic(
  lockDir: string,
  owner: RuntimeLockOwner,
  controller: ProcessController,
): Promise<void> {
  const ownerPath = join(lockDir, OWNER_FILE)
  const tempPath = join(lockDir, `.${OWNER_FILE}.${owner.token}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, JSON.stringify(owner, null, 2) + '\n', 'utf8')
    await renameAtomic(tempPath, ownerPath, controller)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

async function renameAtomic(
  source: string,
  destination: string,
  controller: ProcessController,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      const retryDelay = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]
      if (
        process.platform !== 'win32'
        || retryDelay === undefined
        || !isTransientWindowsRenameError(error)
      ) throw error
      await controller.sleep(retryDelay)
    }
  }
}

function isTransientWindowsRenameError(error: unknown): boolean {
  return isErrno(error, 'EPERM') || isErrno(error, 'EACCES') || isErrno(error, 'EBUSY')
}

interface ParsedRuntimeLockOwner {
  readonly owner: RuntimeLockOwner
  readonly hasExplicitHeartbeat: boolean
}

async function readOwnerRecord(lockDir: string): Promise<ParsedRuntimeLockOwner> {
  return readOwnerFileRecord(join(lockDir, OWNER_FILE))
}

async function readOwnerFileRecord(ownerPath: string): Promise<ParsedRuntimeLockOwner> {
  const parsed = JSON.parse(await readFile(ownerPath, 'utf8')) as Record<string, unknown>
  if (
    typeof parsed['pid'] !== 'number' ||
    typeof parsed['hostname'] !== 'string' ||
    typeof parsed['token'] !== 'string' ||
    typeof parsed['acquiredAt'] !== 'string'
  ) throw new Error('invalid runtime lock owner')

  const acquiredAt = parsed['acquiredAt']
  const hasExplicitHeartbeat = typeof parsed['heartbeatAt'] === 'string'
  return {
    hasExplicitHeartbeat,
    owner: {
      schemaVersion: 1,
      pid: parsed['pid'],
      hostname: parsed['hostname'],
      ...(typeof parsed['machineId'] === 'string' ? { machineId: parsed['machineId'] } : {}),
      token: parsed['token'],
      launcher: typeof parsed['launcher'] === 'string' ? parsed['launcher'] : 'legacy',
      acquiredAt,
      heartbeatAt: hasExplicitHeartbeat ? parsed['heartbeatAt'] as string : acquiredAt,
      ...(parsed['fencingProtocol'] === 'railway-flock-v1'
        ? { fencingProtocol: 'railway-flock-v1' as const }
        : {}),
      ...(typeof parsed['fencingInstanceId'] === 'string'
        ? { fencingInstanceId: parsed['fencingInstanceId'] }
        : {}),
      ...(typeof parsed['processStartedAt'] === 'string' ? { processStartedAt: parsed['processStartedAt'] } : {}),
      ...(typeof parsed['guardianPid'] === 'number' ? { guardianPid: parsed['guardianPid'] } : {}),
      ...(typeof parsed['guardianStartedAt'] === 'string' ? { guardianStartedAt: parsed['guardianStartedAt'] } : {}),
    },
  }
}

async function readOwner(lockDir: string): Promise<RuntimeLockOwner> {
  return (await readOwnerRecord(lockDir)).owner
}

async function readOwnerFile(ownerPath: string): Promise<RuntimeLockOwner> {
  return (await readOwnerFileRecord(ownerPath)).owner
}

function sameReclaimEvidence(
  inspected: RuntimeLockOwner,
  latest: RuntimeLockOwner | null,
): boolean {
  return latest !== null
    && latest.schemaVersion === inspected.schemaVersion
    && latest.token === inspected.token
    && latest.pid === inspected.pid
    && latest.hostname === inspected.hostname
    && latest.machineId === inspected.machineId
    && latest.launcher === inspected.launcher
    && latest.acquiredAt === inspected.acquiredAt
    && latest.heartbeatAt === inspected.heartbeatAt
    && latest.fencingProtocol === inspected.fencingProtocol
    && latest.fencingInstanceId === inspected.fencingInstanceId
    && latest.processStartedAt === inspected.processStartedAt
    && latest.guardianPid === inspected.guardianPid
    && latest.guardianStartedAt === inspected.guardianStartedAt
}

function inheritedFdHoldsExclusiveFlock(fd: number): boolean {
  if (process.platform !== 'linux') return false
  try {
    const fdInfo = readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8')
    return /^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\b/m.test(fdInfo)
  } catch {
    return false
  }
}

function inspection(
  lockDir: string,
  state: RuntimeLockInspection['state'],
  owner: RuntimeLockOwner | null,
  heartbeatAgeMs: number | null,
  heartbeatStale: boolean,
  directoryIdentity: string | null,
  reason: string,
): RuntimeLockInspection {
  return { lockDir, state, owner, heartbeatAgeMs, heartbeatStale, directoryIdentity, reason }
}

function dedupeOwners(rows: RuntimeLockInspection[]): RuntimeLockInspection[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.owner?.pid ?? 'none'}:${row.owner?.token ?? row.lockDir}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === code
}
