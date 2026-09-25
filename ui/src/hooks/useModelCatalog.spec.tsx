// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useModelCatalog, catalogModelOptions } from './useModelCatalog'
import { configApi, type ProviderModelCatalog } from '../api/config'
import { listNativeModels } from '../components/workspace/api'

vi.mock('../api/config', () => ({ configApi: { getCredentialModels: vi.fn(), discoverModels: vi.fn() } }))
vi.mock('../components/workspace/api', () => ({ listNativeModels: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('drops late responses when switching accounts', async () => {
  let finish!: (catalog: ProviderModelCatalog) => void
  vi.mocked(configApi.getCredentialModels).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce({ models: [{ id: 'b/model', label: 'B' }], source: 'snapshot', fetchedAt: 1, refreshing: false, error: null })
  const { result, rerender } = renderHook(({ slug }) => useModelCatalog({ slug, agent: 'omp' }), { initialProps: { slug: 'a' } })
  await waitFor(() => expect(configApi.getCredentialModels).toHaveBeenCalledTimes(1))
  rerender({ slug: 'b' })
  expect(result.current.models).toBeNull()
  await waitFor(() => expect(result.current.models?.[0]?.id).toBe('b/model'))
  await act(async () => finish({ models: [{ id: 'a/model', label: 'A' }], source: 'snapshot', fetchedAt: 1, refreshing: false, error: null }))
  expect(result.current.models?.[0]?.id).toBe('b/model')
})

it('loads the native catalog and retries a failed request, preserving an honest empty result', async () => {
  vi.mocked(listNativeModels).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ models: [], discoverySupported: true, source: 'snapshot', fetchedAt: 1, refreshing: false, error: null })
  const { result } = renderHook(() => useModelCatalog({ native: 'omp', workspaceId: 'workspace' }))
  await waitFor(() => expect(result.current.error).toBe('unavailable'))
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.models).toEqual([]))
  expect(result.current.error).toBeNull()
  expect(listNativeModels).toHaveBeenCalledWith('omp', 'workspace', expect.any(AbortSignal), expect.any(Boolean))
})

it('debounces draft credentials and keeps known model semantics without adding unavailable IDs', async () => {
  vi.mocked(configApi.discoverModels).mockResolvedValue({ models: [{ id: 'private', label: 'Private' }] })
  const { result, rerender } = renderHook(({ apiKey }) => useModelCatalog({ wireShape: 'openai-chat', apiKey }), { initialProps: { apiKey: 'partial' } })
  rerender({ apiKey: 'complete' })
  await waitFor(() => expect(result.current.models?.[0]?.id).toBe('private'))
  expect(configApi.discoverModels).toHaveBeenCalledTimes(1)
  expect(configApi.discoverModels).toHaveBeenCalledWith({ wireShape: 'openai-chat', apiKey: 'complete' }, expect.any(AbortSignal))
  const fallback = [{ id: 'private', label: 'Old', semantics: { contextWindow: 1000 } }, { id: 'unavailable', label: 'Unavailable' }]
  expect(catalogModelOptions(result.current.models, fallback)).toEqual([{ id: 'private', label: 'Private', semantics: { contextWindow: 1000 } }])
  expect(catalogModelOptions([], fallback)).toEqual([])
})


it('shows the cached list while a refresh runs, then replaces it with the new list', async () => {
  vi.mocked(configApi.getCredentialModels)
    .mockResolvedValueOnce({ models: [{ id: 'old', label: 'Old' }], source: 'snapshot', fetchedAt: 1, refreshing: true, error: null })
    .mockResolvedValueOnce({ models: [], source: 'snapshot', fetchedAt: 2, refreshing: false, error: null })
  const { result } = renderHook(() => useModelCatalog({ slug: 'account' }))
  await waitFor(() => expect(result.current.models?.[0]?.id).toBe('old'))
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.models).toEqual([]), { timeout: 2500 })
  expect(result.current.loading).toBe(false)
  expect(result.current.source).toBe('snapshot')
  expect(configApi.getCredentialModels).toHaveBeenLastCalledWith('account', undefined, expect.any(AbortSignal), undefined, false)
})

it('manual refresh retains the previous list if the request fails', async () => {
  vi.mocked(configApi.getCredentialModels)
    .mockResolvedValueOnce({ models: [{ id: 'old', label: 'Old' }], source: 'snapshot', fetchedAt: 1, refreshing: false, error: null })
    .mockRejectedValueOnce(new Error('network failure'))
  const { result } = renderHook(() => useModelCatalog({ slug: 'account' }))
  await waitFor(() => expect(result.current.models?.[0]?.id).toBe('old'))
  act(() => result.current.refresh())
  expect(result.current.models?.[0]?.id).toBe('old')
  await waitFor(() => expect(result.current.error).toBe('network failure'))
  expect(result.current.models?.[0]?.id).toBe('old')
  expect(configApi.getCredentialModels).toHaveBeenLastCalledWith('account', undefined, expect.any(AbortSignal), undefined, true)
})


it('exposes unsupported draft discovery as settled bundled suggestions', async () => {
  vi.mocked(configApi.discoverModels).mockResolvedValue({ discoverySupported: false, models: [{ id: 'glm', label: 'GLM' }] })
  const { result } = renderHook(() => useModelCatalog({ vendor: 'glm', wireShape: 'openai-chat', apiKey: 'fixture' }))
  await waitFor(() => expect(result.current.discoverySupported).toBe(false))
  expect(result.current).toMatchObject({ loading: false, error: null, source: 'bundled', models: [{ id: 'glm', label: 'GLM' }] })
})
