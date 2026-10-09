/** Serialize the entire read/modify/write transaction across CLI/Desktop processes.
 * Do not steal a timed-out lock: an active writer may be slow. */
import { mkdir, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function withSupervisorConfigLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const path = join(root, '.config-write.lock')
  const deadline = Date.now() + 10_000
  let lock
  while (!lock) {
    try { lock = await open(path, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (Date.now() >= deadline) throw new Error(`Supervisor config is busy. If its writer exited unexpectedly, remove ${path} before retrying.`)
      await delay(20)
    }
  }
  try { return await action() }
  finally { await lock.close(); await rm(path, { force: true }) }
}
