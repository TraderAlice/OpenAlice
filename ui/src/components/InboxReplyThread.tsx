import { Bot, LoaderCircle, Send, UserRound } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { InquiryRecord } from '../api/inquiries'
import { useInquiryThread } from '../hooks/useInquiryThread'
import { formatRelativeTime } from '../lib/intl'
import { ContextHelp } from './ContextHelp'
import { CountBadge } from './CountBadge'
import { Button } from './ui/button'
import { MarkdownContent } from './MarkdownContent'
import { hasTurnProgress, TurnProgress } from './TurnProgress'

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
    <section id="inquiries" className="mt-10 border-t border-border/60 pt-7">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">{t('inbox.repliesTitle')}</h2>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{sender}</span>
        {records.length > 0 && <CountBadge count={records.length} label={`${records.length} ${t('inbox.repliesTitle')}`} />}
        <ContextHelp label={t('inbox.repliesTitle')}>{[
          hasExactSender ? t('inbox.repliesDescription', { sender }) : t('inbox.repliesWorkspaceDescription', { workspace: sender }),
          hasExactSender ? t('inbox.replyDeliveryHint') : t('inbox.replyWorkspaceHint'),
        ].join(' ')}</ContextHelp>
      </div>

      {thread.loading && records.length === 0 ? (
        <div className="mt-5 flex items-center gap-2 text-sm leading-5 text-muted-foreground">
          <LoaderCircle size={13} className="animate-spin" aria-hidden />
          {t('inbox.repliesLoading')}
        </div>
      ) : records.length > 0 ? (
        <div className="mt-5 space-y-5">
          {records.map((record) => <InboxReplyRecord key={record.taskId} record={record} />)}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-input bg-background transition-[border-color,box-shadow] duration-[var(--motion-fast)] focus-within:border-foreground focus-within:[box-shadow:var(--oa-focus-shadow)] motion-reduce:transition-none">
        <textarea
          rows={2}
          value={thread.prompt}
          disabled={thread.sending}
          aria-label={t('inbox.replyPlaceholder')}
          placeholder={t('inbox.replyPlaceholder')}
          onChange={(event) => thread.setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void thread.submit()
            }
          }}
          className="min-h-[88px] w-full resize-y bg-transparent px-4 pb-2 pt-4 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50 sm:min-h-[84px] sm:px-4"
        />
        <div className="flex min-h-11 items-center gap-3 border-t border-border/55 bg-secondary/25 px-2.5 py-1.5 sm:px-3">
          <Button
            type="button"
            onClick={() => void thread.submit()}
            disabled={thread.sending || thread.prompt.trim().length === 0}
            className="ml-auto"
            aria-label={thread.sending ? t('inbox.replySending') : t('inbox.replyAction')}
          >
            {thread.sending
              ? <LoaderCircle size={13} className="animate-spin" aria-hidden />
              : <Send size={13} aria-hidden />}
            <span className="hidden sm:inline">
              {thread.sending ? t('inbox.replySending') : t('inbox.replyAction')}
            </span>
          </Button>
        </div>
      </div>
      {thread.error && <p className="mt-2 text-sm text-destructive">{thread.error}</p>}
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
      <span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground sm:h-6 sm:w-6">
        <UserRound size={12} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">{t('inbox.replyYou')}</span>
        <span className="text-sm leading-5 tabular-nums text-muted-foreground" title={new Date(record.startedAt).toLocaleString()}>
          {formatRelativeTime(record.startedAt)}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-foreground/85">
        {record.inquiry.question}
      </p>

      <div className="relative mt-3 border-l border-border/70 pl-4">
        <span className="absolute -left-[10px] top-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          {running
            ? <LoaderCircle size={11} className="animate-spin text-primary" aria-hidden />
            : <Bot size={11} className={failed ? 'text-destructive' : 'text-primary'} aria-hidden />}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-sm leading-5">
          <span className="font-medium text-foreground/80">
            {running
              ? t('inbox.replyAgentWorking', { agent: record.agent })
              : t('inbox.replyAgent', { agent: record.agent })}
          </span>
          {reconstructed && (
            <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-sm leading-5 font-medium text-warning">
              {t('inbox.replyReconstructed')}
            </span>
          )}
        </div>
        {running && hasTurnProgress(record.progress) ? (
          <TurnProgress progress={record.progress} />
        ) : running ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{t('inbox.replyWaiting')}</p>
        ) : record.assistantText ? (
          <div className="mt-2 text-base leading-relaxed text-foreground/85">
            <MarkdownContent text={record.assistantText} strikethrough={false} />
          </div>
        ) : (
          <p className={`mt-1.5 text-sm ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
            {record.error || (failed ? t('inbox.replyFailed') : t('inbox.replyNoAnswer'))}
          </p>
        )}
      </div>
    </article>
  )
}
