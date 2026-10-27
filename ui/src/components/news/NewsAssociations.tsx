import { useTranslation } from 'react-i18next'
import type { NewsStoryDetail } from '../../api/types'
import { useWorkspace } from '../../tabs/store'
import { Button } from '../ui/button'

export function NewsAssociations({ view, locale, onEvidence }: { view: NewsStoryDetail['associations']; locale: string; onEvidence: (ids: number[]) => void }) {
  const { t } = useTranslation()
  const open = useWorkspace(state => state.openOrFocus)
  if (!view?.current) return <p className="text-xs text-muted-foreground">{t('news.relationsUnassessed')}</p>
  const current = view.current
  return <section aria-label={t('news.relationships')} className="space-y-3 border-t border-border pt-3">
    <h4 className="text-xs font-medium text-muted-foreground">{t('news.relationships')}</h4>
    {view.status === 'needs-review' && <p role="status" className="text-xs text-warning">{t('news.relationsStale')}</p>}
    {!current.relations.length && !current.unresolved.length && <p className="text-xs text-muted-foreground">{t('news.relationsUnknown')}</p>}
    <ul className="space-y-3">{current.relations.map(relation => {
      let label = relation.country ?? relation.industry ?? relation.asset?.barId ?? ''
      if (relation.country) { try { label = new Intl.DisplayNames([locale], { type: 'region' }).of(relation.country) ?? label } catch { /* Canonical code remains readable. */ } }
      if (relation.industry) label = `${t(`news.market.sectorNames.${relation.industry}`, { defaultValue: relation.industry })} · ${relation.industry}`
      return <li key={relation.id} className="border-l-2 border-border pl-3 text-sm leading-6">
        <p className="flex flex-wrap items-center gap-x-2"><span className="font-medium">{label}</span><span className="text-xs text-muted-foreground">{t(`news.relationKind.${relation.kind}`)}{relation.status === 'withdrawn' ? ` · ${t('news.relationWithdrawn')}` : ''}</span>
          {relation.asset && view.status === 'current' && relation.status === 'active' && <Button size="xs" variant="link" onClick={() => { const asset = relation.asset!; open({ kind: 'market-detail', params: { assetClass: asset.assetClass, source: asset.barId, symbol: asset.barId.slice(asset.barId.indexOf('|') + 1) } }) }}>{t('news.openRelatedAsset')}</Button>}
        </p>
        <p>{relation.explanation}</p>
        {relation.condition && <p className="text-xs text-muted-foreground">{t('news.relationCondition')} · {relation.condition}</p>}
        <details className="mt-1"><summary className="cursor-pointer rounded-sm text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('news.eventEvidence')}</summary>
          {relation.evidence.map((citation, index) => <blockquote key={index} className="mt-2 border-l border-border pl-2 text-xs text-muted-foreground"><p>{t(citation.field === 'title' ? 'news.relationTitleBasis' : 'news.relationBodyBasis')}</p><p className="whitespace-pre-wrap">{citation.excerpt}</p></blockquote>)}
          <Button size="xs" variant="link" className="px-0" aria-label={t('news.relationEvidence', { target: label })} onClick={() => onEvidence([...new Set(relation.evidence.map(value => value.reportId))])}>{t('news.eventReports')}</Button>
        </details>
      </li>
    })}</ul>
    {current.unresolved.map((item, index) => <p key={index} className="text-xs leading-5 text-muted-foreground">{t('news.relationUnresolved')} · {item.label} · {item.reason}</p>)}
    <p className="text-[11px] text-muted-foreground">{current.preparedBy} · <time dateTime={current.preparedAt}>{new Date(current.preparedAt).toLocaleString(locale)}</time> · {t('news.relationRevision', { revision: current.revision })}</p>
  </section>
}
