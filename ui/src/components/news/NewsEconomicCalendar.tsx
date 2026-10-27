import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { referenceApi } from '../../api/reference'
import { useReferenceBoard } from '../market/useReferenceBoard'
import { Button } from '../ui/button'

function calendarTime(value: string | null) {
  if (!value) return null
  const day = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!day) return null
  const midnight = Date.parse(day + 'T00:00:00Z')
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return null
  // A time without a zone cannot support a countdown.
  const instant = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? Date.parse(value) : NaN
  return { day, instant: Number.isFinite(instant) ? instant : null }
}

export function NewsEconomicCalendar({ locale }: { locale: string }) {
  const { t } = useTranslation()
  const { data, loading, error, retry } = useReferenceBoard(referenceApi.economicCalendar, 30 * 60_000)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer) }, [])
  const rows = (data?.events ?? []).flatMap(event => {
    const time = calendarTime(event.date)
    return event.event?.trim() && time && time.day >= data!.window.start && time.day <= data!.window.end ? [{ event, ...time }] : []
  }).sort((a, b) => {
    const pastA = a.instant !== null && a.instant < now
    const pastB = b.instant !== null && b.instant < now
    return Number(pastA) - Number(pastB) || a.day.localeCompare(b.day) || (a.instant ?? 0) - (b.instant ?? 0)
  }).slice(0, 3)
  const timing = (instant: number | null) => {
    if (instant === null) return t('news.widgets.calendarTimeUnknown')
    const delta = instant - now
    const [duration, unit] = Math.abs(delta) >= 86400000 ? [86400000, 'day'] as const : Math.abs(delta) >= 3600000 ? [3600000, 'hour'] as const : [60000, 'minute'] as const
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.ceil(delta / duration), unit)
  }
  const date = (value: NonNullable<ReturnType<typeof calendarTime>>) => value.instant === null ? value.day : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value.instant)
  const first = rows[0]
  const values = [['actual', 'news.widgets.actual'], ['consensus', 'news.widgets.forecast'], ['previous', 'news.widgets.previous']] as const
  return <section aria-label={t('news.widgets.calendar')} className="shrink-0 border-b border-border px-4 py-2 [overflow-wrap:anywhere]">
    <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="min-h-8 cursor-pointer rounded-sm text-xs leading-6 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="font-medium">{t('news.widgets.calendar')}</span>
        {!expanded && <span className="ml-3 text-muted-foreground">{first ? <><span>{first.event.event}</span> · <time dateTime={first.event.date!}>{date(first)}</time> · <span>{timing(first.instant)}</span></> : loading ? t('common.loading') : error ? t('news.widgets.calendarUnavailable') : t('news.widgets.calendarEmpty')}</span>}
      </summary>
      {expanded && <div className="grid gap-3 pb-2 pt-2 md:grid-cols-3">
        {rows.map(({ event, ...time }, index) => <article key={`${event.date}-${event.event}-${index}`} aria-label={event.event!} className="min-w-0 border-l border-border pl-3">
          <p className="text-[11px] text-muted-foreground"><time dateTime={event.date!}>{date(time)}</time> · {timing(time.instant)}</p>
          <h3 className="mt-1 text-sm font-medium leading-6">{event.event}</h3>
          <p className="text-xs text-muted-foreground">{[event.country, event.currency, event.importance, event.unit].filter(Boolean).join(' · ')}</p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">{values.map(([key, label]) => <div key={key}><dt className="text-muted-foreground">{t(label)}</dt><dd className="mt-1 font-mono tabular-nums">{event[key] ?? '—'}</dd></div>)}</dl>
        </article>)}
        {!rows.length && <p role="status" className="text-xs text-muted-foreground">{t(loading ? 'common.loading' : error ? 'news.widgets.calendarUnavailable' : 'news.widgets.calendarEmpty')}</p>}
      </div>}
    </details>
    {(error || data?.meta.stale) && data && <p role="status" className="text-xs text-warning">{t('news.widgets.calendarStale')}</p>}
    {error && <Button size="xs" variant="ghost" aria-label={t('news.widgets.calendarRetry')} onClick={() => void retry()}>{t('common.retry')}</Button>}
    {expanded && data && <p className="text-[11px] text-muted-foreground">{data.meta.provider} · {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(data.meta.asOf))} · {data.window.start} – {data.window.end}</p>}
  </section>
}
