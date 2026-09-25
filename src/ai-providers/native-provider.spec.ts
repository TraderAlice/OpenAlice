import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeAIProvider } from './native-provider.js'
import { ProviderModelCatalogStore } from './model-catalog.js'
import type { CliAdapter } from '../workspaces/cli-adapter.js'

it('reuses catalog refresh/replacement without storing native account directories on disk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-models-'))
  let now = 100
  const discoverModels = vi.fn().mockResolvedValue([{ id: 'default', label: 'Native', semantics: { reasoning: { efforts: ['low'] } } }])
  const adapter = { id: 'claude', binary: 'fixture-missing', discoverModels } as unknown as CliAdapter
  const provider = new NativeAIProvider(adapter, directory)
  const store = new ProviderModelCatalogStore({ directory, now: () => now })
  try {
    const result = await store.read(provider, true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]?.semantics?.reasoning?.efforts).toEqual(['low'])
    expect(discoverModels).toHaveBeenCalledWith(directory)
    expect(await readdir(directory)).toEqual([])
    await store.read(provider)
    expect(discoverModels).toHaveBeenCalledTimes(1)
    now += 60_001
    discoverModels.mockResolvedValue([])
    await store.read(provider, true)
    expect((await store.read(provider)).models).toEqual([])
    discoverModels.mockRejectedValue(new Error('secret'))
    expect(await store.read(provider, true)).toMatchObject({ models: [], error: 'Could not refresh models; keeping the previous catalog.' })
    expect(new NativeAIProvider(adapter, join(directory, 'other')).catalogSlot).not.toBe(provider.catalogSlot)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
it('supports adapters without discovery and never borrows vendor API aliases', async () => {
  const provider = new NativeAIProvider({ id: 'fixture', binary: 'fixture' } as CliAdapter, '/tmp')
  expect(provider.discoverModels).toBeUndefined()
  expect(provider.resolveModel('opus').semantics).toBeUndefined()
  expect(await new ProviderModelCatalogStore().read(provider)).toMatchObject({ discoverySupported: false, models: [] })
})
