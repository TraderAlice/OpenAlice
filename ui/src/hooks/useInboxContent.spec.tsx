// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inboxApi, type InboxEntry, type InboxFile } from '../api/inbox'
import { useInboxContent } from './useInboxContent'

const entry = (id: string, workspaceId = 'source'): InboxEntry => ({ id, workspaceId, ts: 1, body: 'Before [[report/A.md]] after `[[literal.md]]` [[report/A.md]]' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('useInboxContent', () => {
  it('derives an ordered unique file index without fetching for summary consumers', () => {
    const request = vi.spyOn(inboxApi, 'files')
    const { result } = renderHook(() => useInboxContent(entry('one'), { resolveFiles: false }))
    expect(result.current.files).toEqual([{ path: 'report/A.md' }])
    expect(result.current.body).toBe(entry('one').body)
    expect(request).not.toHaveBeenCalled()
  })
  it('discards old Workspace responses and leaves unavailable paths literal', async () => {
    let finish!: (value: { files: InboxFile[] }) => void
    vi.spyOn(inboxApi, 'files').mockImplementation(id => id === 'one' ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ files: [{ path: 'report/A.md', available: false, href: '/two' }] }))
    const { result, rerender } = renderHook(({ value }) => useInboxContent(value), { initialProps: { value: entry('one') } })
    expect(result.current.loading).toBe(true)
    rerender({ value: entry('two', 'another') })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => finish({ files: [{ path: 'report/A.md', available: true, href: '/one' }] }))
    expect(result.current.fileHrefs).toEqual({})
    expect(result.current.body).toBe(entry('two').body)
  })
  it('exposes an error and retries metadata without prefetching content', async () => {
    vi.spyOn(inboxApi, 'files').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ files: [{ path: 'report/A.md', available: true, href: '/one' }] })
    const { result } = renderHook(() => useInboxContent(entry('one')))
    await waitFor(() => expect(result.current.error).toContain('offline'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.fileHrefs['report/A.md']).toBe('/one'))
    expect(result.current.preview).toBeNull()
  })
})
