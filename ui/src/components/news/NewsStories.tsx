import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Bell, Bookmark, Flag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { NewsReadProgress, NewsReaderPatch, NewsReaderState, NewsStoryDetail, NewsStoryPreview } from '../../api/types'
import { Button } from '../ui/button'
import { EmptyState } from '../StateViews'
import { NewsEventTimeline } from './NewsEventTimeline'
import { NewsSourceComparison } from './NewsSourceComparison'
import { NewsAssociations } from './NewsAssociations'
import { NewsRelatedAssets } from './NewsRelatedAssets'
import { NewsRelatedEvents } from './NewsRelatedEvents'

const statusLabels = { active: 'news.eventActive', watching: 'news.eventWatching', settled: 'news.eventSettled' } as const
const roleLabels = { official: 'news.officialReport', reporting: 'news.reportingReport', discussion: 'news.discussionReport' } as const

export function NewsStories({ stories, locale, bookmarkedOnly = false, importantOnly = false, preserveOpened = false, initiallyOpenedId, onInitialOpen, onImportantChange, sourceNames = {}, onTopic, rankOffset }: {
  stories: NewsStoryPreview[]; locale: string; bookmarkedOnly?: boolean
  importantOnly?: boolean; preserveOpened?: boolean; initiallyOpenedId?: string | null; onInitialOpen?: () => void; onImportantChange?: () => void
  sourceNames?: Record<string, string>; onTopic?: (topic: string) => void; rankOffset?: number
}) {
  const { t } = useTranslation()
  const [openedId, setOpenedId] = useState<string | null>(initiallyOpenedId ?? null)
  const [openedSnapshot, setOpenedSnapshot] = useState<NewsStoryPreview | null>(null)
  const [detail, setDetail] = useState<NewsStoryDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saved, setSaved] = useState<Record<string, NewsReaderState>>({})
  const [readBaseline, setReadBaseline] = useState<NewsReadProgress | null>(null)
  const [relatedStory, setRelatedStory] = useState<NewsStoryPreview | null>(null)
  const originalOpenedId = useRef<string | null>(null)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState(false)
  const [evidenceRequest, setEvidenceRequest] = useState<{ id: string; revision: number; ids: number[] } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const initialOpen = useRef(initiallyOpenedId)
  const detailsId = useId()
  const progressFor = (story: NewsStoryPreview) => saved[story.id]?.readProgress === undefined ? story.reading?.readProgress : saved[story.id].readProgress
  // An automatic read mark must not close the article during the next filtered poll.
  const retained = preserveOpened && openedSnapshot?.id === openedId && !stories.some(story => story.id === openedId) ? openedSnapshot : null
  const visible = relatedStory ? [relatedStory] : (retained ? [...stories, retained] : stories).filter(story => (!bookmarkedOnly || (saved[story.id]?.bookmarked ?? story.reading?.bookmarked ?? true)) && (!importantOnly || (saved[story.id]?.important ?? story.reading?.important ?? false)))
  const opened = visible.find(story => story.id === openedId)
  useEffect(() => { if (opened) setOpenedSnapshot(opened) }, [opened])
  // Keep the pre-open snapshot while the same event stays open.
  useEffect(() => { if (opened) setReadBaseline(progressFor(opened) ?? null) }, [opened?.id])
  useEffect(() => {
    if (!initialOpen.current) return
    onInitialOpen?.()
    const frame = requestAnimationFrame(() => {
      const heading = listRef.current?.querySelector('h3 button[aria-expanded="true"]')?.parentElement
      heading?.focus(); heading?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [onInitialOpen])
  const changeReader = async (story: NewsStoryPreview, patch: NewsReaderPatch) => {
    setSaveError(false)
    setSaving(current => ({ ...current, [story.id]: true }))
    try {
      const result = await api.news.setReader(story.id, patch)
      setSaved(current => ({ ...current, [story.id]: { ...current[story.id], ...result } }))
      if (bookmarkedOnly && patch.bookmarked === false) requestAnimationFrame(() => listRef.current?.focus())
      if (importantOnly && patch.important === false) requestAnimationFrame(() => listRef.current?.focus())
      if (patch.important !== undefined) onImportantChange?.()
    } catch { setSaveError(true) }
    finally { setSaving(current => ({ ...current, [story.id]: false })) }
  }
  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    setDetail(null)
    setDetailError(false)
    void api.news.getStory(opened.id, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setDetail(value)
      if (value.revision === opened.revision && progressFor(opened)?.revision !== opened.revision) void changeReader(opened, { readRevision: opened.revision })
    })
      .catch(() => { if (!controller.signal.aborted) setDetailError(true) })
    return () => controller.abort()
  }, [opened?.id, opened?.revision, opened?.associations?.current?.revision, opened?.associations?.status, attempt])
  const time = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  const toggleStory = (story: NewsStoryPreview) => {
    if (openedId === story.id && retained?.id === story.id) requestAnimationFrame(() => listRef.current?.focus())
    setDetail(null); setEvidenceRequest(null); setOpenedId(current => current === story.id ? null : story.id)
  }
  const openEvidence = (story: NewsStoryPreview, ids: number[]) => {
    if (openedId !== story.id) setDetail(null)
    setOpenedId(story.id)
    setEvidenceRequest({ id: story.id, revision: story.revision, ids: [...ids] })
  }
  return <>
    {relatedStory && <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground"><span>{t('news.relatedReading')}</span><Button size="xs" variant="ghost" onClick={() => {
      const original = stories.find(story => story.id === originalOpenedId.current)
      setRelatedStory(null); setDetail(null); setEvidenceRequest(null); setOpenedId(original?.id ?? null)
      requestAnimationFrame(() => listRef.current?.focus())
    }}>{t('news.backToList')}</Button></div>}
    {saveError && !opened && <p role="alert" className="px-4 py-2 text-sm text-destructive">{t('news.readerSaveError')}</p>}
    <div ref={listRef} tabIndex={-1} role="list" aria-label={t(relatedStory ? 'news.relatedReading' : bookmarkedOnly ? 'news.viewBookmarks' : 'news.viewEvents')} className="mx-auto max-w-4xl px-4 focus-visible:outline-2 focus-visible:outline-ring sm:px-6">
      {!visible.length && <EmptyState title={t(importantOnly ? 'news.noImportantEvents' : bookmarkedOnly ? 'news.noBookmarks' : 'news.noEvents')} description={t(importantOnly ? 'news.markImportantHint' : bookmarkedOnly ? 'news.noBookmarksDescription' : 'news.noEventsDescription')} />}
      {visible.map((story, index) => {
        const latest = [...story.developments].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0]
        const sources = new Map<string, string>()
        for (const report of story.reports) {
          const source = report.source?.trim()
          if (source) sources.set(source.toLowerCase(), source)
        }
        const bookmarked = saved[story.id]?.bookmarked ?? story.reading?.bookmarked ?? false
        const important = saved[story.id]?.important ?? story.reading?.important ?? false
        const progress = progressFor(story)
        const newCount = progress ? story.developments.filter(value => !progress.developmentIds.includes(value.id)).length : 0
        const expanded = opened?.id === story.id
        const contentId = `${detailsId}-${story.id}`
        return <article key={story.id} role="listitem" className="border-b border-border/60 py-3 [overflow-wrap:anywhere]">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            {!relatedStory && retained?.id !== story.id && rankOffset !== undefined && <span aria-label={t('news.coverageRank', { rank: rankOffset + index + 1 })} className="pt-1 font-mono text-sm tabular-nums text-muted-foreground">{String(rankOffset + index + 1).padStart(2, '0')}</span>}
            <h3 id={`${contentId}-title`} tabIndex={-1} className="min-w-0 flex-1 basis-72 text-base font-semibold leading-7"><button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleStory(story)} className="min-h-6 min-w-6 rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring">{story.title}</button></h3>
            <time dateTime={latest.time} className="pt-1 text-xs leading-5 tabular-nums text-muted-foreground">{time(latest.time)}</time>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {important && <span className="font-medium text-warning">{t('news.importantEvent')}</span>}
            <span className={progress?.revision === story.revision ? '' : 'font-medium text-foreground'}>{!progress ? t(story.reading?.isNew ? 'news.newEvent' : 'news.unread') : progress.revision >= story.revision ? t('news.read') : newCount ? t('news.newDevelopments', { count: newCount }) : t('news.contentUpdated')}</span>
            <span>{t(statusLabels[story.status])}</span>
            {story.topics.map(topic => onTopic ? <button type="button" key={topic} aria-label={t('news.showTopic', { topic })} onClick={() => onTopic(topic)} className="min-h-6 rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">{topic === 'ai' ? 'AI' : topic}</button> : <span key={topic}>{topic === 'ai' ? 'AI' : topic}</span>)}
          </div>
          <section aria-label={t('news.latestDevelopment')} className="mt-1 line-clamp-2 text-sm leading-6">
            <h4 className="sr-only">{t('news.latestDevelopment')}</h4>
            {story.developments.length > 1 && latest.title !== story.title && <p className="font-medium">{latest.title}</p>}
            <p className="whitespace-pre-wrap">{latest.summary}</p>
          </section>
          <div role="group" aria-label={t('news.eventEvidence')} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Button size="xs" variant="link" className="h-auto px-0 py-0" onClick={() => openEvidence(story, story.reports.map(report => report.id))}>{t('news.reportCount', { count: story.reports.length })}</Button>
            {story.reading?.publishers !== undefined && <span>{story.reading.publishers > 0 ? t('news.publisherCount', { count: story.reading.publishers }) : t('news.publishersUnknown')}</span>}
            {story.reading && story.reading.trend !== 'unknown' && <span>{t(`news.trend.${story.reading.trend}`)}</span>}
            <Button variant="ghost" size="xs" aria-label={t((saved[story.id]?.following ?? story.reading?.following) ? 'news.unfollowEvent' : 'news.followEvent', { title: story.title })} aria-pressed={saved[story.id]?.following ?? story.reading?.following ?? false} disabled={saving[story.id]} onClick={() => void changeReader(story, { following: !(saved[story.id]?.following ?? story.reading?.following) })}>
              <Bell className="size-3.5" fill={(saved[story.id]?.following ?? story.reading?.following) ? 'currentColor' : 'none'} aria-hidden />
            </Button>
            <Button variant="ghost" size="xs" aria-label={t(important ? 'news.clearImportant' : 'news.markImportant', { title: story.title })} aria-pressed={important} disabled={saving[story.id]} onClick={() => void changeReader(story, { important: !important })}>
              <Flag className="size-3.5" fill={important ? 'currentColor' : 'none'} aria-hidden />
            </Button>
            <Button variant="ghost" size="xs" aria-label={t(bookmarked ? 'news.removeBookmark' : 'news.saveBookmark', { title: story.title })} aria-pressed={bookmarked} disabled={saving[story.id]} onClick={() => void changeReader(story, { bookmarked: !bookmarked })}>
              <Bookmark className="size-3.5" fill={bookmarked ? 'currentColor' : 'none'} aria-hidden />
            </Button>
            <Button variant="ghost" size="xs" className="-ml-2 sm:ml-auto" aria-expanded={expanded} aria-controls={contentId} onClick={() => toggleStory(story)}>{t(expanded ? 'news.collapseEvent' : 'news.readEvent')}</Button>
          </div>
          <section id={contentId} role="region" aria-labelledby={`${contentId}-title`} hidden={!expanded} className="mt-4 border-t border-border pt-3">
            {expanded && <>
              {saveError && <p role="alert" className="mb-2 text-sm text-destructive">{t('news.readerSaveError')}</p>}
              <Button variant="ghost" size="xs" className="-ml-2 mb-3" aria-pressed={saved[story.id]?.locked ?? story.reading?.locked ?? false} disabled={saving[story.id]}
                onClick={() => void changeReader(story, { locked: !(saved[story.id]?.locked ?? story.reading?.locked ?? false) })}>{t((saved[story.id]?.locked ?? story.reading?.locked) ? 'news.eventLocked' : 'news.protectEvent')}</Button>
              <Button variant="ghost" size="xs" className="mb-3 ml-2" disabled={saving[story.id]} onClick={() => void changeReader(story, { readRevision: progress?.revision === story.revision ? null : story.revision })}>{t(progress?.revision === story.revision ? 'news.markUnread' : 'news.markRead')}</Button>
              {detail && detail.revision !== story.revision && <p role="status" className="mb-3 text-xs text-muted-foreground">{t('news.readRevisionChanged')}</p>}
              <section className="mb-4 space-y-2" aria-label={t('news.eventOverview')}>
                <h4 className="text-xs text-muted-foreground">{t('news.eventOverview')}</h4>
                <p className="whitespace-pre-wrap text-sm leading-6">{story.summary}</p>
                {sources.size > 0 && <div role="group" aria-label={t('news.reportingSources')} className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{[...sources].map(([key, source]) => <span key={key}>{sourceNames[key] ?? source}</span>)}</div>}
                <p className="text-xs text-muted-foreground">{t('news.eventCounts', { facts: story.developments.length, reports: story.reports.length, sources: sources.size })}</p>
                <p className="text-xs text-muted-foreground">{t(story.reports.some(report => report.role === 'official') ? 'news.containsOfficial' : 'news.noOfficial')}</p>
                {story.reading && <p className="text-xs text-muted-foreground">{t('news.eventHeat', { value: story.reading.heat.toFixed(1), count: story.reading.participants })} · {t(`news.trend.${story.reading.trend}`)}</p>}
              </section>
              <NewsEventTimeline developments={story.developments} locale={locale} onEvidence={ids => openEvidence(story, ids)} />
              {story.transmission ? <section aria-label={t('news.possibleTransmission')} className="mb-4 mt-3 border-l-2 border-border pl-3">
                <h4 className="text-xs text-muted-foreground">{t('news.possibleTransmission')}</h4>
                <ol className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6">{story.transmission.steps.map((step, stepIndex) => <li key={stepIndex} className="flex min-w-0 items-center gap-2">{stepIndex > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}<span>{step}</span></li>)}</ol>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{story.transmission.condition}</p>
                <Button size="xs" variant="link" className="px-0" onClick={() => openEvidence(story, story.transmission!.reportIds)}>{t('news.eventEvidence')} · {story.transmission.reportIds.length}</Button>
              </section> : <p className="mb-4 mt-2 text-xs text-muted-foreground">{t(story.transmission === null ? 'news.noTransmission' : 'news.transmissionPending')}</p>}
              {story.symbols.length > 0 && <p className="mb-2 text-xs leading-5 text-muted-foreground">{t('news.relatedSymbols')} · {story.symbols.join(' · ')}</p>}
              <NewsRelatedAssets symbols={story.symbols} />
              {detail && <NewsRelatedEvents story={detail} onOpen={next => {
                if (!relatedStory) originalOpenedId.current = story.id
                setRelatedStory(next); setDetail(null); setEvidenceRequest(null); setOpenedId(next.id)
                requestAnimationFrame(() => listRef.current?.querySelector('h3')?.focus())
              }} />}
              {detail ? <StoryDetails key={story.id} story={detail} time={time} previousRead={readBaseline} initialEvidence={evidenceRequest?.id === story.id && evidenceRequest.revision === story.revision ? evidenceRequest.ids : undefined} />
                : <div aria-busy={!detailError}><p role="status">{t(detailError ? 'news.storyLoadError' : 'common.loading')}</p>{detailError && <Button className="mt-3" variant="outline" onClick={() => setAttempt(value => value + 1)}>{t('common.retry')}</Button>}</div>}
            </>}
          </section>
          {story.id.startsWith('demo-') && <p className="mt-1 text-[11px] text-muted-foreground">{t('news.eventDemo')}</p>}
        </article>
      })}
    </div>
  </>
}

