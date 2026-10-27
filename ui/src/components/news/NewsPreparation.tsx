import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { NewsAutomation, NewsProcessing } from '../../api/news'
import type { NewsStoryDetail } from '../../api/types'
import { ConfigSection, inputClass } from '../form'
import { Button } from '../ui/button'

export function NewsPreparation() {
  const { t } = useTranslation()
  const [automation, setAutomation] = useState<NewsAutomation | null>(null)
  const [queue, setQueue] = useState<NewsProcessing | null>(null)
  const [workspace, setWorkspace] = useState('')
  const [status, setStatus] = useState<'pending' | 'review' | 'failed'>('pending')
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [promptReview, setPromptReview] = useState(false)
  const [original, setOriginal] = useState<NewsStoryDetail['reports'][number] | null>(null)
  const queueNav = useRef<HTMLElement>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    setPromptReview(false)
    setOriginal(null)
    void Promise.all([api.news.getAutomation(controller.signal), api.news.getProcessing(status, offset, controller.signal)]).then(([automation, queue]) => {
      if (controller.signal.aborted) return
      setAutomation(automation)
      setQueue(queue)
      setWorkspace(current => automation.automations.find(item => item.enabled)?.workspaceId || current)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [status, offset, refresh])
  const current = automation?.automations.find(item => item.workspaceId === workspace)
  const act = async (change: () => Promise<unknown>) => {
    setSaving(true)
    setError(false)
    setPromptReview(false)
    try { await change(); setRefresh(value => value + 1) }
    catch (error) { setPromptReview(error instanceof Error && error.message.startsWith('News preparation instructions require review')); setError(true) }
    finally { setSaving(false) }
  }
  const read = async (id: number) => {
    setSaving(true)
    setError(false)
    setPromptReview(false)
    try { setOriginal(await api.news.getOriginal(id)) }
    catch { setError(true) }
    finally { setSaving(false) }
  }
  return <ConfigSection id="news-preparation" title={t('news.preparation')} description={t('news.preparationDescription')}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 basis-52"><span className="mb-1 block text-xs text-muted-foreground">{t('news.preparationWorkspace')}</span>
        <select className={inputClass} value={workspace} onChange={event => setWorkspace(event.target.value)} disabled={loading || saving || Boolean(automation?.automations.some(item => item.enabled))}>
          <option value="">{t('news.chooseWorkspace')}</option>
          {automation?.workspaces.map(item => <option key={item.id} value={item.id}>{item.tag}</option>)}
        </select>
      </label>
      <Button variant={current?.enabled ? 'outline' : 'secondary'} disabled={!workspace || loading || saving || (!current?.enabled && error)} onClick={() => void act(() => api.news.setAutomation(workspace, !current?.enabled))}>{t(current?.enabled ? 'news.pausePreparation' : 'news.enablePreparation')}</Button>
      <Button variant="ghost" disabled={loading || saving} onClick={() => setRefresh(value => value + 1)}>{t('news.refresh')}</Button>
    </div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('news.preparationCost')}</p>
    {current && <Link className="mt-2 inline-block text-xs underline underline-offset-4" to={`/issues/${encodeURIComponent(workspace)}/${current.issueId}`}>{t('news.preparationRuns')}</Link>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{t(promptReview ? 'news.preparationPromptReview' : 'news.preparationError')}</p>}
    <details className="mt-4">
      <summary className="cursor-pointer py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">{t('news.reviewQueue')}{queue && ` · ${t('news.processing.pending')} ${queue.counts.ready} · ${t('news.processing.review')} ${queue.counts.review} · ${t('news.processing.failed')} ${queue.counts.failed}`}</summary>
    <div aria-busy={loading}>
      <nav ref={queueNav} tabIndex={-1} aria-label={t('news.processingQueue')} className="flex flex-wrap gap-1 focus-visible:outline-2 focus-visible:outline-ring">
        {(['pending', 'review', 'failed'] as const).map(value => <Button key={value} size="sm" variant={status === value ? 'secondary' : 'ghost'} aria-pressed={status === value} disabled={saving}
          onClick={() => { setStatus(value); setOffset(0) }}>{t(`news.processing.${value}`)} <span className="tabular-nums">{queue ? value === 'pending' ? queue.counts.ready : queue.counts[value] : '—'}</span></Button>)}
      </nav>
      {loading ? <p role="status" className="py-3 text-sm text-muted-foreground">{t('common.loading')}</p> : queue?.items.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t('news.processingEmpty')}</p> :
        <ul className="divide-y divide-border/60">{queue?.items.map(item => <li key={item.id} className="py-3">
          <h4 className="text-sm font-medium">{item.title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{item.source} · <time dateTime={item.time}>{item.time}</time></p>
          {item.processing && <p className="mt-1 whitespace-pre-wrap text-sm">{item.processing.reason}</p>}
          {item.processing?.retryAt && <p className="mt-1 text-xs text-muted-foreground">{t('news.retryAt', { time: new Date(item.processing.retryAt).toLocaleString() })}</p>}
          {item.processing?.status === 'failed' && item.processing.attempts >= 3 && <p className="mt-1 text-xs text-muted-foreground">{t('news.manualRetryRequired')}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" variant="outline" disabled={saving} onClick={() => void read(item.id)}>{t('news.readReport')}</Button>
            {item.processing && <Button size="xs" variant="ghost" disabled={saving} onClick={() => void act(async () => { await api.news.retryReport(item.id, notes[item.id] ?? ''); queueNav.current?.focus() })}>{t('news.retryPreparation')}</Button>}
          </div>
          {item.processing && <label className="mt-2 block text-xs text-muted-foreground">{t('news.reviewNote')}<textarea className={`${inputClass} mt-1 min-h-16 resize-y text-sm`} maxLength={1000} value={notes[item.id] ?? ''} disabled={saving} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} /></label>}
          {original?.id === item.id && <div role="region" aria-label={original.title} className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm leading-6 [overflow-wrap:anywhere]">{original.content || t('news.originalBodyMissing')}</div>}
        </li>)}</ul>}
      <div className="mt-2 flex gap-2">
        <Button size="xs" variant="outline" disabled={!offset || loading || saving} onClick={() => setOffset(value => Math.max(0, value - 40))}>{t('news.previousQueue')}</Button>
        <Button size="xs" variant="outline" disabled={queue?.nextOffset == null || loading || saving} onClick={() => setOffset(queue?.nextOffset ?? 0)}>{t('news.nextQueue')}</Button>
      </div>
    </div>
    </details>
  </ConfigSection>
}
