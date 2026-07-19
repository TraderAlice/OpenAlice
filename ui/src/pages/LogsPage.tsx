import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type ToolCallRecord } from '../api'
import { getIntlLocale } from '../lib/intl'
import { Skeleton } from '../components/StateViews'

// ==================== Helpers ====================

/** First-load placeholder for a log list — a short stack of skeleton rows. */
function LogRowsSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-3 py-1.5 border-t border-border/50 first:border-t-0">
          <Skeleton className="h-3.5 w-full rounded" />
        </div>
      ))}
    </div>
  )
}

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(getIntlLocale(), { hour12: false })
  return `${date} ${time}`
}


function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function statusColor(status: string): string {
  return status === 'error' ? 'text-destructive' : 'text-success'
}

/** Try to pretty-print JSON output, fall back to raw string. */
function formatOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2)
  } catch {
    return output
  }
}

// ==================== Tool Call Log ====================

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

  // Live updates via polling — refetch page 1 every 3s while not paused.
  // Older pages don't poll (user is browsing history; not jumping back).
  useEffect(() => {
    if (paused || page !== 1) return
    const interval = setInterval(() => {
      fetchPage(1, nameFilter || undefined)
    }, 3000)
    return () => clearInterval(interval)
  }, [paused, page, nameFilter, fetchPage])

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
          className="bg-muted text-foreground text-sm rounded-md border border-border px-2 py-1.5 outline-none focus:border-primary"
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
              ? 'border-warning-border text-warning hover:bg-warning-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        <span className="text-xs text-muted-foreground ml-auto">
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
        className="flex-1 min-h-0 bg-background rounded-lg border border-border overflow-y-auto font-mono text-xs"
      >
        {loading && entries.length === 0 ? (
          <LogRowsSkeleton />
        ) : entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground">No tool calls yet</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-secondary">
              <tr className="text-muted-foreground text-left">
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
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &laquo;&laquo;
          </button>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &laquo;
          </button>
          <span className="text-xs text-muted-foreground px-2">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &raquo;
          </button>
          <button
            onClick={() => goToPage(totalPages)}
            disabled={page >= totalPages || loading}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
        className="border-t border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-muted-foreground">{record.seq}</td>
        <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatDateTime(record.timestamp)}</td>
        <td className="px-3 py-1.5 text-primary">{record.name}</td>
        <td className="px-3 py-1.5 text-right text-muted-foreground">{formatDuration(record.durationMs)}</td>
        <td className={`px-3 py-1.5 text-center ${statusColor(record.status)}`}>{record.status}</td>
        <td className="px-3 py-1.5 text-muted-foreground truncate max-w-0">
          {inputPreview}
          <span className="ml-1 text-primary">{expanded ? '\u25be' : '\u25b8'}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30">
          <td colSpan={6} className="px-3 py-2 space-y-2">
            <div>
              <span className="text-muted-foreground text-[11px] uppercase tracking-wide">Input</span>
              <pre className="text-muted-foreground whitespace-pre-wrap break-all bg-muted rounded p-2 text-[11px] mt-1">
                {JSON.stringify(record.input, null, 2)}
              </pre>
            </div>
            <div>
              <span className="text-muted-foreground text-[11px] uppercase tracking-wide">Output</span>
              <pre className="text-muted-foreground whitespace-pre-wrap break-all bg-muted rounded p-2 text-[11px] mt-1 max-h-64 overflow-y-auto">
                {formatOutput(record.output)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function LogsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-4 md:px-6 py-5">
      <ToolCallLogSection />
    </div>
  )
}
