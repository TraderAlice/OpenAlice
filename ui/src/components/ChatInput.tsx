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
    <div className="flex gap-2.5 px-5 py-4 border-t border-border bg-bg-secondary shrink-0">
      <textarea
        ref={textareaRef}
        className="flex-1 bg-bg text-text border border-border rounded-[10px] px-3.5 py-2.5 font-sans text-[15px] leading-relaxed resize-none outline-none max-h-[200px] transition-colors focus:border-accent placeholder:text-text-muted"
        placeholder="Send a message..."
        rows={1}
        onKeyDown={handleKeyDown}
        onChange={handleInput}
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        className="self-end bg-user-bubble text-white rounded-[10px] px-5 py-2.5 text-[15px] font-medium cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        Send
      </button>
    </div>
  )
}
