/** Node host adapter. The browser-safe root export never imports this module. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { acquireRuntimeLock } from '@traderalice/guardian-runtime'
import { approveUpdate, createUpdatePlan, updateFingerprint, UpdateCoordinator, type UpdateJournal, type UpdateOperation, type UpdateOwner, type UpdatePlan } from './coordinator.js'

export { getProductVersion } from './product-version.js'

export class FileUpdateJournal implements UpdateJournal {
  readonly path: string
  readonly lockPath: string
  constructor(root: string, readonly scope: string) {
    const key = createHash('sha256').update(scope).digest('hex')
    this.path = join(root, `${key}.json`)
    this.lockPath = join(root, `${key}.lock`)
  }
  async read(): Promise<UpdateOperation | null> {
    let value: UpdateOperation
    try { value = JSON.parse(await readFile(this.path, 'utf8')) as UpdateOperation }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (value.schemaVersion !== 1 || value.plan?.scope !== this.scope || !value.id || !value.completed || !Array.isArray(value.events)
      || !['approved', 'running', 'waiting', 'blocked', 'failed', 'recovery', 'succeeded'].includes(value.phase)
      || updateFingerprint(createUpdatePlan(this.scope, value.plan.proposals)) !== updateFingerprint(value.plan)
      || Object.keys(value.completed).some(id => !value.plan.steps.some(s => s.id === id) || !value.completed[id]?.receipt)) {
      throw new Error('Invalid update receipt; inspect the local journal before recovery')
    }
    return value
  }
  async write(operation: UpdateOperation): Promise<void> {
    if (operation.plan.scope !== this.scope) throw new Error('Update journal scope changed')
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(operation) + '\n', { mode: 0o600 })
      await rename(temporary, this.path)
    } finally { await rm(temporary, { force: true }) }
  }
  async locked<T>(action: () => Promise<T>): Promise<T> {
    const lease = await acquireRuntimeLock(this.lockPath, { launcher: 'update-lifecycle' })
    try { return await action() } finally { await lease.release() }
  }
  async approve(plan: UpdatePlan, fingerprint: string, id = randomUUID()): Promise<UpdateOperation> {
    return this.locked(async () => {
      const prior = await this.read()
      if (prior && prior.phase !== 'succeeded') {
        if (prior.id === id && prior.plan.fingerprint === plan.fingerprint) return prior
        throw new Error('An unfinished update owns this scope; resume or explicitly abandon it first')
      }
      const operation = approveUpdate(plan, fingerprint, id, new Date().toISOString())
      await this.write(operation)
      return operation
    })
  }
  async abandon(): Promise<void> {
    await this.locked(async () => {
      const prior = await this.read()
      if (prior) await rename(this.path, `${this.path}.abandoned-${randomUUID()}`)
    })
  }
  run(owner: UpdateOwner): Promise<UpdateOperation> {
    return this.locked(() => new UpdateCoordinator(this, owner).run())
  }
}
