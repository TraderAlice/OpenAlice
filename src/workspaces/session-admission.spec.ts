import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionAdmission } from './session-admission.js'
const dirs: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const user = { kind: 'user' as const, entry: 'control' }
const system = { kind: 'system' as const, entry: 'scheduler' }
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'admission-')); dirs.push(dir)
  const file = join(dir, 'admission.json')
  return { file, admission: await SessionAdmission.open(file) }
}
it('persists cooldown, expires lazily, and never dispatches work', async () => {
  const { file, admission } = await setup()
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  await admission.cooldown('s', 'run', user)
  const restored = await SessionAdmission.open(file)
  expect(restored.blocks('s')[0].expiresAt).toBe(1_600_000)
  expect(() => restored.assertAllowed('s')).toThrow()
  vi.spyOn(Date, 'now').mockReturnValue(1_600_000)
  expect(restored.blocks('s')).toEqual([])
  expect(() => restored.assertAllowed('s')).not.toThrow()
})
it('keeps independent blockers and requires user authority to release one', async () => {
  const { admission } = await setup()
  for (let i = 0; i < 3; i++) await admission.outcome('s', String(i), true, 'startup-failed')
  await admission.cooldown('s', 'user-stop', user)
  const fault = admission.blocks('s').find(row => row.kind === 'execution-fault')!
  await expect(admission.release('s', fault.id, system)).rejects.toThrow('explicit user')
  await admission.release('s', fault.id, user)
  expect(admission.blocks('s').map(row => row.kind)).toEqual(['user-cooldown'])
  await expect(admission.configure(60, system)).rejects.toThrow()
  await admission.configure(120, user)
  expect(admission.cooldownSeconds).toBe(120)
  expect(admission.blocks('s')[0].expiresAt! - admission.blocks('s')[0].createdAt).toBe(600000)
})
it('resets consecutive failures after success', async () => {
  const { admission } = await setup()
  await admission.outcome('s', '1', true, 'exit')
  await admission.outcome('s', '2', true, 'exit')
  await admission.outcome('s', '3', false, 'exit')
  await admission.outcome('s', '4', true, 'exit')
  expect(admission.blocks('s')).toEqual([])
})
