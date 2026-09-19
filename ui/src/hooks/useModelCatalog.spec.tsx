// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useModelCatalog, catalogModelOptions } from './useModelCatalog'
import { configApi } from '../api/config'
import { listNativeModels } from '../components/workspace/api'

vi.mock('../api/config', () => ({ configApi: { getCredentialModels: vi.fn(), discoverModels: vi.fn() } }))
vi.mock('../components/workspace/api', () => ({ listNativeModels: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('drops late responses when switching accounts', async () => {
  let finish!: (models: { id: string; label: string }[]) => void
  vi.mocked(configApi.getCredentialModels).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce([{ id: 'b/model', label: 'B' }])
  const { result, rerender } = renderHook(({ slug }) => useModelCatalog({ slug, agent: 'omp' }), { initialProps: { slug: 'a' } })
  await waitFor(() => expect(configApi.getCredentialModels).toHaveBeenCalledTimes(1))
  rerender({ slug: 'b' })
  expect(result.current.models).toBeNull()
  await waitFor(() => expect(result.current.models?.[0]?.id).toBe('b/model'))
  await act(async () => finish([{ id: 'a/model', label: 'A' }]))
  expect(result.current.models?.[0]?.id).toBe('b/model')
})

it('loads the native catalog and retries a failed request, preserving an honest empty result', async () => {
  vi.mocked(listNativeModels).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([])
  const { result } = renderHook(() => useModelCatalog({ native: 'omp', workspaceId: 'workspace' }))
  await waitFor(() => expect(result.current.error).toBe('unavailable'))
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.models).toEqual([]))
  expect(result.current.error).toBeNull()
  expect(listNativeModels).toHaveBeenCalledWith('omp', 'workspace', expect.any(AbortSignal))
})

it('debounces draft credentials and keeps known model semantics without adding unavailable IDs', async () => {
  vi.mocked(configApi.discoverModels).mockResolvedValue([{ id: 'private', label: 'Private' }])
  const { result, rerender } = renderHook(({ apiKey }) => useModelCatalog({ wireShape: 'openai-chat', apiKey }), { initialProps: { apiKey: 'partial' } })
  rerender({ apiKey: 'complete' })
  await waitFor(() => expect(result.current.models?.[0]?.id).toBe('private'))
  expect(configApi.discoverModels).toHaveBeenCalledTimes(1)
  expect(configApi.discoverModels).toHaveBeenCalledWith({ wireShape: 'openai-chat', apiKey: 'complete' }, expect.any(AbortSignal))
  const fallback = [{ id: 'private', label: 'Old', semantics: { contextWindow: 1000 } }, { id: 'unavailable', label: 'Unavailable' }]
  expect(catalogModelOptions(result.current.models, fallback)).toEqual([{ id: 'private', label: 'Private', semantics: { contextWindow: 1000 } }])
  expect(catalogModelOptions([], fallback)).toEqual([])
})
