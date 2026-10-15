// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { configApi } from '../api/config'
import { useProviderModels } from './useProviderModels'
vi.mock('../api/config', () => ({ configApi: { getCredentialModels: vi.fn(), discoverModels: vi.fn() } }))
vi.mock('../components/workspace/api', () => ({ listNativeModels: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('resolves models and efforts from one account snapshot; changing model does not refetch', async () => {
  vi.mocked(configApi.getCredentialModels).mockResolvedValue({ models: [
    { id: 'a', label: 'A', semantics: { reasoning: { supported: true, efforts: ['low', 'high'] } } },
    { id: 'b', label: 'B', semantics: { reasoning: { mode: 'none', supported: false } } },
  ], discoverySupported: true, source: 'snapshot', fetchedAt: 1, refreshing: false, error: null })
  const { result, rerender } = renderHook(({ model }) => useProviderModels({ request: { slug: 'account' }, model, fallback: [], agent: 'pi' }), { initialProps: { model: 'a' } })
  await waitFor(() => expect(result.current.effortOptions).toEqual(['low', 'high']))
  expect(result.current.selectedModel?.id).toBe('a')
  rerender({ model: 'b' })
  expect(result.current.selectedModel?.id).toBe('b')
  expect(result.current.reasoning?.supported).toBe(false)
  expect(result.current.effortOptions).toEqual([])
  expect(configApi.getCredentialModels).toHaveBeenCalledTimes(1)
  vi.mocked(configApi.getCredentialModels).mockRejectedValue(new Error('offline'))
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.error).toBe('offline'))
  expect(result.current.selectedModel?.id).toBe('b')
})
it('does not carry one credential model capabilities into another credential', async () => {
  vi.mocked(configApi.getCredentialModels).mockResolvedValue({ models: [{ id: 'same', label: 'A', semantics: { reasoning: { efforts: ['max'] } } }], discoverySupported: true, source: 'snapshot', fetchedAt: 1, refreshing: false, error: null })
  const { result, rerender } = renderHook(({ slug }) => useProviderModels({ request: { slug }, model: 'same', fallback: [], agent: 'pi' }), { initialProps: { slug: 'a' } })
  await waitFor(() => expect(result.current.effortOptions).toEqual(['max']))
  vi.mocked(configApi.getCredentialModels).mockImplementation(() => new Promise(() => {}))
  rerender({ slug: 'b' })
  expect(result.current.selectedModel).toBeNull()
  expect(result.current.reasoning).toBeUndefined()
  expect(result.current.loading).toBe(true)
})

it('keeps native model and effort together and drops late native results after switching to Vault', async () => {
  const { listNativeModels } = await import('../components/workspace/api')
  let finish!: (value: Awaited<ReturnType<typeof listNativeModels>>) => void
  vi.mocked(listNativeModels).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  vi.mocked(configApi.getCredentialModels).mockResolvedValue({ models: [{ id: 'same', label: 'Vault', semantics: { reasoning: { efforts: ['low'] } } }], source: 'snapshot', fetchedAt: 1, refreshing: false, error: null })
  const { result, rerender } = renderHook(({ native }) => useProviderModels({ request: native ? { native: 'codex', workspaceId: 'w' } : { slug: 'account' }, model: 'same', fallback: [], agent: 'codex' }), { initialProps: { native: true } })
  await waitFor(() => expect(listNativeModels).toHaveBeenCalled())
  rerender({ native: false })
  await waitFor(() => expect(result.current.effortOptions).toEqual(['low']))
  await act(async () => finish({ models: [{ id: 'same', label: 'Native', semantics: { reasoning: { efforts: ['ultra'] } } }], source: 'snapshot', fetchedAt: 1, refreshing: false, error: null }))
  expect(result.current.selectedModel?.label).toBe('Vault')
  expect(result.current.effortOptions).toEqual(['low'])
})
