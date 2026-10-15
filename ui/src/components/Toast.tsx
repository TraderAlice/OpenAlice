import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Toaster } from './ui/sonner'
import { NotificationCard } from './ui/notification-card'
import { NotificationQueue, type NotificationInput } from '../lib/notifications/queue'

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string, scope?: string) => void
}

// ==================== Context ====================

const ToastContext = createContext<ToastContextValue | null>(null)
const NotificationsContext = createContext<NotificationQueue | null>(null)

export function useNotifications(): NotificationQueue {
  const queue = useContext(NotificationsContext)
  if (!queue) throw new Error('useNotifications must be used within ToastProvider')
  return queue
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

interface VisibleNotification {
  input: NotificationInput
  listeners: Set<() => void>
}

function VisibleCard({ store, onClose }: { store: VisibleNotification; onClose(): void }) {
  const input = useSyncExternalStore(
    listener => { store.listeners.add(listener); return () => { store.listeners.delete(listener) } },
    () => store.input,
  )
  return <NotificationCard content={input} onClose={onClose} />
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const queue = useMemo(() => {
    const visible = new Map<string, VisibleNotification>()
    return new NotificationQueue({
      show: (displayId, input, onClose) => {
        const store = visible.get(displayId) ?? { input, listeners: new Set<() => void>() }
        const restartTimer = !visible.has(displayId) || store.input.duration !== input.duration
        store.input = input
        visible.set(displayId, store)
        for (const listener of store.listeners) listener()
        // Updating grouped copy through the subscribed card leaves Sonner's
        // original timer intact. A lifecycle duration change starts a new timer.
        if (restartTimer) toast.custom(() => <VisibleCard store={store} onClose={onClose} />, {
          id: displayId, duration: input.duration, onDismiss: onClose, onAutoClose: onClose,
        })
      },
      hide: (displayId) => { visible.delete(displayId); toast.dismiss(displayId) },
    })
  }, [])
  useEffect(() => () => queue.dispose(), [queue])
  const value = useMemo<ToastContextValue>(() => ({
    success: (message) => { queue.publish({ status: 'success', title: message, duration: 4_000 }) },
    error: (message, scope) => { queue.publish({
      status: 'error', title: message, duration: 10_000,
      group: `local-error:${scope ?? ''}:${message}`, windowMs: 30_000,
    }) },
  }), [queue])

  return (
    <ToastContext.Provider value={value}>
      <NotificationsContext.Provider value={queue}>{children}</NotificationsContext.Provider>
      <Toaster
        position="top-right"
        visibleToasts={3}
        expand
        gap={8}
        offset={{ top: 56, right: 20 }}
        mobileOffset={{ top: 96, right: 16, left: 16 }}
      />
    </ToastContext.Provider>
  )
}
