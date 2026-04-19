import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type ChatHistoryItem } from '../api'
import type { DiaryCycle, DiaryOutcome } from '../api/diary'
import { ToolCallGroup } from '../components/ChatMessage'
import { MarkdownContent } from '../components/MarkdownContent'
import { BrainSidebar } from '../components/BrainSidebar'

// ==================== Constants ====================

/** Background poll cadence while the tab is visible. Heartbeat fires ~every 30min, so 60s is plenty. */
const POLL_INTERVAL_MS = 60_000

/** Session entries can land up to this much later than the cycle event (cron.fire → prompt write → AI reply → event.append). */
const CYCLE_TS_SLACK_MS = 5_000

// ==================== Helpers ====================

/**
 * Strip heartbeat response preamble ("STATUS: HEARTBEAT_OK — ..." / "STATUS: CHAT_YES\n...")
 * so the diary shows Alice's actual thought, not the machine-facing status token.
 */
function stripStatusPrefix(text: string): string {
  const m = text.match(/^\s*STATUS:\s*(HEARTBEAT_OK|CHAT_YES)\s*(?:[\u2014\-:]\s*)?([\s\S]*)$/)
  return m ? m[2].trim() : text
}

/** Stable key for diffing items across polls. Session entries don't expose uuid to the UI, so combine timestamp + content digest. */
function itemKey(item: ChatHistoryItem): string {
  if (item.kind === 'text') return `t|${item.timestamp ?? ''}|${item.role}|${item.text.slice(0, 80)}`
  return `tc|${item.timestamp ?? ''}|${item.calls.map((c) => c.name).join(',')}`
}

function itemTs(item: ChatHistoryItem): number {
  return item.timestamp ? new Date(item.timestamp).getTime() : 0
}

function isDiaryBody(item: ChatHistoryItem): boolean {
  // Hide cron trigger prompts (user-role) — they're machine input, not conversation.
  if (item.kind === 'text' && item.role === 'user') return false
  if (item.kind === 'text' && !stripStatusPrefix(item.text).trim()) return false
  return true
}

