import { useTranslation } from 'react-i18next'
import type { NewsStoryDetail } from '../../api/types'
import { Button } from '../ui/button'

export function NewsSourceComparison({ reports, comparisons, onEvidence, time }: Pick<NewsStoryDetail, 'reports' | 'comparisons'> & { onEvidence: (ids: number[]) => void; time: (value: string) => string }) {
  const { t } = useTranslation()
  const published = (report: typeof reports[number]) => report.timeBasis !== 'collection' && Number.isFinite(Date.parse(report.time)) ? Date.parse(report.time) : null
  const ordered = [...reports].sort((a, b) => (published(a) ?? Infinity) - (published(b) ?? Infinity) || a.id - b.id)
  const earliest = ordered.length ? published(ordered[0]) : null
  return <details>
    <summary className="cursor-pointer rounded-sm py-2 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('news.compareSources')}</summary>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs leading-5">
        <thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="p-2">{t('news.comparisonReport')}</th><th scope="col" className="p-2">{t('news.comparisonTime')}</th></tr></thead>
        <tbody>{ordered.map(report => <tr key={report.id} className="border-b border-border/60 align-top">
          <td className="p-2"><p className="text-muted-foreground">{report.source ?? t('news.unknownReportRole')}</p><Button size="xs" variant="link" className="h-auto whitespace-normal px-0 text-left" aria-label={t('news.readComparisonOriginal', { title: report.title })} onClick={() => onEvidence([report.id])}>{report.title}</Button></td>
          <td className="p-2 tabular-nums"><p>{report.timeBasis === 'collection' ? t('news.collectedTime', { time: time(report.time) }) : published(report) === null ? t('news.publicationUnknown') : time(report.time)}</p>
            {earliest !== null && published(report) === earliest && <p className="text-muted-foreground">{t('news.earliestCollectedReport')}</p>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    {comparisons?.length ? <div role="group" aria-label={t('news.preparedSourceNotes')} className="mt-3 space-y-2">{comparisons.map((note, index) => <div key={index} className="border-l-2 border-border pl-3 text-sm leading-6">
      <p className="text-xs text-muted-foreground">{t(`news.comparisonKind.${note.kind}`)}</p><p>{note.summary}</p>
      <Button size="xs" variant="link" className="px-0" onClick={() => onEvidence(note.reportIds)}>{t('news.eventEvidence')} · {note.reportIds.length}</Button>
    </div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">{t('news.noSourceNotes')}</p>}
  </details>
}
