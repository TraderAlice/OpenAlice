import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FileUpdateJournal } from './node.js'
import { createUpdatePlan, projectUpdateUnit } from './index.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('serializes independent host instances and rejects edited receipt instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'update-journal-')); roots.push(root)
  const first = new FileUpdateJournal(root, 'client'), second = new FileUpdateJournal(root, 'client')
  const plan = createUpdatePlan('client', [{ unit: projectUpdateUnit('client', 'native', 'local', { version: '1.0.0' }, { version: '1.1.0' }), fingerprint: 'exact', stages: ['activate'] }])
  await first.approve(plan, plan.fingerprint)
  await first.locked(async () => { await expect(second.locked(async () => {})).rejects.toThrow() })
  const value = JSON.parse(await readFile(first.path, 'utf8')); value.plan.steps[0].stage = 'apply'
  await writeFile(first.path, JSON.stringify(value))
  await expect(second.read()).rejects.toThrow('Invalid')
})
