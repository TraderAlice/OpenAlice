/** SSH transport for the AliceProject transfer stream. */
import { spawn } from 'node:child_process'

import type { RegisteredMachine } from './machine-registry.ts'
import { buildRemoteSshArgs } from './remote.mjs'
import {
  writeProjectTransferStream,
  type ProjectTransferReceipt,
} from './project-transfer-stream.ts'
import type { ProjectTransferPlan } from './project-transfer.ts'

const MAX_RECEIPT_BYTES = 1024 * 1024
const REMOTE_RECEIVE_COMMAND = `set -eu
cli=$(command -v openalice 2>/dev/null || { [ ! -x "$HOME/.openalice/bin/openalice" ] || printf '%s\\n' "$HOME/.openalice/bin/openalice"; })
[ -n "$cli" ] || { printf '%s\\n' 'OpenAlice CLI is not installed' >&2; exit 127; }
exec "$cli" project transfer-receive`

export async function transferProjectOverSsh(input: {
  machine: RegisteredMachine
  plan: ProjectTransferPlan
  stderr?: { write(chunk: string): unknown }
  spawnProcess?: typeof spawn
  signal?: AbortSignal
  onProgress?: (progress: { files: number; bytes: number; totalFiles: number; totalBytes: number }) => void
}): Promise<ProjectTransferReceipt> {
  input.signal?.throwIfAborted()
  const spawnProcess = input.spawnProcess ?? spawn
  const ssh = spawnProcess('ssh', buildRemoteSshArgs({
    destination: input.machine.sshTarget,
    sshPort: input.machine.sshPort ?? null,
    identityFile: input.machine.identityFile ?? null,
  }, REMOTE_RECEIVE_COMMAND), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdout: Buffer[] = []
  let stdoutBytes = 0
  let stderrText = ''
  ssh.stdout.on('data', (chunk: Buffer | string) => {
    const bytes = Buffer.from(chunk)
    stdoutBytes += bytes.byteLength
    if (stdoutBytes > MAX_RECEIPT_BYTES) {
      ssh.kill('SIGTERM')
      return
    }
    stdout.push(bytes)
  })
  ssh.stderr.on('data', (chunk: Buffer | string) => {
    const text = String(chunk)
    stderrText = `${stderrText}${text}`.slice(-16_384)
    input.stderr?.write(text)
  })
  const exited = new Promise<number>((resolvePromise, reject) => {
    ssh.once('error', reject)
    ssh.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(0)
      else reject(transferSshError(
        `Remote transfer receiver exited ${signal ? `with ${signal}` : `with code ${code ?? 'unknown'}`}${stderrText.trim() ? `: ${safeRemoteError(stderrText)}` : '.'}`,
      ))
    })
  })
  const abort = () => {
    ssh.stdin.destroy(input.signal?.reason)
    ssh.kill('SIGTERM')
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  const rejectAbort = (_resolve: (value: never) => void, reject: (reason?: unknown) => void) => {
    const reason = input.signal?.reason ?? new DOMException('The transfer was cancelled.', 'AbortError')
    if (input.signal?.aborted) reject(reason)
    else input.signal?.addEventListener('abort', () => reject(reason), { once: true })
  }
  try {
    await writeProjectTransferStream({ plan: input.plan, output: ssh.stdin, signal: input.signal, onProgress: input.onProgress })
    ssh.stdin.end()
    if (input.signal) {
      await Promise.race([
        exited,
        new Promise<never>(rejectAbort),
      ])
    } else {
      await exited
    }
  } catch (error: unknown) {
    ssh.stdin.destroy()
    ssh.kill('SIGTERM')
    await exited.catch(() => undefined)
    throw error
  } finally {
    input.signal?.removeEventListener('abort', abort)
  }
  if (stdoutBytes > MAX_RECEIPT_BYTES) throw transferSshError('Remote transfer receipt was too large.')
  const receipt = parseReceipt(Buffer.concat(stdout).toString('utf8'))
  if (
    receipt.transferId !== input.plan.transferId
    || receipt.sourceProjectId !== input.plan.source.projectId
    || receipt.destinationProjectId !== input.plan.destination.projectId
    || receipt.destinationHome !== input.plan.destination.home
    || receipt.sessionsImported !== 0
  ) throw transferSshError('Remote transfer receiver returned a receipt for another transaction.')
  return receipt
}

function parseReceipt(value: string): ProjectTransferReceipt {
  let parsed: unknown
  try {
    parsed = JSON.parse(value.trim()) as unknown
  } catch (error: unknown) {
    throw transferSshError('Remote transfer receiver returned an invalid receipt.', error)
  }
  if (
    parsed === null
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || (parsed as Record<string, unknown>)['schemaVersion'] !== 1
    || typeof (parsed as Record<string, unknown>)['transferId'] !== 'string'
    || typeof (parsed as Record<string, unknown>)['sourceProjectId'] !== 'string'
    || typeof (parsed as Record<string, unknown>)['destinationProjectId'] !== 'string'
    || typeof (parsed as Record<string, unknown>)['destinationHome'] !== 'string'
    || (parsed as Record<string, unknown>)['sessionsImported'] !== 0
  ) {
    throw transferSshError('Remote transfer receiver returned an invalid receipt.')
  }
  return parsed as ProjectTransferReceipt
}

function safeRemoteError(value: string): string {
  return value
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(-1_000)
}

function transferSshError(message: string, cause?: unknown): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: 'ETRANSSSH',
    exitCode: 1,
  })
}
