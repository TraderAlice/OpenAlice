import { Bot, LoaderCircle, Send, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { InquiryRecord } from '../api/inquiries'
import { useInquiryThread } from '../hooks/useInquiryThread'
import { formatRelativeTime } from '../lib/intl'
import { MarkdownContent } from './MarkdownContent'

export function InboxReplyThread({
  sender,
  hasExactSender,
  load,
  ask,
}: {
  sender: string
  hasExactSender: boolean
  load: () => Promise<InquiryRecord[]>
  ask: (prompt: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const thread = useInquiryThread({ load, ask })
  // The registry API is newest-first; a reply thread reads chronologically.
  const records = useMemo(() => [...thread.records].reverse(), [thread.records])

  return (
    <section id="inquiries" className="mt-8 border-t border-border/70 pt-6">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{t('inbox.repliesTitle')}</h3>
        {records.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground/45">{records.length}</span>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/65">
        {hasExactSender
          ? t('inbox.repliesDescription', { sender })
          : t('inbox.repliesWorkspaceDescription', { workspace: sender })}
      </p>

      {thread.loading && records.length === 0 ? (
        <div className="mt-5 flex items-center gap-2 text-[12px] text-muted-foreground/60">
          <LoaderCircle size={13} className="animate-spin" aria-hidden />
          {t('inbox.repliesLoading')}
        </div>
      ) : records.length > 0 ? (
        <div className="mt-5 space-y-5">
          {records.map((record) => <InboxReplyRecord key={record.taskId} record={record} />)}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-background transition-colors focus-within:border-primary/55 focus-within:ring-2 focus-within:ring-primary/10">
        <textarea
          rows={2}
          value={thread.prompt}
          disabled={thread.sending}
          aria-label={t('inbox.replyPlaceholder')}
          placeholder={t('inbox.replyPlaceholder')}
          onChange={(event) => thread.setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void thread.submit()
            }
          }}
          className="min-h-[76px] w-full resize-y bg-transparent px-3.5 pb-2 pt-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/45 disabled:opacity-50 sm:min-h-[84px] sm:px-4"
        />
        <div className="flex min-h-11 items-center gap-3 border-t border-border/55 bg-secondary/25 px-2.5 py-1.5 sm:px-3">
          <span className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground/50 sm:text-[11px]">
            {hasExactSender ? t('inbox.replyDeliveryHint') : t('inbox.replyWorkspaceHint')}
          </span>
          <button
            type="button"
            onClick={() => void thread.submit()}
            disabled={thread.sending || thread.prompt.trim().length === 0}
            className="oa-pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-35 sm:px-3"
            aria-label={thread.sending ? t('inbox.replySending') : t('inbox.replyAction')}
          >
            {thread.sending
              ? <LoaderCircle size={13} className="animate-spin" aria-hidden />
              : <Send size={13} aria-hidden />}
            <span className="hidden sm:inline">
              {thread.sending ? t('inbox.replySending') : t('inbox.replyAction')}
            </span>
          </button>
        </div>
      </div>
      {thread.error && <p className="mt-2 text-[12px] text-destructive">{thread.error}</p>}
    </section>
  )
}

function InboxReplyRecord({ record }: { record: InquiryRecord }) {
  const { t } = useTranslation()
  const running = record.status === 'running'
  const failed = record.status === 'failed' || record.status === 'interrupted'
  const reconstructed = record.inquiry.resolution.mode === 'reconstructed'

  return (
    <article className="relative pl-7 sm:pl-8">
      <span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground/70 sm:h-6 sm:w-6">
        <UserRound size={12} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[12px] font-medium text-foreground">{t('inbox.replyYou')}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground/45" title={new Date(record.startedAt).toLocaleString()}>
          {formatRelativeTime(record.startedAt)}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
        {record.inquiry.question}
      </p>

      <div className="relative mt-3 border-l border-border/70 pl-4">
        <span className="absolute -left-[10px] top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground/70">
          {running
            ? <LoaderCircle size={11} className="animate-spin text-primary" aria-hidden />
            : <Bot size={11} className={failed ? 'text-destructive' : 'text-primary'} aria-hidden />}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-medium text-foreground/80">
            {running
              ? t('inbox.replyAgentWorking', { agent: record.agent })
              : t('inbox.replyAgent', { agent: record.agent })}
          </span>
          {reconstructed && (
            <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning">
              {t('inbox.replyReconstructed')}
            </span>
          )}
        </div>
        {running ? (
          <p className="mt-1.5 text-[12px] text-muted-foreground/60">{t('inbox.replyWaiting')}</p>
        ) : record.assistantText ? (
          <div className="mt-2 text-[13px] leading-relaxed text-foreground/85">
            <MarkdownContent text={record.assistantText} strikethrough={false} />
          </div>
        ) : (
          <p className={`mt-1.5 text-[12px] ${failed ? 'text-destructive' : 'text-muted-foreground/60'}`}>
            {record.error || (failed ? t('inbox.replyFailed') : t('inbox.replyNoAnswer'))}
          </p>
        )}
      </div>
    </article>
  )
}
