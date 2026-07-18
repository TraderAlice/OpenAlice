import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export interface ControlledStage {
  readonly directory: string
  readonly path: (name: string) => string
  readonly cleanup: () => Promise<void>
}

export async function createControlledStage(prefix = 'openalice-theme-generator-'): Promise<ControlledStage> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  let cleaned = false
  return {
    directory,
    path(name) {
      const safe = basename(name)
      if (safe !== name || safe === '.' || safe === '..') throw new Error('Stage file name must be a basename')
      return join(directory, safe)
    },
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export interface ManagedProcessRequest {
  readonly executablePath: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly env?: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
  readonly killGraceMs?: number
}

export type ManagedProcessResult =
  | { readonly kind: 'succeeded'; readonly exitCode: 0; readonly signal: null }
  | { readonly kind: 'nonzero'; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly kind: 'cancelled'; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly kind: 'spawn-failed'; readonly code: string | null; readonly message: string }

/**
 * Run an already-resolved executable without a shell. Output is streamed to
 * files, so a legitimate generator JSON document is never truncated by a
 * maxBuffer. Resolution and executable identity belong to the detector.
 */
export async function runManagedProcess(request: ManagedProcessRequest): Promise<ManagedProcessResult> {
  if (!isAbsolute(request.executablePath)) {
    return { kind: 'spawn-failed', code: 'EINVAL', message: 'Executable path must be absolute' }
  }
  const stdout = createWriteStream(request.stdoutPath, { flags: 'wx' })
  const stderr = createWriteStream(request.stderrPath, { flags: 'wx' })
  let child
  try {
    child = spawn(request.executablePath, [...request.argv], {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    stdout.destroy()
    stderr.destroy()
    const value = error as NodeJS.ErrnoException
    return { kind: 'spawn-failed', code: value.code ?? null, message: value.message }
  }

  let cancelled = request.signal?.aborted === true
  let killTimer: NodeJS.Timeout | undefined
  const cancel = () => {
    cancelled = true
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, request.killGraceMs ?? 2_000)
    killTimer.unref()
  }
  request.signal?.addEventListener('abort', cancel, { once: true })
  if (cancelled) cancel()

  const output = Promise.all([
    pipeline(child.stdout, stdout),
    pipeline(child.stderr, stderr),
  ])
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })

  try {
    const [{ code, signal }] = await Promise.all([closed, output])
    if (cancelled) return { kind: 'cancelled', exitCode: code, signal }
    if (code === 0) return { kind: 'succeeded', exitCode: 0, signal: null }
    return { kind: 'nonzero', exitCode: code, signal }
  } catch (error) {
    const value = error as NodeJS.ErrnoException
    return { kind: 'spawn-failed', code: value.code ?? null, message: value.message }
  } finally {
    request.signal?.removeEventListener('abort', cancel)
    if (killTimer !== undefined) clearTimeout(killTimer)
  }
}