// ==================== Date grouping ====================

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayLabel(date: Date, now = new Date()): string {
  if (sameDay(date, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return 'Yesterday'
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric', weekday: 'short' }
    : { year: 'numeric', month: 'short', day: 'numeric' })
}

function timeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ==================== Outcome presentation ====================

function outcomeLabel(o: DiaryOutcome): string {
  switch (o) {
    case 'delivered': return 'sent to chat'
    case 'silent-ok': return 'quiet'
    case 'duplicate': return 'duplicate'
    case 'empty': return 'empty'
    case 'outside-hours': return 'off-hours'
    case 'error': return 'error'
  }
}

function outcomeChipClass(o: DiaryOutcome): string {
  const base = 'shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border tabular-nums'
  switch (o) {
    case 'delivered': return `${base} border-accent/40 text-accent bg-accent/5`
    case 'silent-ok': return `${base} border-border/40 text-text-muted/70`
    case 'duplicate': return `${base} border-border/40 text-text-muted/50`
    case 'empty': return `${base} border-border/40 text-text-muted/50`
    case 'outside-hours': return `${base} border-border/40 text-text-muted/50`
    case 'error': return `${base} border-red/40 text-red bg-red/5`
  }
}

/** Body-bearing cycles get cards; terse outcomes render as slim divider rows. */
function cycleHasCard(outcome: DiaryOutcome): boolean {
  return outcome === 'delivered' || outcome === 'silent-ok' || outcome === 'error'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

// ==================== Grouping: attribute items to cycles ====================

interface CycleGroup {
  cycle: DiaryCycle
  items: ChatHistoryItem[]
}

/**
 * Walk cycles ascending and attach each session item to the cycle whose timestamp
 * window it falls into: (prev.ts, cycle.ts + slack].
 */
function groupItemsByCycle(items: ChatHistoryItem[], cycles: DiaryCycle[]): CycleGroup[] {
  const sorted = [...cycles].sort((a, b) => a.ts - b.ts)
  const groups: CycleGroup[] = sorted.map((cycle) => ({ cycle, items: [] }))

  const filtered = items
    .filter(isDiaryBody)
    .sort((a, b) => itemTs(a) - itemTs(b))

  let cursor = 0
  for (const item of filtered) {
    const ts = itemTs(item)
    // Advance cursor until the current cycle window can contain this item.
    while (cursor < groups.length && ts > groups[cursor].cycle.ts + CYCLE_TS_SLACK_MS) {
      cursor++
    }
    if (cursor >= groups.length) break
    // Item could be orphaned if it predates the oldest cycle — just drop it.
    groups[cursor].items.push(item)
  }

  return groups
}

// ==================== Page ====================

export function DiaryPage() {
  const [items, setItems] = useState<ChatHistoryItem[]>([])
  const [cycles, setCycles] = useState<DiaryCycle[]>([])
  const [latestSeq, setLatestSeq] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const latestSeqRef = useRef(0)
  latestSeqRef.current = latestSeq

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const fetchFull = useCallback(async () => {
    try {
      const res = await api.diary.history({ limit: 100 })
      setItems(res.items)
      setCycles(res.cycles)
      setLatestSeq(res.latestSeq)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDelta = useCallback(async () => {
    if (latestSeqRef.current === 0) return
    try {
      const res = await api.diary.history({ afterSeq: latestSeqRef.current })
      if (res.cycles.length === 0) {
        if (res.latestSeq !== latestSeqRef.current) setLatestSeq(res.latestSeq)
        return
      }
      setCycles((prev) => {
        const seen = new Set(prev.map((c) => c.seq))
        const fresh = res.cycles.filter((c) => !seen.has(c.seq))
        return fresh.length === 0 ? prev : [...prev, ...fresh]
      })
      setItems((prev) => {
        const seen = new Set(prev.map(itemKey))
        const fresh = res.items.filter((it) => !seen.has(itemKey(it)))
        return fresh.length === 0 ? prev : [...prev, ...fresh]
      })
      setLatestSeq(res.latestSeq)
    } catch (err) {
      // Silent on poll failures — next poll will retry.
      console.warn('diary poll failed', err)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchFull() }, [fetchFull])

  // Refresh on tab focus
  useEffect(() => {
    const onFocus = () => { fetchDelta() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchDelta])

  // Gentle interval poll while visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchDelta()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchDelta])

  // Auto-scroll to bottom on new content, unless user scrolled up
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior })
    }
  }, [])
  useEffect(() => { scrollToBottom() }, [items, cycles, scrollToBottom])

  // Track scroll position
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

  const groups = useMemo(() => groupItemsByCycle(items, cycles), [items, cycles])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    fetchFull()
  }, [fetchFull])

  const handleScrollToBottom = useCallback(() => {
    userScrolledUp.current = false
    setShowScrollBtn(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Render: walk groups and emit a date divider whenever the calendar day changes.
  const rendered = useMemo(() => {
    const nodes: Array<{ key: string; render: () => ReactNode }> = []
    let lastDay: Date | null = null
    const now = new Date()

    for (const group of groups) {
      const cycleDate = new Date(group.cycle.ts)
      if (!lastDay || !sameDay(lastDay, cycleDate)) {
        const label = dayLabel(cycleDate, now)
        nodes.push({
          key: `day|${cycleDate.toDateString()}`,
          render: () => <DayDivider label={label} />,
        })
        lastDay = cycleDate
      }
      nodes.push({
        key: `cycle|${group.cycle.seq}`,
        render: () => <CycleEntry group={group} />,
      })
    }
    return nodes
  }, [groups])

  return (
    <div className="flex flex-1 min-h-0">
      {/* Main feed column — left-aligned, not centered, so the right-side Brain sidebar has room on wide screens. */}
      <div className="flex flex-col flex-1 min-h-0 max-w-[760px]">
        {/* Slim header */}
        <div className="flex items-baseline gap-3 px-5 pt-6 pb-4 shrink-0">
          <h1 className="text-xl font-semibold text-text tracking-tight">Diary</h1>
          <span className="text-[12px] text-text-muted/60">what Alice has been up to</span>
          <button
            onClick={handleRefresh}
            className="ml-auto text-text-muted hover:text-text p-1.5 rounded-md hover:bg-bg-secondary transition-colors"
            title="Refresh"
            aria-label="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        {/* Narrow-screen Brain panels — flat layout above the feed, default collapsed. */}
        <div className="lg:hidden px-5 pb-3 shrink-0">
          <BrainSidebar variant="flat" />
        </div>

        {/* Feed */}
        <div className="flex-1 min-h-0 relative">
          <div ref={containerRef} className="h-full overflow-y-auto px-5 pb-8">
            {loading && items.length === 0 && cycles.length === 0 && (
              <div className="flex items-center justify-center h-full text-text-muted text-sm">Loading...</div>
            )}

            {!loading && rendered.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
                <img src="/alice.ico" alt="Alice" className="w-12 h-12 rounded-2xl ring-1 ring-accent/20 opacity-70" />
                <div className="text-center">
                  <h2 className="text-base font-semibold text-text mb-1">Nothing yet</h2>
                  <p className="text-[12px] text-text-muted">Heartbeat cycles will appear here as they run.</p>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-center h-full text-sm text-red">
                Failed to load: {error}
              </div>
            )}

            <div className="flex flex-col">
              {rendered.map((node) => (
                <div key={node.key}>{node.render()}</div>
              ))}
            </div>

            <div ref={messagesEndRef} />
          </div>

          {showScrollBtn && (
            <button
              onClick={handleScrollToBottom}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-bg-secondary border border-border text-text-muted hover:text-text hover:border-accent/50 flex items-center justify-center transition-all shadow-lg"
              aria-label="Scroll to bottom"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Wide-screen Brain sidebar — always-expanded panels on the right. */}
      <aside className="hidden lg:flex flex-col shrink-0 w-72 xl:w-80 border-l border-border/30 bg-bg-secondary/10">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-6 pb-6">
          <BrainSidebar variant="sidebar" />
        </div>
      </aside>
    </div>
  )
}

// ==================== Day divider ====================

function DayDivider({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 py-2 -mx-5 px-5 bg-bg/95 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/30" />
        <span className="text-[11px] font-medium text-text-muted/70 tracking-wide uppercase">{label}</span>
        <div className="h-px flex-1 bg-border/30" />
      </div>
    </div>
  )
}

// ==================== Cycle entry ====================

function CycleEntry({ group }: { group: CycleGroup }) {
  if (cycleHasCard(group.cycle.outcome)) {
    return <CycleCard group={group} />
  }
  return <CycleRow cycle={group.cycle} />
}

/** Full card for cycles with a meaningful body (delivered / silent-ok / error). */
function CycleCard({ group }: { group: CycleGroup }) {
  const { cycle, items } = group
  const time = timeOfDay(cycle.ts)
  const duration = cycle.durationMs !== undefined ? formatDuration(cycle.durationMs) : null
  const hasContent = items.length > 0 || cycle.outcome === 'error'

  return (
    <article className="mt-5 first:mt-3 rounded-xl border border-border/40 bg-bg-secondary/20 overflow-hidden">
      {/* Header strip */}
      <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-bg-secondary/30">
        <span className="text-[12px] text-text-muted/80 font-medium tabular-nums">{time}</span>
        <span className={outcomeChipClass(cycle.outcome)}>{outcomeLabel(cycle.outcome)}</span>
        {duration && (
          <span className="ml-auto text-[11px] text-text-muted/50 tabular-nums" title="Duration">
            {duration}
          </span>
        )}
      </header>

      {/* Body */}
      {hasContent ? (
        <div className="px-4 py-3 space-y-3">
          {cycle.outcome === 'error' && (
            <div className="text-[13px] text-red/90 font-mono whitespace-pre-wrap break-words">
              {cycle.reason ?? 'Unknown error'}
            </div>
          )}
          {items.map((item, i) => (
            <CycleBodyItem key={`${cycle.seq}-${i}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-[12px] text-text-muted/60 italic">
          (no recorded output)
        </div>
      )}
    </article>
  )
}

/** Slim divider row for cycles that carry no interesting body (duplicate / empty / outside-hours). */
function CycleRow({ cycle }: { cycle: DiaryCycle }) {
  const time = timeOfDay(cycle.ts)
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-muted/60 py-1.5 mt-2 first:mt-0">
      <span className="tabular-nums shrink-0">{time}</span>
      <span className={outcomeChipClass(cycle.outcome)}>{outcomeLabel(cycle.outcome)}</span>
      {cycle.reason && (
        <span className="truncate opacity-70" title={cycle.reason}>{cycle.reason}</span>
      )}
      <div className="flex-1 h-px bg-border/20 ml-1" />
    </div>
  )
}

// ==================== Body item ====================

function CycleBodyItem({ item }: { item: ChatHistoryItem }) {
  if (item.kind === 'tool_calls') {
    // ToolCallGroup ships with ml-8 for Chat's avatar-aligned context; cancel it here since Diary cards have no avatar.
    return (
      <div className="-ml-8">
        <ToolCallGroup calls={item.calls} />
      </div>
    )
  }
  const text = stripStatusPrefix(item.text)
  return (
    <div className="text-[13.5px] leading-relaxed text-text/90">
      <MarkdownContent text={text} />
      {item.media && item.media.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {item.media.map((m, i) => (
            <img key={i} src={m.url} alt="" className="max-w-full rounded-lg" />
          ))}
        </div>
      )}
    </div>
  )
}
