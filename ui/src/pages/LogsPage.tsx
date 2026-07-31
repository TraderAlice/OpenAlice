import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type AgentConversationRecord, type ToolCallRecord } from '../api'
import { getIntlLocale } from '../lib/intl'
import { EmptyState, Skeleton } from '../components/StateViews'
import { SegmentedControl } from '../components/SegmentedControl'

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

function conversationStatusColor(status: AgentConversationRecord['status']): string {
  if (status === 'failed' || status === 'interrupted') return 'text-destructive'
  if (status === 'running') return 'text-warning'
  return 'text-success'
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
  const [failed, setFailed] = useState(false)
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
      setFailed(false)
    } catch (err) {
      console.warn('Failed to load tool calls:', err)
      setFailed(true)
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
    containerRef.current?.scrollTo?.(0, 0)
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
          {failed && entries.length === 0
            ? 'Tool calls unavailable'
            : total > 0
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
        ) : failed && entries.length === 0 ? (
          <div
            role="alert"
            className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-6 text-center font-sans"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Could not load tool calls</p>
              <p className="mt-1 text-xs text-muted-foreground">The read-only audit log was not changed.</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchPage(page, nameFilter || undefined)}
              className="oa-pressable rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Retry
            </button>
          </div>
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

// ==================== Agent Conversation Log ====================

const CONVERSATION_PAGE_SIZE = 50

function sourceLabel(source: AgentConversationRecord['source']): string {
  if (source.kind === 'human') return 'Human'
  if (source.kind === 'workspace') return source.workspaceId
  return `${source.workspaceId} · ${source.agent}`
}

function targetLabel(target: AgentConversationRecord['target']): string {
  return `${target.workspaceId} · ${target.agent}`
}

function requestedTargetLabel(target: AgentConversationRecord['requestedTarget']): string {
  switch (target.kind) {
    case 'resume':
      return `Session ${target.resumeId}`
    case 'workspace':
      return `Workspace ${target.workspaceId}`
    case 'harness':
      return `Harness ${target.harness}`
    case 'inbox':
      return `Inbox ${target.inboxEntryId}`
    case 'issue':
      return `Issue ${target.workspaceId}/${target.issueId}`
    case 'report':
      return `Report ${target.workspaceId}/${target.path}`
    case 'trade-decision':
      return `Trade decision ${target.accountId}/${target.decisionId}`
  }
}

function ConversationLogSection() {
  const [entries, setEntries] = useState<AgentConversationRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchPage = useCallback(async (nextPage: number) => {
    setLoading(true)
    try {
      const result = await api.agentConversations.query({
        page: nextPage,
        pageSize: CONVERSATION_PAGE_SIZE,
      })
      setEntries(result.entries)
      setPage(result.page)
      setTotalPages(result.totalPages)
      setTotal(result.total)
      setFailed(false)
    } catch (error) {
      console.warn('Failed to load Agent conversations:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchPage(1) }, [fetchPage])

  useEffect(() => {
    if (paused || page !== 1) return
    const interval = setInterval(() => { void fetchPage(1) }, 3000)
    return () => clearInterval(interval)
  }, [paused, page, fetchPage])

  const goToPage = useCallback((nextPage: number) => {
    void fetchPage(nextPage)
    containerRef.current?.scrollTo?.(0, 0)
  }, [fetchPage])

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          className={`oa-pressable text-xs px-3 py-1.5 rounded-md border transition-colors ${
            paused
              ? 'border-warning-border text-warning hover:bg-warning-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {paused ? 'Resume live updates' : 'Pause live updates'}
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          {total > 0 ? `Page ${page} of ${totalPages} · ${total} conversations` : '0 conversations'}
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-background rounded-lg border border-border overflow-auto"
      >
        {loading && entries.length === 0 ? (
          <LogRowsSkeleton />
        ) : failed && entries.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">Could not load Agent conversations</p>
              <p className="mt-1 text-xs text-muted-foreground">The private log was not changed.</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchPage(page)}
              className="oa-pressable rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            title="No Agent conversations yet"
            description="Messages dispatched between Workspaces will appear here."
          />
        ) : (
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr className="text-left text-muted-foreground">
                <th className="w-32 px-3 py-2">Time</th>
                <th className="w-40 px-3 py-2">From</th>
                <th className="w-40 px-3 py-2">To</th>
                <th className="w-32 px-3 py-2">Resolution</th>
                <th className="w-20 px-3 py-2">Status</th>
                <th className="px-3 py-2">Prompt</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((record) => (
                <ConversationRow key={record.taskId} record={record} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {failed && entries.length > 0 && (
        <div className="text-xs text-warning" role="status">
          Refresh failed; showing the last successful page.
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1 || loading}
            className="oa-icon-action rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            Previous
          </button>
          <span className="px-2 text-xs text-muted-foreground">{page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages || loading}
            className="oa-icon-action rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function ConversationRow({ record }: { record: AgentConversationRecord }) {
  const [expanded, setExpanded] = useState(false)
  const preview = record.prompt.original.replace(/\s+/g, ' ').trim()
  const promptChanged = record.prompt.original !== record.prompt.delivered

  return (
    <>
      <tr className="border-t border-border/50 align-top hover:bg-muted/30">
        <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
          {formatDateTime(record.dispatchedAt)}
        </td>
        <td className="px-3 py-2">
          <div className="font-medium text-foreground">{sourceLabel(record.source)}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{record.source.kind}</div>
        </td>
        <td className="px-3 py-2">
          <div className="font-medium text-foreground">{targetLabel(record.target)}</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{record.target.resumeId}</div>
        </td>
        <td className="px-3 py-2">
          <div className="text-foreground">
            {record.resolution.mode === 'exact' ? 'Exact session' : 'Reconstructed provenance'}
          </div>
          {record.prompt.mode === 'reconstruction' && (
            <div className="mt-1 inline-flex rounded-full border border-warning-border bg-warning-background px-1.5 py-0.5 text-[10px] text-warning">
              Guidance injected
            </div>
          )}
        </td>
        <td className={`px-3 py-2 font-medium ${conversationStatusColor(record.status)}`}>
          {record.status}
          {record.durationMs !== undefined && (
            <div className="mt-0.5 font-normal text-[10px] text-muted-foreground">
              {formatDuration(record.durationMs)}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="oa-nav-row flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="min-w-0 flex-1 line-clamp-2">{preview}</span>
            <span className="shrink-0 text-primary" aria-hidden>{expanded ? '▾' : '▸'}</span>
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30 bg-muted/10">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ConversationTextPanel title="Original prompt" text={record.prompt.original} />
              {promptChanged ? (
                <ConversationTextPanel
                  title="Delivered prompt · reconstruction guidance applied"
                  text={record.prompt.delivered}
                  tone="warning"
                />
              ) : (
                <ConversationTextPanel
                  title={record.status === 'running' ? 'Agent reply · running' : 'Agent reply'}
                  text={record.assistantText ?? record.error ?? 'No reply recorded.'}
                  tone={record.error ? 'error' : 'default'}
                />
              )}
              {promptChanged && (
                <ConversationTextPanel
                  title={record.status === 'running' ? 'Agent reply · running' : 'Agent reply'}
                  text={record.assistantText ?? record.error ?? 'No reply recorded.'}
                  tone={record.error ? 'error' : 'default'}
                />
              )}
              <div className="rounded-lg border border-border/70 bg-background p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Routing
                </div>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-[11px]">
                  <dt className="text-muted-foreground">Requested</dt>
                  <dd className="break-all text-foreground">{requestedTargetLabel(record.requestedTarget)}</dd>
                  <dt className="text-muted-foreground">Task</dt>
                  <dd className="break-all text-foreground">{record.taskId}</dd>
                  <dt className="text-muted-foreground">Resume</dt>
                  <dd className="break-all text-foreground">{record.target.resumeId}</dd>
                  {record.parentTaskId && (
                    <>
                      <dt className="text-muted-foreground">Parent</dt>
                      <dd className="break-all text-foreground">{record.parentTaskId}</dd>
                    </>
                  )}
                  {record.resolution.reason && (
                    <>
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd className="break-all text-foreground">{record.resolution.reason}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ConversationTextPanel({
  title,
  text,
  tone = 'default',
}: {
  title: string
  text: string
  tone?: 'default' | 'warning' | 'error'
}) {
  const toneClass = tone === 'warning'
    ? 'border-warning-border bg-warning-background/30'
    : tone === 'error'
      ? 'border-destructive/30 bg-destructive/5'
      : 'border-border/70 bg-background'
  return (
    <section className={`min-w-0 rounded-lg border p-3 ${toneClass}`}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </section>
  )
}

export function LogsPage() {
  const [view, setView] = useState<'tool-calls' | 'agent-conversations'>('agent-conversations')

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 px-4 md:px-6 py-5">
      <SegmentedControl
        value={view}
        onChange={setView}
        ariaLabel="Log type"
        options={[
          { value: 'agent-conversations', label: 'Agent conversations' },
          { value: 'tool-calls', label: 'Tool calls' },
        ]}
      />
      {view === 'agent-conversations' ? <ConversationLogSection /> : <ToolCallLogSection />}
    </div>
  )
}
