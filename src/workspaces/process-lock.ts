import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname as osHostname } from 'node:os'
import { dirname, join } from 'node:path'

export interface WorkspaceRootLockOwner {
  readonly pid: number
  readonly hostname: string
  readonly token: string
  readonly acquiredAt: string
}

export interface WorkspaceProcessLock {
  readonly lockDir: string
  readonly owner: WorkspaceRootLockOwner
  release(): Promise<void>
}

export interface WorkspaceProcessLockOptions {
  readonly owner?: Partial<Pick<WorkspaceRootLockOwner, 'pid' | 'hostname'>>
  readonly isProcessAlive?: (pid: number, hostname: string) => boolean
}

export class WorkspaceRootLockedError extends Error {
  constructor(
    readonly lockDir: string,
    readonly owner: WorkspaceRootLockOwner | null,
  ) {
    super(owner
      ? `OpenAlice launcher root is already locked by pid ${owner.pid} on ${owner.hostname}`
      : `OpenAlice launcher root is already locked: ${lockDir}`)
    this.name = 'WorkspaceRootLockedError'
  }
}

const LOCK_DIR_REL = join('state', 'runtime.lock')
const OWNER_FILE = 'owner.json'

/**
 * Cross-process owner lock for one launcher root. The workspace/session state
 * files under this root are not safe to mutate from two Alice backend
 * processes at once: boot fixup, session registry flushes, scrollback, and task
 * registries all assume a single writer. `mkdir` is the atomic operation here,
 * and the owner token keeps a stale handle from deleting a newer lock.
 */
export async function acquireWorkspaceProcessLock(
  launcherRoot: string,
  opts: WorkspaceProcessLockOptions = {},
): Promise<WorkspaceProcessLock> {
  const lockDir = join(launcherRoot, LOCK_DIR_REL)
  const owner: WorkspaceRootLockOwner = {
    pid: opts.owner?.pid ?? process.pid,
    hostname: opts.owner?.hostname ?? osHostname(),
    token: randomUUID(),
    acquiredAt: new Date().toISOString(),
  }
  const isProcessAlive = opts.isProcessAlive ?? defaultIsProcessAlive

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(lockDir)
      await writeOwner(lockDir, owner)
      return makeLock(lockDir, owner)
    } catch (err) {
      if (!isErrno(err, 'ENOENT') && !isErrno(err, 'EEXIST')) throw err
      if (isErrno(err, 'ENOENT')) {
        await mkdir(dirname(lockDir), { recursive: true })
        continue
      }

      const existing = await readOwner(lockDir).catch(() => null)
      if (existing && isProcessAlive(existing.pid, existing.hostname)) {
        throw new WorkspaceRootLockedError(lockDir, existing)
      }
      await rm(lockDir, { recursive: true, force: true })
    }
  }

  const existing = await readOwner(lockDir).catch(() => null)
  throw new WorkspaceRootLockedError(lockDir, existing)
}

function makeLock(lockDir: string, owner: WorkspaceRootLockOwner): WorkspaceProcessLock {
  return {
    lockDir,
    owner,
    release: async () => {
      const current = await readOwner(lockDir).catch(() => null)
      if (current?.token !== owner.token) return
      await rm(lockDir, { recursive: true, force: true })
    },
  }
}

async function writeOwner(lockDir: string, owner: WorkspaceRootLockOwner): Promise<void> {
  await writeFile(join(lockDir, OWNER_FILE), JSON.stringify(owner, null, 2) + '\n', 'utf8')
}

async function readOwner(lockDir: string): Promise<WorkspaceRootLockOwner> {
  const raw = await readFile(join(lockDir, OWNER_FILE), 'utf8')
  const parsed = JSON.parse(raw) as Partial<WorkspaceRootLockOwner>
  if (
    typeof parsed.pid !== 'number' ||
    typeof parsed.hostname !== 'string' ||
    typeof parsed.token !== 'string' ||
    typeof parsed.acquiredAt !== 'string'
  ) {
    throw new Error('invalid workspace root lock owner')
  }
  return {
    pid: parsed.pid,
    hostname: parsed.hostname,
    token: parsed.token,
    acquiredAt: parsed.acquiredAt,
  }
}

function defaultIsProcessAlive(pid: number, hostname: string): boolean {
  if (hostname !== osHostname()) return true
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === code
}
