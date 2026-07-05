import { createContext, useContext, useCallback, useState, useEffect, useRef, type ReactNode } from 'react'

// ==================== Types ====================

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error'
  removing?: boolean
}

interface ToastContextValue {
  success: (message: string) => void
  error: (message: string) => void
}

// ==================== Context ====================

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ==================== Provider ====================

const MAX_TOASTS = 3
const DISMISS_MS = 3000
const FADE_MS = 200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const remove = useCallback((id: number) => {
    // Start fade-out
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)))
    // Actually remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, FADE_MS)
  }, [])

  const add = useCallback((message: string, type: 'success' | 'error') => {
    const id = nextId.current++
    setToasts((prev) => {
      const next = [...prev, { id, message, type }]
      // Trim excess toasts (remove oldest)
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next
    })
    // Auto-dismiss
    setTimeout(() => remove(id), DISMISS_MS)
  }, [remove])

  const success = useCallback((message: string) => add(message, 'success'), [add])
  const error = useCallback((message: string) => add(message, 'error'), [add])

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  )
}

// ==================== Container ====================

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastNotification key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  )
}

// ==================== Single Toast ====================

function ToastNotification({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setMounted(true))
  }, [])

  const isSuccess = toast.type === 'success'

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm
        transition-all duration-200
        ${isSuccess ? 'bg-green/10 border-green/30 text-green' : 'bg-red/10 border-red/30 text-red'}
        ${mounted && !toast.removing ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}
      `}
      role="alert"
    >
      {/* Icon */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        {isSuccess ? (
          <><path d="M20 6L9 17l-5-5" /></>
        ) : (
          <><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></>
        )}
      </svg>

      <span className="flex-1 min-w-0 truncate">{toast.message}</span>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
