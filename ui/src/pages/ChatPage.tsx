import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import type { ChannelListItem } from '../api/channels'
import { useChat } from '../hooks/useChat'
import { ChatMessage, ToolCallGroup, ThinkingIndicator, StreamingToolGroup } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'
import { ChannelConfigModal } from '../components/ChannelConfigModal'
import { PushApprovalPanel } from '../components/PushApprovalPanel'

interface ChatPageProps {
  onSSEStatus?: (connected: boolean) => void
}

export function ChatPage({ onSSEStatus }: ChatPageProps) {
  const [channels, setChannels] = useState<ChannelListItem[]>([{ id: 'default', label: 'Alice' }])
  const [activeChannel, setActiveChannel] = useState('default')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)

  const { messages, streamSegments, isWaiting, send, abort, loadMore, hasMore, isLoadingMore } = useChat({
    channel: activeChannel,
    onSSEStatus: activeChannel === 'default' ? onSSEStatus : undefined,
  })

  // Popover state
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newChannelId, setNewChannelId] = useState('')
  const [newChannelLabel, setNewChannelLabel] = useState('')
  const [newChannelError, setNewChannelError] = useState('')
  const [editingChannel, setEditingChannel] = useState<ChannelListItem | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isOnSubChannel = activeChannel !== 'default'
  const subChannels = channels.filter((ch) => ch.id !== 'default')
  const activeChannelConfig = channels.find((ch) => ch.id === activeChannel)

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
        setShowNewForm(false)
        setNewChannelError('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

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
    // If the user returned to the bottom while the fetch was in flight,
    // let the auto-scroll-to-bottom effect handle layout instead.
    if (!userScrolledUp.current) return
    el.scrollTop = el.scrollHeight - offset
  }, [messages])

  // Safety: when a load-more returns empty (no new messages prepended),
  // the useLayoutEffect above never fires, so the captured offset would
  // otherwise linger and mis-adjust the next unrelated `messages` change.
  useEffect(() => {
    if (!isLoadingMore && preserveBottomOffsetRef.current != null) {
      preserveBottomOffsetRef.current = null
    }
  }, [isLoadingMore])

  // Track whether a load-more prepend is pending so we can compensate
  // scrollTop once the new DOM is laid out (prevents the viewport from
  // snapping to the old oldest item which is now hundreds of px down).
  const preserveBottomOffsetRef = useRef<number | null>(null)

  // Ref to loadMore — keeps scroll listener stable (effect re-registration
  // every render would drop events during fast streaming).
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore
  const isLoadingMoreRef = useRef(isLoadingMore)
  isLoadingMoreRef.current = isLoadingMore

  // Scroll lock plumbing.
  //
  // The lock flag `userScrolledUp` is driven ONLY by user-intent events
  // (wheel, touch, the explicit scroll-to-bottom button). onScroll handles
  // cosmetic UI state only — it must not mutate the lock, otherwise during
  // streaming the DOM scroll event races user wheel and resets the flag
  // before the next auto-scroll tick sees the user's intent.
  //
  // Also: when the user scrolls near the top, request the next older page.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const LOAD_MORE_TRIGGER_PX = 200

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distance > 20)
      if (distance <= 5) setNewMsgCount(0)

      // Infinite scroll up — fire when near the top and we have more,
      // aren't already loading, and aren't sitting at scrollTop 0 with
      // nothing above (initial empty layout).
      if (
        el.scrollTop < LOAD_MORE_TRIGGER_PX &&
        hasMoreRef.current &&
        !isLoadingMoreRef.current &&
        el.scrollHeight > el.clientHeight
      ) {
        // Capture the current "distance from bottom" so that after the
        // prepend lays out taller content, a useLayoutEffect can restore
        // scrollTop to the equivalent visible position.
        preserveBottomOffsetRef.current = el.scrollHeight - el.scrollTop
        loadMoreRef.current()
      }
    }

    // After a down-direction scroll, read the post-scroll position
    // (wheel events fire before the browser applies the delta, so we need
    // a frame of latency to see the real scrollTop).
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

  // Load channels list on mount
  useEffect(() => {
    api.channels.list().then(({ channels: ch }) => setChannels(ch)).catch(() => {})
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

  const switchToChannel = useCallback((id: string) => {
    setActiveChannel(id)
    setPopoverOpen(false)
    setShowNewForm(false)
    setNewChannelError('')
  }, [])

  const handleCreateChannel = useCallback(async () => {
    setNewChannelError('')
    if (!newChannelId.trim() || !newChannelLabel.trim()) {
      setNewChannelError('ID and label are required')
      return
    }
    try {
      const { channel } = await api.channels.create({ id: newChannelId.trim(), label: newChannelLabel.trim() })
      setChannels((prev) => [...prev, channel])
      switchToChannel(channel.id)
      setNewChannelId('')
      setNewChannelLabel('')
    } catch (err) {
      setNewChannelError(err instanceof Error ? err.message : 'Failed to create channel')
    }
  }, [newChannelId, newChannelLabel, switchToChannel])

  const handleDeleteChannel = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.channels.remove(id)
      setChannels((prev) => prev.filter((ch) => ch.id !== id))
      if (activeChannel === id) switchToChannel('default')
    } catch (err) {
      console.error('Failed to delete channel:', err)
    }
  }, [activeChannel, switchToChannel])

  return (
    <div className="flex flex-1 min-h-0">
    <div className="flex flex-col flex-1 min-h-0 max-w-[800px] mx-auto w-full">
      {/* Sub-channel context bar */}
      {isOnSubChannel && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-secondary/30">
          <button
            onClick={() => switchToChannel('default')}
            className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Alice
          </button>
          <span className="text-sm text-text-muted/50">|</span>
          <span className="text-sm font-medium text-text">
            <span className="text-text-muted mr-0.5">#</span>
            {activeChannelConfig?.label ?? activeChannel}
          </span>
          {activeChannelConfig && activeChannelConfig.id !== 'default' && (
            <button
              onClick={() => setEditingChannel(activeChannelConfig)}
              className="ml-auto w-6 h-6 rounded flex items-center justify-center text-text-muted/50 hover:text-text-muted hover:bg-bg-secondary transition-colors"
              title="Channel settings"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Messages area wrapper — relative so the # button stays fixed */}
      <div className="flex-1 min-h-0 relative">
        {/* # icon button — fixed in top-right corner, always visible on main channel */}
        {!isOnSubChannel && (
          <div className="absolute top-3 right-5 z-20" ref={popoverRef}>
            <button
              onClick={() => setPopoverOpen((v) => !v)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted/40 hover:text-text-muted hover:bg-bg-secondary/80 transition-all"
              aria-label="Channels"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9h16M4 15h16M10 3l-2 18M16 3l-2 18" />
              </svg>
            </button>

            {/* Popover dropdown */}
            {popoverOpen && (
              <div className="absolute top-9 right-0 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg shadow-xl py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                {subChannels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => switchToChannel(ch.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-text hover:bg-bg-secondary/60 transition-colors group"
                  >
                    <span>
                      <span className="text-text-muted mr-1">#</span>
                      {ch.label}
                    </span>
                    <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                      <span
                        onClick={(e) => { e.stopPropagation(); setEditingChannel(ch); setPopoverOpen(false) }}
                        className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-secondary cursor-pointer"
                        title="Settings"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </span>
                      <span
                        onClick={(e) => handleDeleteChannel(ch.id, e)}
                        className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-400/10 cursor-pointer"
                        title="Delete"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </span>
                    </span>
                  </button>
                ))}

                <div className="border-t border-border my-1" />

                {!showNewForm ? (
                  <button
                    onClick={() => setShowNewForm(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-bg-secondary/60 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    New channel
                  </button>
                ) : (
                  <div className="px-3 py-2 space-y-2">
                    <input
                      type="text"
                      placeholder="id (e.g. research)"
                      value={newChannelId}
                      onChange={(e) => setNewChannelId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                      className="w-full text-xs px-2 py-1.5 rounded border border-border bg-bg-secondary text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="label"
                      value={newChannelLabel}
                      onChange={(e) => setNewChannelLabel(e.target.value)}
                      className="w-full text-xs px-2 py-1.5 rounded border border-border bg-bg-secondary text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCreateChannel}
                        className="text-xs px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/80 transition-colors"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => { setShowNewForm(false); setNewChannelError(''); setNewChannelId(''); setNewChannelLabel('') }}
                        className="text-xs px-2 py-1 rounded text-text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                    {newChannelError && <p className="text-xs text-red-400">{newChannelError}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Scrollable messages */}
        <div ref={containerRef} className="h-full overflow-y-auto px-5 py-6">
        {/* History load-more status — appears at the top while older pages stream in */}
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
              {activeChannel === 'default' ? (
                <>
                  <h2 className="text-lg font-semibold text-text mb-1">Hi, I'm Alice</h2>
                  <p className="text-sm text-text-muted">Send a message to start chatting</p>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-text mb-1">{activeChannelConfig?.label ?? activeChannel}</h2>
                  <p className="text-sm text-text-muted">Send a message to start chatting</p>
                </>
              )}
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

      {/* Channel config modal */}
      {editingChannel && (
        <ChannelConfigModal
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
          onSaved={(updated) => {
            setChannels((prev) => prev.map((ch) => ch.id === updated.id ? updated : ch))
            setEditingChannel(null)
          }}
        />
      )}
    </div>
    <PushApprovalPanel />
    </div>
  )
}
