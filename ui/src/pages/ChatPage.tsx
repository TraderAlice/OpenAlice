import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useChat } from '../hooks/useChat'
import { useChannels } from '../contexts/ChannelsContext'
import { ChatMessage, ToolCallGroup, ThinkingIndicator, StreamingToolGroup } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'
import { PushApprovalPanel } from '../components/PushApprovalPanel'

export function ChatPage() {
  const { channels, activeChannel } = useChannels()
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)

  const { messages, streamSegments, isWaiting, send, abort, loadMore, hasMore, isLoadingMore } = useChat({
    channel: activeChannel,
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeChannelConfig = channels.find((ch) => ch.id === activeChannel)

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [])

  useEffect(scrollToBottom, [messages, isWaiting, streamSegments, scrollToBottom])

  // After a load-more prepend finishes laying out, re-anchor scrollTop to
  // the same visual position. Without this the viewport jumps because
  // scrollHeight grew and scrollTop stayed constant.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const offset = preserveBottomOffsetRef.current
    if (offset == null) return
    preserveBottomOffsetRef.current = null
    if (!userScrolledUp.current) return
    el.scrollTop = el.scrollHeight - offset
  }, [messages])

  // Safety: when a load-more returns empty, clear the captured offset so it
  // doesn't linger and mis-adjust the next unrelated `messages` change.
  useEffect(() => {
    if (!isLoadingMore && preserveBottomOffsetRef.current != null) {
      preserveBottomOffsetRef.current = null
    }
  }, [isLoadingMore])

  const preserveBottomOffsetRef = useRef<number | null>(null)

  // Refs for stable scroll-listener captures.
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore
  const isLoadingMoreRef = useRef(isLoadingMore)
  isLoadingMoreRef.current = isLoadingMore

  // Scroll lock plumbing — see prior notes; user-intent events drive lock,
  // onScroll handles cosmetic UI state and triggers infinite-scroll-up.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const LOAD_MORE_TRIGGER_PX = 200

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distance > 20)
      if (distance <= 5) setNewMsgCount(0)

      if (
        el.scrollTop < LOAD_MORE_TRIGGER_PX &&
        hasMoreRef.current &&
        !isLoadingMoreRef.current &&
        el.scrollHeight > el.clientHeight
      ) {
        preserveBottomOffsetRef.current = el.scrollHeight - el.scrollTop
        loadMoreRef.current()
      }
    }

    const unlockIfAtBottom = () => {
      requestAnimationFrame(() => {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight
        if (distance <= 5) userScrolledUp.current = false
      })
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledUp.current = true
        setShowScrollBtn(true)
      } else if (e.deltaY > 0) {
        unlockIfAtBottom()
      }
    }

    const onTouchMove = () => {
      userScrolledUp.current = true
      setShowScrollBtn(true)
    }
    const onTouchEnd = () => { unlockIfAtBottom() }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abort() }
  }, [abort])

  const handleScrollToBottom = useCallback(() => {
    userScrolledUp.current = false
    setShowScrollBtn(false)
    setNewMsgCount(0)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <PanelGroup direction="horizontal" autoSaveId="chat-layout" className="flex-1 min-h-0">
      <Panel defaultSize={70} minSize={40} className="flex flex-col min-h-0">
      <div className="flex flex-col flex-1 min-h-0 max-w-[800px] mx-auto w-full">
        {/* Messages area */}
        <div className="flex-1 min-h-0 relative">
          <div ref={containerRef} className="h-full overflow-y-auto px-5 py-6">
            {/* History load-more status */}
            {messages.length > 0 && (isLoadingMore || !hasMore) && (
              <div className="text-center text-[11px] text-text-muted/50 select-none pb-3">
                {isLoadingMore ? 'Loading older messages…' : '— beginning of history —'}
              </div>
            )}
            {messages.length === 0 && !isWaiting && (
              <div className="flex-1 flex flex-col items-center justify-center h-full gap-4 select-none">
                <img
                  src="/alice.ico"
                  alt="Alice"
                  className="w-14 h-14 rounded-2xl ring-1 ring-accent/20 shadow-[0_0_16px_rgba(88,166,255,0.12)]"
                  draggable={false}
                />
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-text mb-1">{activeChannelConfig?.label ?? activeChannel}</h2>
                  <p className="text-sm text-text-muted">Send a message to start chatting</p>
                </div>
              </div>
            )}
            <div className="flex flex-col">
              {messages.map((msg, i) => {
                const prev = i > 0 ? messages[i - 1] : undefined

                if (msg.kind === 'tool_calls') {
                  const prevIsAssistantish = prev != null && (
                    prev.kind === 'tool_calls' ||
                    (prev.kind === 'text' && prev.role === 'assistant')
                  )
                  return (
                    <div key={msg._id} className={prevIsAssistantish ? 'mt-1' : i === 0 ? '' : 'mt-5'}>
                      <ToolCallGroup calls={msg.calls} timestamp={msg.timestamp} />
                    </div>
                  )
                }

                const isGrouped =
                  msg.role === 'assistant' && prev != null && (
                    (prev.kind === 'text' && prev.role === 'assistant') ||
                    prev.kind === 'tool_calls'
                  )
                return (
                  <div key={msg._id} className={isGrouped ? 'mt-1' : i === 0 ? '' : 'mt-5'}>
                    <ChatMessage
                      role={msg.role}
                      text={msg.text}
                      timestamp={msg.timestamp}
                      isGrouped={isGrouped}
                      media={msg.media}
                    />
                  </div>
                )
              })}
              {isWaiting && (
                <div className={`${messages.length > 0 ? 'mt-5' : ''}`}>
                  {streamSegments.length > 0 ? (
                    <>
                      {streamSegments.map((seg, i) => {
                        if (seg.kind === 'tools') {
                          const allDone = seg.tools.every((t) => t.status === 'done')
                          return (
                            <div key={i} className={i > 0 ? 'mt-1' : ''}>
                              {allDone ? (
                                <ToolCallGroup calls={seg.tools.map((t) => ({
                                  name: t.name,
                                  input: typeof t.input === 'string' ? t.input : JSON.stringify(t.input ?? ''),
                                  result: t.result,
                                }))} />
                              ) : (
                                <StreamingToolGroup tools={seg.tools} />
                              )}
                            </div>
                          )
                        }
                        return (
                          <div key={i} className={i > 0 ? 'mt-1' : ''}>
                            <ChatMessage role="assistant" text={seg.text} isGrouped={i > 0} />
                          </div>
                        )
                      })}
                      {(() => {
                        const last = streamSegments[streamSegments.length - 1]
                        if (last?.kind === 'tools' && last.tools.every((t) => t.status === 'done')) {
                          return (
                            <div className="text-text-muted ml-8 mt-1">
                              <div className="flex">
                                <span className="thinking-dot">.</span>
                                <span className="thinking-dot">.</span>
                                <span className="thinking-dot">.</span>
                              </div>
                            </div>
                          )
                        }
                        return null
                      })()}
                    </>
                  ) : (
                    <ThinkingIndicator />
                  )}
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <div className="relative">
            <button
              onClick={handleScrollToBottom}
              className="absolute -top-14 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-bg-secondary border border-border text-text-muted hover:text-text hover:border-accent/50 flex items-center justify-center transition-all shadow-lg z-10"
              aria-label="Scroll to bottom"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              {newMsgCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center px-1">
                  {newMsgCount > 99 ? '99+' : newMsgCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Input */}
        <ChatInput disabled={isWaiting} onSend={send} />
      </div>
      </Panel>
      <PanelResizeHandle disabled className="w-px bg-border" />
      <Panel defaultSize={30} minSize={20} className="flex flex-col min-h-0">
        <PushApprovalPanel />
      </Panel>
    </PanelGroup>
  )
}