function StoryDetails({ story, time, initialEvidence, previousRead }: { story: NewsStoryDetail; time: (value: string) => string; initialEvidence?: number[]; previousRead: NewsReadProgress | null }) {
  const { t, i18n } = useTranslation()
  const [officialOnly, setOfficialOnly] = useState(false)
  const [oldestFirst, setOldestFirst] = useState(false)
  const [evidence, setEvidence] = useState<number[] | null>(null)
  const originalsRef = useRef<HTMLDetailsElement>(null)
  const evidenceHeadingRef = useRef<HTMLHeadingElement>(null)
  const developments = [...story.developments].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  const newDevelopments = previousRead ? developments.filter(value => !previousRead.developmentIds.includes(value.id)) : []
  const showEvidence = (ids: number[] | null) => {
    setOfficialOnly(false)
    setEvidence(ids)
    if (originalsRef.current) originalsRef.current.open = true
    requestAnimationFrame(() => evidenceHeadingRef.current?.focus())
  }
  useEffect(() => { if (initialEvidence) showEvidence(initialEvidence) }, [initialEvidence])
  const reports = story.reports.filter(report => (!evidence || evidence.includes(report.id)) && (!officialOnly || report.role === 'official'))
    .sort((a, b) => (Date.parse(b.time) - Date.parse(a.time)) * (oldestFirst ? -1 : 1))
  return <div className="space-y-4 [overflow-wrap:anywhere]">
      {previousRead && story.revision > previousRead.revision && <section aria-label={t('news.sinceLastRead')}>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">{t('news.sinceLastRead')}</h4>
        {newDevelopments.length ? <ul className="space-y-3">{newDevelopments.map(value => <li key={value.id}><p className="text-sm font-medium">{value.title}</p><p className="text-sm leading-6 text-muted-foreground">{value.summary}</p><Button size="xs" variant="link" className="px-0" onClick={() => showEvidence(value.reportIds)}>{t('news.eventEvidence')} · {value.reportIds.length}</Button></li>)}</ul>
          : <p className="text-xs text-muted-foreground">{t('news.updatedWithoutDevelopment')}</p>}
      </section>}
      {story.missingReportIds.length > 0 && <p role="status" className="mb-4 rounded-md border border-warning/40 p-3 text-sm">{t('news.missingEvidence', { count: story.missingReportIds.length })}</p>}
        <section><h4 className="mb-2 text-xs font-medium text-muted-foreground">{t('news.whyFollow')}</h4><p className="whitespace-pre-wrap text-sm leading-7">{story.reason}</p>
          <Button size="xs" variant="link" className="mt-2 px-0" onClick={() => showEvidence(story.overviewReportIds)}>{t('news.eventEvidence')} · {story.overviewReportIds.length}</Button></section>
      {story.importance && <section aria-label={t('news.automaticImportance')}>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">{t('news.automaticImportance')}</h4>
        <p className="whitespace-pre-wrap text-sm leading-7"><span className="font-medium">{t(`news.importanceLevel.${story.importance.level}`)}</span> · {story.importance.reason}</p>
        <Button size="xs" variant="link" className="mt-2 px-0" onClick={() => showEvidence(story.importance!.reportIds)}>{t('news.eventEvidence')} · {story.importance.reportIds.length}</Button>
      </section>}
      <details>
        <summary className="cursor-pointer py-2 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('news.eventDevelopments')} · {developments.length}</summary>
        <ol className="mt-2 space-y-6 border-l border-border pl-4">
        {developments.map(development => <li key={development.id}>
          <time dateTime={development.time} className="text-xs text-muted-foreground">{time(development.time)}</time>
          <h4 className="mt-1 text-sm font-semibold leading-6">{development.title}</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{development.summary}</p>
          <Button size="xs" variant="link" className="mt-1 px-0" onClick={() => showEvidence(development.reportIds)}>{t('news.eventEvidence')} · {development.reportIds.length}</Button>
        </li>)}
        </ol>
      </details>
      <NewsAssociations view={story.associations} locale={i18n.resolvedLanguage ?? i18n.language} onEvidence={showEvidence} />
      <NewsSourceComparison reports={story.reports} comparisons={story.comparisons} onEvidence={showEvidence} time={time} />
      <details ref={originalsRef}>
        <summary className="cursor-pointer py-2 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('news.eventReports')} · {story.reports.length}</summary>
        <h4 ref={evidenceHeadingRef} tabIndex={-1} className="mb-3 mt-2 rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{t('news.eventReports')}</h4>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          {evidence && <Button size="xs" variant="outline" onClick={() => showEvidence(null)}>{t('news.allReports')}</Button>}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={officialOnly} onChange={event => setOfficialOnly(event.target.checked)} />{t('news.officialEvidence')}</label>
          <label className="flex items-center gap-1.5">{t('news.reportOrder')}<select value={oldestFirst ? 'oldest' : 'newest'} onChange={event => setOldestFirst(event.target.value === 'oldest')} className="rounded-md border border-border bg-background p-1.5"><option value="newest">{t('news.newestFirst')}</option><option value="oldest">{t('news.oldestFirst')}</option></select></label>
        </div>
        {!reports.length && <p role="status" className="text-sm text-muted-foreground">{t('news.noEvidence')}</p>}
        <div className="space-y-5">{reports.map(report => <article key={report.id} className="border-b border-border/60 pb-4">
          <p className="mb-1 text-xs text-muted-foreground">{report.source} · {report.timeBasis === 'collection' ? t('news.collectedTime', { time: time(report.time) }) : time(report.time)} · {t(report.role ? roleLabels[report.role] : 'news.unknownReportRole')}</p>
          <h5 className="text-sm font-medium leading-6">{safeOriginalUrl(report.link) ? <a href={safeOriginalUrl(report.link)} target="_blank" rel="noopener noreferrer" className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{report.title}</a> : report.title}</h5>
          {report.author && <p className="mt-1 text-xs text-muted-foreground">{report.author}</p>}
          {report.contentBasis && report.contentBasis !== 'missing' && <p className="mt-1 text-[11px] text-muted-foreground">{t(report.contentBasis === 'feed-summary' ? 'news.feedSummary' : 'news.feedContent')}</p>}
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{report.content.trim() ? report.content : t('news.originalBodyMissing')}</p>
          {report.quote && <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">
            {safeOriginalUrl(report.quote.url) ? <a href={safeOriginalUrl(report.quote.url)} target="_blank" rel="noopener noreferrer" className="rounded-sm underline focus-visible:outline-2 focus-visible:outline-ring">{report.quote.author}</a> : report.quote.author}
            <p className="mt-1 whitespace-pre-wrap">{report.quote.text}</p>
          </blockquote>}
        </article>)}</div>
      </details>
      <footer className="mt-6 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
        <p>{t('news.readingPreparedBy')} · <span>{story.preparedBy}</span></p><p>{t('news.eventRevision', { revision: story.revision, time: time(story.updatedAt) })}</p>
        {story.id.startsWith('demo-') && <p>{t('news.eventDemo')}</p>}
      </footer>
    </div>
}

function safeOriginalUrl(raw: string | null): string | undefined {
  try { const url = new URL(raw ?? ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined }
  catch { return undefined }
}
