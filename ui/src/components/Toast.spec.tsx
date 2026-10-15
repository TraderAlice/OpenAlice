// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ToastProvider, useNotifications } from './Toast'
import type { NotificationQueue } from '../lib/notifications/queue'

vi.mock('sonner', () => ({ toast: { custom: vi.fn(), dismiss: vi.fn() } }))
vi.mock('./ui/sonner', () => ({ Toaster: () => null }))
let queue: NotificationQueue
function Harness() { queue = useNotifications(); return null }
beforeEach(() => vi.clearAllMocks())

describe('Sonner lifetime adapter', () => {
  it('does not restart grouped-content timers but restarts a lifecycle duration change', () => {
    render(<ToastProvider><Harness /></ToastProvider>)
    act(() => { queue.publish({ id: 'task:1', title: 'Working', status: 'running', duration: Infinity }) })
    act(() => { queue.publish({ id: 'task:1', title: 'Delivered', status: 'success', duration: 6_000, group: 'inbox:s' }) })
    expect(toast.custom).toHaveBeenCalledTimes(2)
    act(() => { queue.publish({ id: 'task:1', title: 'Another report', status: 'success', duration: 6_000, group: 'inbox:s' }) })
    expect(toast.custom).toHaveBeenCalledTimes(2)
    const first = vi.mocked(toast.custom).mock.calls[0][1]!
    const second = vi.mocked(toast.custom).mock.calls[1][1]!
    expect(second.id).toBe(first.id)
    expect(second.duration).toBe(6_000)
  })
})
