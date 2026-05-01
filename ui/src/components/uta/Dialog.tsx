import { useCallback, useEffect } from 'react'

/** Generic modal dialog used by the UTA wizard + edit flows. */
export function Dialog({ onClose, width, children }: {
  onClose: () => void
  width?: string
  children: React.ReactNode
}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative ${width || 'w-[560px]'} max-w-[95vw] max-h-[85vh] bg-bg rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden`}>
        {children}
      </div>
    </div>
  )
}
