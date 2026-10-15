import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrateDispatchCommunication } from './0044_dispatch_communication/index.js'
let root: string
let path: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'communication-migration-')); await mkdir(join(root, 'state')); path = join(root, 'state/headless-tasks.json') })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
it('preserves history and backup, assigns no delivery, and is idempotent', async () => {
  const task = { taskId: 'old', wsId: 'w', resumeId: 'r', agent: 'codex', trigger: { kind: 'issue', metadata: { connectorId: 'telegram' } } }
  const source = JSON.stringify({ tasks: [task], version: 1 }); await writeFile(path, source)
  await migrateDispatchCommunication(root)
  const result = await readFile(path, 'utf8')
  expect(JSON.parse(result).tasks[0]).toMatchObject({ ...task, communication: { origin: { kind: 'unknown' }, reply: { kind: 'none' } } })
  expect(JSON.parse(result).tasks[0].communication.delivery).toBeUndefined()
  expect(await readFile(`${path}.pre-0044.bak`, 'utf8')).toBe(source)
  await migrateDispatchCommunication(root); expect(await readFile(path, 'utf8')).toBe(result)
})
it('validates all historical rows before writing', async () => {
  const source = JSON.stringify({ tasks: [{ wsId: 'w', resumeId: 'r', agent: 'codex' }, {}] }); await writeFile(path, source)
  await expect(migrateDispatchCommunication(root)).rejects.toThrow('identity')
  expect(await readFile(path, 'utf8')).toBe(source)
})
it('keeps an existing explicit contract unchanged', async () => {
  const source = JSON.stringify({ tasks: [{ communication: { version: 1, delivery: { connectorId: 'telegram' } } }] }); await writeFile(path, source)
  await migrateDispatchCommunication(root); expect(await readFile(path, 'utf8')).toBe(source)
})
