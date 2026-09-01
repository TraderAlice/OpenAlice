/** SSH transport for the AliceProject transfer stream. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

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
  let receiverReportedError = false
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
    if (Buffer.byteLength(chunk) > 0) receiverReportedError = true
  })
  const exited = new Promise<number>((resolvePromise, reject) => {
    ssh.once('error', reject)
    ssh.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(0)
      else reject(transferSshError(
        `Remote transfer receiver exited ${signal ? `with ${signal}` : `with code ${code ?? 'unknown'}`}.${receiverReportedError ? ' Remote diagnostics were withheld from the credential-bearing transfer channel.' : ''}`,
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
  const expectedManifestSha256 = createHash('sha256')
    .update(JSON.stringify(input.plan.portable.entries))
    .digest('hex')
  const expectedCredentials = input.plan.policy.credentials === 'include' ? 'included' : 'omitted'
  if (
    receipt.transferId !== input.plan.transferId
    || receipt.sourceProjectId !== input.plan.source.projectId
    || receipt.destinationProjectId !== input.plan.destination.projectId
    || receipt.destinationHome !== input.plan.destination.home
    || receipt.files !== input.plan.portable.files
    || receipt.bytes !== input.plan.portable.bytes
    || receipt.manifestSha256 !== expectedManifestSha256
    || receipt.credentials !== expectedCredentials
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
  ) {
    throw transferSshError('Remote transfer receiver returned an invalid receipt.')
  }
  const root = parsed as Record<string, unknown>
  const transferId = root['transferId']
  const sourceProjectId = root['sourceProjectId']
  const destinationProjectId = root['destinationProjectId']
  const destinationHome = root['destinationHome']
  const files = root['files']
  const bytes = root['bytes']
  const manifestSha256 = root['manifestSha256']
  const credentials = root['credentials']
  const publishedAt = root['publishedAt']
  if (
    root['schemaVersion'] !== 1
    || typeof transferId !== 'string'
    || transferId.length < 1
    || typeof sourceProjectId !== 'string'
    || sourceProjectId.length < 1
    || typeof destinationProjectId !== 'string'
    || destinationProjectId.length < 1
    || typeof destinationHome !== 'string'
    || destinationHome.length < 1
    || !Number.isSafeInteger(files)
    || Number(files) < 0
    || !Number.isSafeInteger(bytes)
    || Number(bytes) < 0
    || typeof manifestSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(manifestSha256)
    || (credentials !== 'included' && credentials !== 'omitted')
    || root['sessionsImported'] !== 0
    || typeof publishedAt !== 'string'
    || !Number.isFinite(Date.parse(publishedAt))
  ) {
    throw transferSshError('Remote transfer receiver returned an invalid receipt.')
  }
  return {
    schemaVersion: 1,
    transferId,
    sourceProjectId,
    destinationProjectId,
    destinationHome,
    files: Number(files),
    bytes: Number(bytes),
    manifestSha256,
    credentials,
    sessionsImported: 0,
    publishedAt,
  }
}

function transferSshError(message: string, cause?: unknown): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: 'ETRANSSSH',
    exitCode: 1,
  })
}
