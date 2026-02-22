import { useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react'

interface ChatInputProps {
  disabled: boolean
  onSend: (message: string) => void
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const text = textareaRef.current?.value.trim()
    if (!text || disabled) return
    onSend(text)
    if (textareaRef.current) {
      textareaRef.current.value = ''
      textareaRef.current.style.height = 'auto'
    }
  }, [disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const handleInput = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  return (
    <div className="px-4 pt-2 pb-4 pb-[max(1rem,env(safe-area-inset-bottom))] shrink-0">
      <div className="flex items-end gap-2 bg-bg-secondary border border-border rounded-2xl px-4 py-2 max-w-[800px] mx-auto transition-colors focus-within:border-accent/50 shadow-sm">
        <textarea
          ref={textareaRef}
          disabled={disabled}
          className="flex-1 bg-transparent text-text border-none outline-none font-sans text-[15px] leading-relaxed resize-none max-h-[200px] placeholder:text-text-muted disabled:opacity-50 disabled:cursor-not-allowed py-1"
          placeholder={disabled ? 'Waiting for response...' : 'Message Alice...'}
          rows={1}
          onKeyDown={handleKeyDown}
          onChange={handleInput}
        />
        <button
          onClick={handleSend}
          disabled={disabled}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-user-bubble text-white transition-all hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 mb-0.5"
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
