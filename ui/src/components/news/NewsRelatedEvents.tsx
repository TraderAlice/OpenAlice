import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { newsStoryRelation } from '../../../../src/domain/news/relations'
import { api } from '../../api'
import type { NewsStoryPreview } from '../../api/types'
import { Button } from '../ui/button'

export function NewsRelatedEvents({ story, onOpen }: { story: NewsStoryPreview; onOpen: (story: NewsStoryPreview) => void }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<NewsStoryPreview[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setItems(null); setError(false)
    void api.news.getRelatedStories(story.id, controller.signal)
      .then(value => { if (!controller.signal.aborted) setItems(value) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [story.id, story.revision, attempt])
  const related = items?.flatMap(item => {
    const basis = newsStoryRelation(story, item)
    return item.id !== story.id && (basis.topics.length || basis.symbols.length) ? [{ item, basis }] : []
  })
  return <section aria-label={t('news.relatedEvents')} className="mb-4 space-y-2">
    <h4 className="text-xs font-medium text-muted-foreground">{t('news.relatedEvents')}</h4>
    {error ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><p role="status">{t('news.relatedEventsError')}</p><Button size="xs" variant="ghost" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</Button></div>
      : !related ? <p role="status" className="text-xs text-muted-foreground">{t('common.loading')}</p>
        : !related.length ? <p className="text-xs text-muted-foreground">{t('news.noRelatedEvents')}</p>
          : <ul className="divide-y divide-border/60">{related.map(({ item, basis }) => <li key={item.id}>
            <button type="button" aria-label={t('news.openRelatedEvent', { title: item.title })} onClick={() => onOpen(item)} className="w-full rounded-sm py-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
              <span className="block text-sm leading-6">{item.title}</span>
              {basis.topics.length > 0 && <span className="block text-xs leading-5 text-muted-foreground">{t('news.sharedTopics')} · {basis.topics.join(' · ')}</span>}
              {basis.symbols.length > 0 && <span className="block text-xs leading-5 text-muted-foreground">{t('news.sharedCodes')} · {basis.symbols.join(' · ')}</span>}
            </button>
          </li>)}</ul>}
  </section>
}
