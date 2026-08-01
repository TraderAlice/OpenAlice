import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const UPDATE_ATTEMPT_SCHEMA_VERSION = 1
export const UPDATE_ATTEMPT_FAILURE_AFTER_MS = 90_000

export interface UpdateAttempt {
  schemaVersion: typeof UPDATE_ATTEMPT_SCHEMA_VERSION
  fromVersion: string
  toVersion: string
  startedAt: string
}

export type PreviousUpdateAttempt =
  | { kind: 'none' }
  | { kind: 'pending'; attempt: UpdateAttempt }
  | { kind: 'succeeded'; attempt: UpdateAttempt }
  | { kind: 'failed'; attempt: UpdateAttempt; archivedPath: string }

function parseUpdateAttempt(raw: string): UpdateAttempt | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (
      value['schemaVersion'] !== UPDATE_ATTEMPT_SCHEMA_VERSION ||
      typeof value['fromVersion'] !== 'string' ||
      typeof value['toVersion'] !== 'string' ||
      typeof value['startedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(value['startedAt']))
    ) {
      return null
    }
    return {
      schemaVersion: UPDATE_ATTEMPT_SCHEMA_VERSION,
      fromVersion: value['fromVersion'],
      toVersion: value['toVersion'],
      startedAt: value['startedAt'],
    }
  } catch {
    return null
  }
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export async function recordUpdateAttempt(
  path: string,
  input: { fromVersion: string; toVersion: string; now?: Date },
): Promise<UpdateAttempt> {
  const attempt: UpdateAttempt = {
    schemaVersion: UPDATE_ATTEMPT_SCHEMA_VERSION,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    startedAt: (input.now ?? new Date()).toISOString(),
  }
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(attempt, null, 2)}\n`, 'utf8')
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    // Windows rename cannot atomically replace an existing marker.
    await removeIfPresent(path)
    await rename(temporaryPath, path)
  }
  return attempt
}

export async function inspectPreviousUpdateAttempt(
  path: string,
  currentVersion: string,
  options: { now?: Date; failureAfterMs?: number } = {},
): Promise<PreviousUpdateAttempt> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }
    throw error
  }

  const attempt = parseUpdateAttempt(raw)
  if (!attempt) {
    const archivedPath = `${path}.invalid`
    await removeIfPresent(archivedPath)
    await rename(path, archivedPath)
    return { kind: 'none' }
  }

  // Reaching the requested version, or any version different from the one
  // that initiated the handoff, proves that the old binary was replaced.
  if (currentVersion !== attempt.fromVersion) {
    await removeIfPresent(path)
    return { kind: 'succeeded', attempt }
  }

  const ageMs = (options.now ?? new Date()).getTime() - Date.parse(attempt.startedAt)
  if (ageMs < (options.failureAfterMs ?? UPDATE_ATTEMPT_FAILURE_AFTER_MS)) {
    return { kind: 'pending', attempt }
  }

  const archivedPath = `${path}.failed`
  await removeIfPresent(archivedPath)
  await rename(path, archivedPath)
  return { kind: 'failed', attempt, archivedPath }
}
