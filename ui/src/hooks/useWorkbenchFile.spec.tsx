// @vitest-environment jsdom
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkbenchFile } from './useWorkbenchFile'
import { readWorkspaceFile } from '../components/workspace/api'
vi.mock('../components/workspace/api', () => ({ readWorkspaceFile: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('ignores stale file responses after selection changes and surfaces failures', async () => {
  let finish!: (value: never) => void
  vi.mocked(readWorkspaceFile).mockImplementationOnce(() => new Promise((r) => { finish = r }))
    .mockRejectedValueOnce(new Error('offline'))
  const { result, rerender } = renderHook(({ path }) => useWorkbenchFile('ws', path), { initialProps: { path: 'old' } })
  expect(result.current).toBeNull()
  rerender({ path: 'new' })
  await waitFor(() => expect(result.current).toEqual({ kind: 'error', message: 'offline' }))
  await act(async () => { finish({ kind: 'ok', content: 'old' } as never) })
  expect(result.current).toEqual({ kind: 'error', message: 'offline' })
})
