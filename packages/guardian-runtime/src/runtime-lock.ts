import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  readonly processController?: ProcessController
  readonly onOwnershipLost?: (error: Error) => void
}

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

export async function inspectRuntimeLock(
  lockDir: string,
  opts: Pick<RuntimeLockOptions, 'processController' | 'staleHeartbeatMs' | 'initializationGraceMs'> = {},
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
  try {
    owner = await readOwner(lockDir)
  } catch {
    if (ageMs < initGraceMs) {
      return inspection(lockDir, 'initializing', null, null, false, directoryIdentity, 'owner metadata is still being published')
    }
    return inspection(lockDir, 'invalid', null, null, true, directoryIdentity, 'owner metadata is missing or invalid')
  }

  const heartbeatAt = Date.parse(owner.heartbeatAt)
  const heartbeatAgeMs = Number.isFinite(heartbeatAt) ? Math.max(0, Date.now() - heartbeatAt) : null
  const heartbeatStale = heartbeatAgeMs === null || heartbeatAgeMs > staleMs
  if (owner.machineId && owner.machineId !== await controller.machineId()) {
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

export async function acquireRuntimeLock(
  lockDir: string,
  opts: RuntimeLockOptions = {},
): Promise<RuntimeProcessLock> {
  const controller = opts.processController ?? defaultProcessController
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
    processStartedAt: new Date(processStartedAt).toISOString(),
    ...(opts.guardianPid ? { guardianPid: opts.guardianPid } : {}),
    ...(opts.guardianStartedAt ? { guardianStartedAt: new Date(opts.guardianStartedAt).toISOString() } : {}),
  }

  await mkdir(dirname(lockDir), { recursive: true })
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await mkdir(lockDir)
      await writeOwnerAtomic(lockDir, owner)
      return makeLock(lockDir, owner, opts)
    } catch (err) {
      if (!isErrno(err, 'EEXIST')) throw err
    }

    const current = await inspectRuntimeLock(lockDir, opts)
    if (current.state === 'missing' || current.state === 'initializing') {
      await controller.sleep(25)
      continue
    }
    if (current.state === 'active') {
      if (!opts.takeover || !current.owner) throw new RuntimeAlreadyRunningError(current)
      await recoverRuntimeOwner(current.owner, { processController: controller })
      await controller.sleep(25)
      continue
    }

    if (await claimAndRemove(current)) continue
    await controller.sleep(25)
  }

  throw new RuntimeAlreadyRunningError(await inspectRuntimeLock(lockDir, opts))
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
    await recoverRuntimeOwner(row.owner!, { processController: opts.processController })
  }
  return inspections
}

export async function recoverRuntimeOwner(
  owner: RuntimeLockOwner,
  opts: { readonly processController?: ProcessController } = {},
): Promise<void> {
  const controller = opts.processController ?? defaultProcessController
  if (owner.machineId && owner.machineId !== await controller.machineId()) {
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
      await writeOwnerAtomic(lockDir, owner)
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
      await rm(lockDir, { recursive: true, force: true })
    },
  }
}

async function claimAndRemove(current: RuntimeLockInspection): Promise<boolean> {
  if (!current.directoryIdentity) return current.state === 'missing'
  const claimDir = join(current.lockDir, RECLAIM_DIR)
  const quarantineDir = `${current.lockDir}.reaped-${randomUUID()}`
  let quarantined = false
  try {
    await mkdir(claimDir)
  } catch (err) {
    if (isErrno(err, 'ENOENT') || isErrno(err, 'EEXIST')) return false
    throw err
  }

  try {
    const currentStat = await stat(current.lockDir)
    const identity = `${currentStat.dev}:${currentStat.ino}:${currentStat.birthtimeMs}`
    if (identity !== current.directoryIdentity) return false
    const latest = await readOwner(current.lockDir).catch(() => null)
    if (current.owner && latest?.token !== current.owner.token) return false
    if (!current.owner && latest) return false
    await rename(current.lockDir, quarantineDir)
    quarantined = true
    await rm(quarantineDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 }).catch(() => undefined)
    return true
  } finally {
    if (!quarantined) await rm(claimDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function writeOwnerAtomic(lockDir: string, owner: RuntimeLockOwner): Promise<void> {
  const ownerPath = join(lockDir, OWNER_FILE)
  const tempPath = join(lockDir, `.${OWNER_FILE}.${owner.token}.${randomUUID()}.tmp`)
  try {
    await writeFile(tempPath, JSON.stringify(owner, null, 2) + '\n', 'utf8')
    await rename(tempPath, ownerPath)
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

async function readOwner(lockDir: string): Promise<RuntimeLockOwner> {
  const parsed = JSON.parse(await readFile(join(lockDir, OWNER_FILE), 'utf8')) as Record<string, unknown>
  if (
    typeof parsed['pid'] !== 'number' ||
    typeof parsed['hostname'] !== 'string' ||
    typeof parsed['token'] !== 'string' ||
    typeof parsed['acquiredAt'] !== 'string'
  ) throw new Error('invalid runtime lock owner')

  const acquiredAt = parsed['acquiredAt']
  return {
    schemaVersion: 1,
    pid: parsed['pid'],
    hostname: parsed['hostname'],
    ...(typeof parsed['machineId'] === 'string' ? { machineId: parsed['machineId'] } : {}),
    token: parsed['token'],
    launcher: typeof parsed['launcher'] === 'string' ? parsed['launcher'] : 'legacy',
    acquiredAt,
    heartbeatAt: typeof parsed['heartbeatAt'] === 'string' ? parsed['heartbeatAt'] : acquiredAt,
    ...(typeof parsed['processStartedAt'] === 'string' ? { processStartedAt: parsed['processStartedAt'] } : {}),
    ...(typeof parsed['guardianPid'] === 'number' ? { guardianPid: parsed['guardianPid'] } : {}),
    ...(typeof parsed['guardianStartedAt'] === 'string' ? { guardianStartedAt: parsed['guardianStartedAt'] } : {}),
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
