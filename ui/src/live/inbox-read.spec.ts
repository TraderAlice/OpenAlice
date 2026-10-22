import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ markAllRead: vi.fn(), apply: vi.fn(), refresh: vi.fn(), excursion: null as null | { duty: { destination: { inboxEntryId: string } } } }))
vi.mock('../api', () => ({ api: { inbox: { markAllRead: mocks.markAllRead } } }))
vi.mock('./inbox', () => ({ inboxLive: {}, applyInboxBulkRead: mocks.apply, setInboxBulkWritePending: vi.fn(), refreshInbox: mocks.refresh, setInboxReadAtOptimistically: vi.fn() }))
vi.mock('../office/inbox-duty-excursion', () => ({ readOfficeInboxDutyExcursion: () => mocks.excursion }))
import { useInboxRead } from './inbox-read'
beforeEach(() => { vi.clearAllMocks(); mocks.excursion = null; useInboxRead.setState({ markingAllRead: false }) })
describe('markAllRead', () => {
  it('guards repeated clicks, protects the Office target, and applies only acknowledged IDs', async () => {
    let finish!: (value: { ids: string[]; readAt: number; unreadCount: number }) => void
    mocks.excursion = { duty: { destination: { inboxEntryId: 'protected' } } }
    mocks.markAllRead.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = useInboxRead.getState().markAllRead()
    expect(useInboxRead.getState().markingAllRead).toBe(true)
    await useInboxRead.getState().markAllRead()
    expect(mocks.markAllRead).toHaveBeenCalledExactlyOnceWith(['protected'])
    expect(mocks.apply).not.toHaveBeenCalled()
    finish({ ids: ['old-1', 'old-2'], readAt: 42, unreadCount: 1 })
    expect(await pending).toBe(2)
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(['old-1', 'old-2'], 42, 1)
    expect(useInboxRead.getState().markingAllRead).toBe(false)
  })
  it('does not falsely mark entries on failure, releases the lock and supports retry', async () => {
    mocks.markAllRead.mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce({ ids: [], readAt: 42, unreadCount: 0 })
    await expect(useInboxRead.getState().markAllRead()).rejects.toThrow('write failed')
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(useInboxRead.getState().markingAllRead).toBe(false)
    expect(await useInboxRead.getState().markAllRead()).toBe(0)
  })
})
