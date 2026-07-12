import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Bot, LoaderCircle, MessageSquareText, Send } from 'lucide-react'

import type { InquiryRecord } from '../api/inquiries'
import { formatRelativeTime } from '../lib/intl'
import { MarkdownContent } from './MarkdownContent'

function relationLabel(record: InquiryRecord): string {
  const subject = record.inquiry.subject
  if (record.inquiry.resolution.mode === 'reconstructed') return 'workspace'
  if (subject.kind === 'inbox') {
    return 'sender'
  }
  if (subject.relation === 'creator') return 'creator'
  if (subject.relation === 'owner') return 'owner'
  return 'run'
}

function InquiryCard({ record }: { record: InquiryRecord }) {
  const running = record.status === 'running'
  const failed = record.status === 'failed' || record.status === 'interrupted'
  return (
    <article className="rounded-lg border border-border bg-bg-secondary px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        {running
          ? <LoaderCircle size={13} className="animate-spin text-accent" aria-hidden />
          : <Bot size={13} className={failed ? 'text-red-400' : 'text-emerald-400'} aria-hidden />}
        <span className="font-medium text-text/80">{record.agent} · {relationLabel(record)}</span>
        <span className={`rounded-full px-1.5 py-0.5 ${
          record.inquiry.resolution.mode === 'reconstructed'
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-bg-tertiary text-muted'
        }`}>
          {record.inquiry.resolution.mode}
        </span>
        <span className="ml-auto" title={new Date(record.startedAt).toLocaleString()}>
          {formatRelativeTime(record.startedAt)}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        <span className="text-text/70">You asked:</span> {record.inquiry.question}
      </p>
      {running ? (
        <p className="mt-3 text-[12px] text-muted">Waiting for the agent’s final reply…</p>
      ) : record.assistantText ? (
        <div className="mt-3 max-h-[420px] overflow-y-auto border-t border-border/60 pt-3 text-[13px]">
          <MarkdownContent text={record.assistantText} strikethrough={false} />
        </div>
      ) : (
        <p className={`mt-3 text-[12px] ${failed ? 'text-red-400' : 'text-muted'}`}>
          {record.error || 'The run finished without a final reply.'}
        </p>
      )}
    </article>
  )
}

export function InquiryPanel({
  title,
  description,
  actionLabel,
  placeholder,
  controls,
  load,
  ask,
}: {
  title: string
  description: string
  actionLabel: string
  placeholder: string
  controls?: ReactNode
  load: () => Promise<InquiryRecord[]>
  ask: (prompt: string) => Promise<unknown>
}) {
  const [records, setRecords] = useState<InquiryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await load()
      setRecords(next)
      setError(null)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return []
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    let live = true
    setLoading(true)
    void load().then((next) => {
      if (live) {
        setRecords(next)
        setError(null)
      }
    }).catch((err) => {
      if (live) setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (live) setLoading(false)
    })
    return () => { live = false }
  }, [load])

  useEffect(() => {
    if (!records.some((record) => record.status === 'running')) return
    const timer = window.setInterval(() => { void refresh() }, 1500)
    return () => window.clearInterval(timer)
  }, [records, refresh])

  const submit = async () => {
    const question = prompt.trim()
    if (!question || sending) return
    setSending(true)
    setError(null)
    try {
      await ask(question)
      setPrompt('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <section id="inquiries" className="mt-8 rounded-xl border border-border bg-bg-tertiary/20 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
            <MessageSquareText size={15} className="text-accent" aria-hidden />
            {title}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p>
        </div>
        {controls}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          rows={2}
          value={prompt}
          disabled={sending}
          placeholder={placeholder}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
          className="min-h-[68px] min-w-0 flex-1 resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-accent/60 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || prompt.trim().length === 0}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}
          {sending ? 'Dispatching…' : actionLabel}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}

      {loading && records.length === 0 ? (
        <p className="mt-4 text-[12px] text-muted">Loading previous questions…</p>
      ) : records.length > 0 ? (
        <div className="mt-4 space-y-2">
          {records.map((record) => <InquiryCard key={record.taskId} record={record} />)}
        </div>
      ) : null}
    </section>
  )
}
