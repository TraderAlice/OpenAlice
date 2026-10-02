import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { acquireRuntimeLock } from '@traderalice/guardian-runtime'

function location(options, dependencies) {
  const state = dependencies.env?.OPENALICE_REMOTE_STATE_FILE
    ?? join(dependencies.homeDir ?? homedir(), '.openalice', 'state', 'remote-targets.json')
  const host = [options.destination, options.sshPort ?? 22, options.identityFile ?? null]
  const scope = [...host, options.remoteHome || '~/.openalice', options.machineOnly === true]
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return { scope, path: join(`${state}.updates`, `${hash(scope)}.json`), lock: join(`${state}.updates`, `${hash(host)}.lock`) }
}

export async function readRemoteUpdate(options, dependencies) {
  const { path, scope } = location(options, dependencies)
  let value
  try { value = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error(`Cannot read remote update receipt: ${error.message}`) }
  if (value?.schemaVersion !== 1 || JSON.stringify(value.scope) !== JSON.stringify(scope)
    || value.operation?.schemaVersion !== 1 || !value.operation.target || !value.install?.installSource
    || !['running', 'failed', 'succeeded'].includes(value.operation.phase))
    throw new Error('Invalid remote update receipt; inspect it before starting another update.')
  return value.operation.phase === 'succeeded' ? null : value
}

export async function writeRemoteUpdate(options, receipt, dependencies) {
  const { path, scope } = location(options, dependencies)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify({ ...receipt, scope }) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}

/** Serialize mutations to the shared installation across projects/controllers
 * on this client. Reuse the process-identity lock's crash recovery, never steal
 * a live writer based on timeout. Remote owner checks remain authoritative. */
export async function withRemoteUpdateLock(options, dependencies, action) {
  const lock = await acquireRuntimeLock(location(options, dependencies).lock, { launcher: 'remote-update' })
  let released = false
  const release = async () => { if (!released) { released = true; await lock.release() } }
  try { return await action(release) } finally { await release() }
}
