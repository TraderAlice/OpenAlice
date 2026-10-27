import type { NewsStoryPreview } from '../../api/types'
import { useTranslation } from 'react-i18next'

export function NewsEventTimeline({ developments, locale, onEvidence }: { developments: NewsStoryPreview['developments']; locale: string; onEvidence: (ids: number[]) => void }) {
  const { t } = useTranslation()
  const ordered = [...developments].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const visible = ordered.length > 3 ? [ordered[0], ...ordered.slice(-2)] : ordered
  const formatTime = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <section aria-label={t('news.widgets.timeline')} className="mt-3">
    <h4 className="text-xs text-muted-foreground">{t('news.widgets.timeline')} · {ordered.length}</h4>
    <ol className="mt-2 flex flex-wrap gap-2">{visible.map(development => <li key={development.id} className="min-w-0 flex-1 basis-32 border-l border-border pl-2" aria-current={development === ordered.at(-1) ? 'step' : undefined}>
      <button type="button" aria-label={t('news.widgets.timelineEvidence', { title: development.title })} onClick={() => onEvidence(development.reportIds)} className="w-full rounded-sm text-left text-xs leading-5 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
        <time dateTime={development.time} className="block tabular-nums text-muted-foreground">{formatTime.format(new Date(development.time))}</time>
        <span className="line-clamp-2">{development.title}</span>
      </button>
    </li>)}</ol>
    {ordered.length > visible.length && <p className="mt-1 text-[11px] text-muted-foreground">{t('news.widgets.timelineMore', { count: ordered.length - visible.length })}</p>}
  </section>
}
