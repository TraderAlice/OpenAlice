import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { NewsQuery } from '../../api/news'
import { useNewsFeed } from '../../hooks/useNewsFeed'
import { Button } from '../ui/button'

export function NewsImportantEvents({ query, autoRefresh, revision, onOpen, onViewAll }: {
  query: NewsQuery; autoRefresh: boolean; revision: number; onOpen: (id: string) => void; onViewAll: () => void
}) {
  const { t } = useTranslation()
  const { stories, loading, loadError, storyError, retry } = useNewsFeed({ ...query, includeStories: true, important: true, storyOffset: 0, storyOrder: query.keyword ? 'relevance' : 'recent', limit: 1 }, autoRefresh)
  const seen = useRef(revision)
  useEffect(() => { if (seen.current !== revision) { seen.current = revision; retry() } }, [revision, retry])
  const failed = loadError || storyError
  const important = stories.filter(story => story.reading?.important === true)
  return <section aria-label={t('news.importantEvents')} className="shrink-0 border-b border-border px-4 py-3">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium">{t('news.importantEvents')}</h3>
      <Button variant="ghost" size="xs" onClick={onViewAll}>{t('news.viewAllImportant')}</Button>
    </div>
    {failed && <div role="status" className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{t('news.importantLoadError')}<Button size="xs" variant="outline" aria-label={t('news.retryImportant')} onClick={retry}>{t('common.retry')}</Button></div>}
    {loading && !important.length ? <p role="status" className="text-xs text-muted-foreground">{t('common.loading')}</p>
      : important.length ? <div className="grid gap-x-6 gap-y-2 md:grid-cols-3">
        {important.slice(0, 3).map((story, index) => <button type="button" key={story.id} onClick={() => onOpen(story.id)} className="flex min-w-0 items-start gap-2 rounded-sm text-left text-xs leading-5 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
          <span aria-hidden className="pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{story.title}</span>
        </button>)}
      </div> : !failed && <p className="text-xs text-muted-foreground">{t('news.noImportantEvents')} <span>{t('news.markImportantHint')}</span></p>}
  </section>
}
