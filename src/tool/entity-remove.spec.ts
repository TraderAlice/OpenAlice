import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEntityStore } from '../core/entity-store.js'
import { entityRemoveFactory } from './entity-remove.js'
import { CLI_EXPORTS } from '../server/cli-commands.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('explicit tracked entity removal', () => {
  it('previews without writing, removes only the named anchor, and permits re-tracking', async () => {
    const root = await mkdtemp(join(tmpdir(), 'entity-remove-'))
    roots.push(root)
    const path = join(root, 'entities.jsonl')
    const report = join(root, 'report.md')
    await writeFile(report, 'Keep this authored [[stock-vst]] report.\n')
    const entityStore = createEntityStore({ filePath: path })
    const entity = await entityStore.upsert({ name: 'stock-vst', description: 'Vistra', type: 'asset' })
    await entityStore.upsert({ name: 'stock-vst-other', description: 'Other anchor', type: 'topic' })
    const changed = vi.fn()
    entityStore.onChanged(changed)
    const tool = entityRemoveFactory.build({ workspaceId: 'fixture', workspaceLabel: 'Fixture', entityStore, inboxStore: {} as never })
    const run = (args: { name: string; apply?: boolean }) => tool.execute!(args, { toolCallId: 'fixture', messages: [] })
    const before = await readFile(path, 'utf8')
    expect(await run({ name: 'STOCK-VST' })).toEqual({ ok: true, applied: false, entity })
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(changed).not.toHaveBeenCalled()
    expect(await run({ name: 'STOCK-VST', apply: true })).toMatchObject({ ok: true, applied: true, removed: true })
    expect(changed).toHaveBeenCalledOnce()
    expect(await entityStore.get('stock-vst')).toBeNull()
    expect(await entityStore.get('stock-vst-other')).not.toBeNull()
    expect(await readFile(report, 'utf8')).toBe('Keep this authored [[stock-vst]] report.\n')
    expect(await run({ name: 'stock-vst', apply: true })).toMatchObject({ ok: true, removed: false })
    expect(changed).toHaveBeenCalledOnce()
    await entityStore.upsert({ name: 'stock-vst', description: 'Track again', type: 'asset' })
    expect(await entityStore.get('stock-vst')).toMatchObject({ description: 'Track again' })
  })

  it('exposes removal through the existing track CLI group', () => {
    expect(CLI_EXPORTS.data.commands.track.remove).toBe('entity_remove')
  })
})
