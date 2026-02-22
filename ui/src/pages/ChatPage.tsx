import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type ChatMessage as ChatMessageType } from '../api'
import { ChatMessage, ThinkingIndicator } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'

interface ChatPageProps {
  onSSEStatus?: (connected: boolean) => void
}

export function ChatPage({ onSSEStatus }: ChatPageProps) {
  const [messages, setMessages] = useState<(ChatMessageType & { _id: number })[]>([])
  const [isWaiting, setIsWaiting] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const nextId = useRef(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [])

  useEffect(scrollToBottom, [messages, isWaiting, scrollToBottom])

  // Detect user scroll
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const isUp = scrollHeight - scrollTop - clientHeight > 80
      userScrolledUp.current = isUp
      setShowScrollBtn(isUp)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Load chat history
  useEffect(() => {
    api.chat.history(100).then(({ messages }) => {
      setMessages(messages.map(m => ({ ...m, _id: nextId.current++ })))
    }).catch((err) => {
      console.warn('Failed to load history:', err)
    })
  }, [])

  // Connect SSE for push notifications + report connection status
  useEffect(() => {
    const es = api.chat.connectSSE((data) => {
      if (data.type === 'message' && data.text) {
        setMessages((prev) => [
          ...prev,
          { role: 'notification', text: data.text, _id: nextId.current++ },
        ])
      }
    })
    es.onopen = () => onSSEStatus?.(true)
    es.onerror = () => onSSEStatus?.(false)
    return () => { es.close(); onSSEStatus?.(false) }
  }, [onSSEStatus])

  // Send message
  const handleSend = useCallback(async (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', text, _id: nextId.current++ }])
    setIsWaiting(true)

    try {
      const data = await api.chat.send(text)

      // Add media messages
      if (data.media?.length) {
        for (const m of data.media) {
          if (m.type === 'image') {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: `![image](${m.url})`, _id: nextId.current++ },
            ])
          }
        }
      }

      // Add text response
      if (data.text) {
        setMessages((prev) => [...prev, { role: 'assistant', text: data.text, _id: nextId.current++ }])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMessages((prev) => [
        ...prev,
        { role: 'notification', text: `Error: ${msg}`, _id: nextId.current++ },
      ])
    } finally {
      setIsWaiting(false)
    }
  }, [])

  const handleScrollToBottom = useCallback(() => {
    userScrolledUp.current = false
    setShowScrollBtn(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 max-w-[800px] mx-auto w-full">
      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-5 py-6 relative">
        {messages.length === 0 && !isWaiting && (
          <div className="flex-1 flex flex-col items-center justify-center h-full gap-4 select-none">
            <div className="w-14 h-14 rounded-2xl bg-bg-secondary border border-border flex items-center justify-center text-accent">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-text mb-1">Hi, I'm Alice</h2>
              <p className="text-sm text-text-muted">Send a message to start chatting</p>
            </div>
          </div>
        )}
        <div className="flex flex-col">
          {messages.map((msg, i) => {
            const prev = messages[i - 1]
            const isGrouped = prev?.role === msg.role && msg.role === 'assistant'
            return (
              <div key={msg._id} className={isGrouped ? 'mt-1' : i === 0 ? '' : 'mt-5'}>
                <ChatMessage
                  role={msg.role}
                  text={msg.text}
                  timestamp={msg.timestamp}
                  isGrouped={isGrouped}
                />
              </div>
            )
          })}
          {isWaiting && (
            <div className={`${messages.length > 0 ? 'mt-5' : ''}`}>
              <ThinkingIndicator />
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <div className="relative">
          <button
            onClick={handleScrollToBottom}
            className="absolute -top-12 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-bg-secondary border border-border text-text-muted hover:text-text hover:border-accent/50 flex items-center justify-center transition-all shadow-lg z-10"
            aria-label="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Input */}
      <ChatInput disabled={isWaiting} onSend={handleSend} />
    </div>
  )
}
