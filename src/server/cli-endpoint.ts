import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveAliceProjectIdentity } from '@traderalice/guardian-runtime'
import { appResourcesHome, userDataHome } from '../core/paths.js'

/** Ephemeral discovery only. Callers must also verify the live Project header. */
export async function publishCliEndpoint(url: string, socket?: string, home = userDataHome): Promise<() => Promise<void>> {
  const project = resolveAliceProjectIdentity({ home, appRoot: appResourcesHome })
  const path = join(home, 'state', 'cli-endpoint.json')
  const nonce = randomUUID()
  const payload = { schemaVersion: 1, projectId: project.id, home: project.home, appRoot: appResourcesHome, pid: process.pid, nonce, url, ...(socket ? { socket } : {}) }
  await mkdir(join(home, 'state'), { recursive: true })
  const temp = `${path}.${nonce}.tmp`
  await writeFile(temp, JSON.stringify(payload), { mode: 0o600 })
  await rename(temp, path)
  return async () => {
    // Discovery is disposable; a damaged cache must not interrupt shutdown.
    try {
      const current = JSON.parse(await readFile(path, 'utf8')) as { nonce?: string }
      if (current.nonce === nonce) await rm(path, { force: true })
    } catch { /* Missing or damaged discovery state can be replaced on startup. */ }
  }
}
