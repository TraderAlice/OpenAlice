import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type EventLogEntry, type ToolCallRecord } from '../api'
import { useSSE } from '../hooks/useSSE'
import { PageHeader } from '../components/PageHeader'

// ==================== Helpers ====================

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour12: false })
  return `${date} ${time}`
}

function eventTypeColor(type: string): string {
  if (type.startsWith('heartbeat.')) return 'text-purple'
  if (type.startsWith('cron.')) return 'text-accent'
  if (type.startsWith('message.')) return 'text-green'
  return 'text-text-muted'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function statusColor(status: string): string {
  return status === 'error' ? 'text-red' : 'text-green'
}

/** Try to pretty-print JSON output, fall back to raw string. */
function formatOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2)
  } catch {
    return output
  }
}

// ==================== EventLog Section ====================

const EVENT_PAGE_SIZE = 100

function EventLogSection() {
  const [entries, setEntries] = useState<EventLogEntry[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [types, setTypes] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch a page from disk
  const fetchPage = useCallback(async (p: number, type?: string) => {
    setLoading(true)
    try {
      const result = await api.events.query({
        page: p,
        pageSize: EVENT_PAGE_SIZE,
        type: type || undefined,
      })
      setEntries(result.entries)
      setPage(result.page)
      setTotalPages(result.totalPages)
      setTotal(result.total)
    } catch (err) {
      console.warn('Failed to load events:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchPage(1) }, [fetchPage])

  // Track all seen event types (persists across page changes)
  useEffect(() => {
    if (entries.length > 0) {
      setTypes((prev) => {
        const next = new Set(prev)
        for (const e of entries) next.add(e.type)
        return [...next].sort()
      })
    }
  }, [entries])

  // SSE for real-time events — only affects page 1
  useSSE({
    url: '/api/events/stream',
    onMessage: (entry: EventLogEntry) => {
      // Always track new types
      setTypes((prev) => {
        if (prev.includes(entry.type)) return prev
        return [...prev, entry.type].sort()
      })
      // Increment total
      setTotal((prev) => prev + 1)
      // Only prepend to visible list when on page 1 and matching filter
      if (page === 1) {
        const matchesFilter = !typeFilter || entry.type === typeFilter
        if (matchesFilter) {
          setEntries((prev) => [entry, ...prev].slice(0, EVENT_PAGE_SIZE))
        }
      }
    },
    enabled: !paused,
  })

  // Type filter change → reset to page 1
  const handleTypeChange = useCallback((type: string) => {
    setTypeFilter(type)
    fetchPage(1, type)
  }, [fetchPage])

  // Page navigation
  const goToPage = useCallback((p: number) => {
    fetchPage(p, typeFilter || undefined)
    containerRef.current?.scrollTo(0, 0)
  }, [fetchPage, typeFilter])

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 shrink-0">
        <select
          value={typeFilter}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="bg-bg-tertiary text-text text-sm rounded-md border border-border px-2 py-1.5 outline-none focus:border-accent"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <button
          onClick={() => setPaused(!paused)}
          className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
            paused
              ? 'border-notification-border text-notification-border hover:bg-notification-bg'
              : 'border-border text-text-muted hover:bg-bg-tertiary'
          }`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <span className="text-xs text-text-muted ml-auto">
          {total > 0
            ? `Page ${page} of ${totalPages} · ${total} events`
            : '0 events'
          }
          {typeFilter && ' (filtered)'}
        </span>
      </div>

      {/* Event list — fills remaining space */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-bg rounded-lg border border-border overflow-y-auto font-mono text-xs"
      >
        {loading && entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted">No events yet</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="text-text-muted text-left">
                <th className="px-3 py-2 w-12">#</th>
                <th className="px-3 py-2 w-36">Time</th>
                <th className="px-3 py-2 w-40">Type</th>
                <th className="px-3 py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EventRow key={entry.seq} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <button
            onClick={() => goToPage(1)}
            disabled={page <= 1 || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ««
          </button>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            «
          </button>
          <span className="text-xs text-text-muted px-2">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            »
          </button>
          <button
            onClick={() => goToPage(totalPages)}
            disabled={page >= totalPages || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            »»
          </button>
        </div>
      )}
    </div>
  )
}

function EventRow({ entry }: { entry: EventLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const payloadStr = JSON.stringify(entry.payload)
  const isLong = payloadStr.length > 120

  return (
    <>
      <tr
        className="border-t border-border/50 hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-text-muted">{entry.seq}</td>
        <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{formatDateTime(entry.ts)}</td>
        <td className={`px-3 py-1.5 ${eventTypeColor(entry.type)}`}>{entry.type}</td>
        <td className="px-3 py-1.5 text-text-muted truncate">
          {isLong ? payloadStr.slice(0, 120) + '...' : payloadStr}
          {isLong && (
            <span className="ml-1 text-accent">{expanded ? '▾' : '▸'}</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30">
          <td colSpan={4} className="px-3 py-2">
            <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px]">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// ==================== Tool Call Log Section ====================

const TOOL_PAGE_SIZE = 100

function ToolCallLogSection() {
  const [entries, setEntries] = useState<ToolCallRecord[]>([])
  const [nameFilter, setNameFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [toolNames, setToolNames] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchPage = useCallback(async (p: number, name?: string) => {
    setLoading(true)
    try {
      const result = await api.agentStatus.query({
        page: p,
        pageSize: TOOL_PAGE_SIZE,
        name: name || undefined,
      })
      setEntries(result.entries)
      setPage(result.page)
      setTotalPages(result.totalPages)
      setTotal(result.total)
    } catch (err) {
      console.warn('Failed to load tool calls:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPage(1) }, [fetchPage])

  // Track tool names for filter dropdown
  useEffect(() => {
    if (entries.length > 0) {
      setToolNames((prev) => {
        const next = new Set(prev)
        for (const e of entries) next.add(e.name)
        return [...next].sort()
      })
    }
  }, [entries])

  // SSE real-time updates
  useSSE({
    url: '/api/agent-status/stream',
    onMessage: (record: ToolCallRecord) => {
      setToolNames((prev) => {
        if (prev.includes(record.name)) return prev
        return [...prev, record.name].sort()
      })
      setTotal((prev) => prev + 1)
      if (page === 1) {
        const matchesFilter = !nameFilter || record.name === nameFilter
        if (matchesFilter) {
          setEntries((prev) => [record, ...prev].slice(0, TOOL_PAGE_SIZE))
        }
      }
    },
    enabled: !paused,
  })

  const handleNameChange = useCallback((name: string) => {
    setNameFilter(name)
    fetchPage(1, name)
  }, [fetchPage])

  const goToPage = useCallback((p: number) => {
    fetchPage(p, nameFilter || undefined)
    containerRef.current?.scrollTo(0, 0)
  }, [fetchPage, nameFilter])

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 shrink-0">
        <select
          value={nameFilter}
          onChange={(e) => handleNameChange(e.target.value)}
          className="bg-bg-tertiary text-text text-sm rounded-md border border-border px-2 py-1.5 outline-none focus:border-accent"
        >
          <option value="">All tools</option>
          {toolNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <button
          onClick={() => setPaused(!paused)}
          className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
            paused
              ? 'border-notification-border text-notification-border hover:bg-notification-bg'
              : 'border-border text-text-muted hover:bg-bg-tertiary'
          }`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        <span className="text-xs text-text-muted ml-auto">
          {total > 0
            ? `Page ${page} of ${totalPages} \u00b7 ${total} calls`
            : '0 calls'
          }
          {nameFilter && ' (filtered)'}
        </span>
      </div>

      {/* Table */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-bg rounded-lg border border-border overflow-y-auto font-mono text-xs"
      >
        {loading && entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted">No tool calls yet</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="text-text-muted text-left">
                <th className="px-3 py-2 w-12">#</th>
                <th className="px-3 py-2 w-36">Time</th>
                <th className="px-3 py-2 w-48">Tool</th>
                <th className="px-3 py-2 w-20 text-right">Duration</th>
                <th className="px-3 py-2 w-16 text-center">Status</th>
                <th className="px-3 py-2">Input</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((record) => (
                <ToolCallRow key={record.seq} record={record} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <button
            onClick={() => goToPage(1)}
            disabled={page <= 1 || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &laquo;&laquo;
          </button>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &laquo;
          </button>
          <span className="text-xs text-text-muted px-2">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &raquo;
          </button>
          <button
            onClick={() => goToPage(totalPages)}
            disabled={page >= totalPages || loading}
            className="text-xs px-2 py-1 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &raquo;&raquo;
          </button>
        </div>
      )}
    </div>
  )
}

function ToolCallRow({ record }: { record: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false)
  const inputStr = JSON.stringify(record.input)
  const inputPreview = inputStr.length > 100 ? inputStr.slice(0, 100) + '...' : inputStr

  return (
    <>
      <tr
        className="border-t border-border/50 hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-text-muted">{record.seq}</td>
        <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{formatDateTime(record.timestamp)}</td>
        <td className="px-3 py-1.5 text-accent">{record.name}</td>
        <td className="px-3 py-1.5 text-right text-text-muted">{formatDuration(record.durationMs)}</td>
        <td className={`px-3 py-1.5 text-center ${statusColor(record.status)}`}>{record.status}</td>
        <td className="px-3 py-1.5 text-text-muted truncate max-w-0">
          {inputPreview}
          <span className="ml-1 text-accent">{expanded ? '\u25be' : '\u25b8'}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30">
          <td colSpan={6} className="px-3 py-2 space-y-2">
            <div>
              <span className="text-text-muted text-[11px] uppercase tracking-wide">Input</span>
              <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px] mt-1">
                {JSON.stringify(record.input, null, 2)}
              </pre>
            </div>
            <div>
              <span className="text-text-muted text-[11px] uppercase tracking-wide">Output</span>
              <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px] mt-1 max-h-64 overflow-y-auto">
                {formatOutput(record.output)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ==================== Page ====================

type Tab = 'events' | 'tools'

const TABS: { key: Tab; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'tools', label: 'Tool Calls' },
]

export function LogsPage() {
  const [tab, setTab] = useState<Tab>('events')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Logs" />

      <div className="px-4 md:px-6 border-b border-border/60">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors relative ${
                tab === t.key ? 'text-accent' : 'text-text-muted hover:text-text'
              }`}
            >
              {t.label}
              {tab === t.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-4 md:px-6 py-5">
        <div className="flex-1 min-h-0">
          {tab === 'events' ? <EventLogSection /> : <ToolCallLogSection />}
        </div>
      </div>
    </div>
  )
}
