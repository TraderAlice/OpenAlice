import { useRef, useCallback, useState, type KeyboardEvent, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

interface ChatInputProps {
  disabled: boolean
  onSend: (message: string) => void
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [hasText, setHasText] = useState(false)

  const handleSend = useCallback(() => {
    const text = textareaRef.current?.value.trim()
    if (!text || disabled) return
    onSend(text)
    if (textareaRef.current) {
      textareaRef.current.value = ''
      textareaRef.current.style.height = 'auto'
    }
    setHasText(false)
  }, [disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    setHasText(el.value.trim().length > 0)
  }, [])

  return (
    <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shrink-0 border-t border-border/50 bg-bg shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
      <div className="flex items-end gap-3 bg-bg-secondary border border-border rounded-2xl px-4 py-2.5 max-w-[800px] mx-auto transition-all duration-200 focus-within:border-accent/60 focus-within:shadow-[0_0_0_1px_rgba(88,166,255,0.15)] shadow-sm">
        <textarea
          ref={textareaRef}
          disabled={disabled}
          className="flex-1 bg-transparent text-text border-none outline-none font-sans text-[15px] leading-relaxed resize-none max-h-[200px] placeholder:text-text-muted/70 disabled:opacity-50 disabled:cursor-not-allowed py-0.5"
          placeholder={disabled ? 'Waiting for response...' : 'Message Alice...'}
          rows={1}
          onKeyDown={handleKeyDown}
          onChange={handleInput}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !hasText}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 shrink-0 mb-0.5 ${
            disabled
              ? 'bg-accent/60 text-white cursor-not-allowed'
              : hasText
                ? 'bg-accent text-white shadow-sm hover:bg-accent/85 scale-100'
                : 'bg-bg-tertiary text-text-muted/40 cursor-not-allowed scale-95'
          }`}
          aria-label={t('chat.sendMessage')}
        >
          {disabled ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
      <div className="text-center mt-1.5 max-w-[800px] mx-auto">
        <span className="text-[11px] text-text-muted/40">
          Enter to send, Shift + Enter for new line
        </span>
      </div>
    </div>
  )
}
