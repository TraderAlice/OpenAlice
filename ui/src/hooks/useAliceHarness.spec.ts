// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { fetchJson } from '../api/client'
import { useAliceHarness } from './useAliceHarness'
vi.mock('../api/client', () => ({ fetchJson: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('loads the selected Workspace and reloads after saving configuration', async () => {
  const data = { appliedVersion: null, availableVersion: '1.0.0', config: { schemaVersion: 1 as const, cli: {} }, commands: { alice: ['rss'] } }
  vi.mocked(fetchJson).mockResolvedValue(data)
  const { result, rerender } = renderHook(({ id }) => useAliceHarness(id), { initialProps: { id: 'one' } })
  expect(result.current.data).toBeNull()
  await waitFor(() => expect(result.current.data).toEqual(data))
  await act(async () => { await result.current.save(data.config) })
  expect(fetchJson).toHaveBeenCalledWith('/api/workspaces/one/alice-harness/config', expect.objectContaining({ method: 'PUT', body: JSON.stringify(data.config) }))
  rerender({ id: 'two' })
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/api/workspaces/two/alice-harness', expect.anything()))
})
it('surfaces read failures instead of inventing a version', async () => {
  vi.mocked(fetchJson).mockRejectedValue(new Error('invalid config'))
  const { result } = renderHook(() => useAliceHarness('one'))
  await waitFor(() => expect(result.current.error).toBe('invalid config'))
  expect(result.current.data).toBeNull()
})
