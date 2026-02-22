import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type ChatMessage as ChatMessageType } from '../api'
import { ChatMessage, ThinkingIndicator } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [isWaiting, setIsWaiting] = useState(false)
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
      userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 80
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Load chat history
  useEffect(() => {
    api.chat.history(100).then(({ messages }) => {
      setMessages(messages)
    }).catch((err) => {
      console.warn('Failed to load history:', err)
    })
  }, [])

  // Connect SSE for push notifications
  useEffect(() => {
    const es = api.chat.connectSSE((data) => {
      if (data.type === 'message' && data.text) {
        setMessages((prev) => [
          ...prev,
          { role: 'notification', text: data.text },
        ])
      }
    })
    return () => es.close()
  }, [])

  // Send message
  const handleSend = useCallback(async (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', text }])
    setIsWaiting(true)

    try {
      const data = await api.chat.send(text)

      // Add media messages
      if (data.media?.length) {
        for (const m of data.media) {
          if (m.type === 'image') {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: `![image](${m.url})` },
            ])
          }
        }
      }

      // Add text response
      if (data.text) {
        setMessages((prev) => [...prev, { role: 'assistant', text: data.text }])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setMessages((prev) => [
        ...prev,
        { role: 'notification', text: `Error: ${msg}` },
      ])
    } finally {
      setIsWaiting(false)
    }
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 max-w-[800px] mx-auto w-full">
      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {messages.length === 0 && !isWaiting && (
          <div className="flex-1 flex items-center justify-center text-text-muted text-base h-full">
            Send a message to start chatting
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} text={msg.text} timestamp={msg.timestamp} />
        ))}
        {isWaiting && <ThinkingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput disabled={isWaiting} onSend={handleSend} />
    </div>
  )
}
