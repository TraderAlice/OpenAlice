import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Toaster } from './ui/sonner'

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ToastContextValue>(() => ({
    success: (message) => { toast.success(message) },
    error: (message) => { toast.error(message) },
  }), [])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        position="top-right"
        visibleToasts={3}
        closeButton
      />
    </ToastContext.Provider>
  )
}
