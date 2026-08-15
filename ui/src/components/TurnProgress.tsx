import { LoaderCircle, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { HeadlessProgressBlock, HeadlessTurnProgress } from '../api/headless'
import { MarkdownContent } from './MarkdownContent'

export function hasTurnProgress(
  progress: HeadlessTurnProgress | null | undefined,
): progress is HeadlessTurnProgress {
  return Boolean(progress && progress.blocks.length > 0)
}

function blockKey(block: HeadlessProgressBlock, index: number): string {
  if (block.type === 'tool') return `tool:${block.id}`
  if (block.type === 'error') return `error:${index}`
  return `text:${index}`
}

/**
 * Compact live timeline for one headless turn.
 *
 * Renders the comment-transport progress shape already on Issue deliveries and
 * Inbox inquiries. Tool input/output are not in that shape and must not be
 * fetched here.
 */
export function TurnProgress({ progress }: { progress: HeadlessTurnProgress }) {
  const { t } = useTranslation()
  if (!hasTurnProgress(progress)) return null

  return (
    <ol
      className="mt-2 space-y-2"
      aria-label={t('turnProgress.liveLabel')}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {progress.blocks.map((block, index) => (
        <li key={blockKey(block, index)}>
          {block.type === 'text' ? (
            <div className="text-[13px] leading-relaxed text-foreground/85">
              <MarkdownContent text={block.text} strikethrough={false} />
            </div>
          ) : block.type === 'tool' ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {block.status === 'running'
                ? <LoaderCircle size={11} className="shrink-0 animate-spin text-primary" aria-hidden />
                : <Wrench size={11} className={`shrink-0 ${block.status === 'failed' ? 'text-destructive' : ''}`} aria-hidden />}
              <span className="min-w-0 truncate font-mono text-foreground/80">{block.name}</span>
              <span className={block.status === 'failed' ? 'text-destructive' : 'text-muted-foreground/70'}>
                {t(`turnProgress.status.${block.status}`)}
              </span>
            </div>
          ) : (
            <p className="text-[12px] leading-snug text-warning">{block.message}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
