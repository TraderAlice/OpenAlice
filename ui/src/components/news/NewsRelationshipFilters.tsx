import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NEWS_COUNTRIES } from '../../../../src/domain/market-data/reference/countries'
import { GICS_SECTOR_ETFS } from '../../../../src/domain/analysis/sector-catalog'
import { inputClass } from '../form'
import { Button } from '../ui/button'

export type RelationshipFilters = { country?: string; industry?: string; asset?: string }
export function NewsRelationshipFilters({ values, onChange }: { values: RelationshipFilters; onChange: (values: RelationshipFilters) => void }) {
  const { t, i18n } = useTranslation()
  const [draft, setDraft] = useState(values)
  const active = Object.values(values).filter(Boolean)
  return <div className="mt-2 flex flex-wrap items-start gap-2 text-xs text-muted-foreground">
    <details className="min-w-0 flex-1">
      <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">{t('news.relationships')}{active.length ? ` · ${active.join(' · ')}` : ''}</summary>
      <form aria-label={t('news.relationships')} className="mt-2 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); onChange(draft) }}>
        <label className="min-w-0">{t('news.countryFilter')}<select className={`${inputClass} mt-1 h-8 w-auto max-w-full text-xs`} value={draft.country ?? ''} onChange={event => setDraft({ ...draft, country: event.target.value || undefined })}>
          <option value="">{t('news.allCountries')}</option>{NEWS_COUNTRIES.map(country => { let label: string = country.label; try { label = new Intl.DisplayNames([i18n.resolvedLanguage ?? i18n.language], { type: 'region' }).of(country.code) ?? label } catch { /* Fall back to catalog name. */ } return <option key={country.code} value={country.code}>{label}</option> })}
        </select></label>
        <label className="min-w-0">{t('news.industryFilter')}<select className={`${inputClass} mt-1 h-8 w-auto max-w-full text-xs`} value={draft.industry ?? ''} onChange={event => setDraft({ ...draft, industry: event.target.value || undefined })}>
          <option value="">{t('news.allIndustries')}</option>{GICS_SECTOR_ETFS.map(sector => <option key={sector.symbol} value={sector.symbol}>{t(`news.market.sectorNames.${sector.symbol}`, { defaultValue: sector.sector })} · {sector.symbol}</option>)}
        </select></label>
        <label className="min-w-0 flex-1 basis-40">{t('news.assetIdentity')}<input className={`${inputClass} mt-1 h-8 min-w-0 text-xs`} value={draft.asset ?? ''} placeholder="sourceId|nativeSymbol" pattern="[^|]+\|.+" maxLength={500} onChange={event => setDraft({ ...draft, asset: event.target.value.trim() || undefined })} /></label>
        <Button type="submit" size="sm" variant="secondary">{t('news.applyRelationships')}</Button>
      </form>
    </details>
    {active.length > 0 && <Button size="xs" variant="ghost" onClick={() => onChange({})}>{t('news.clearRelationships')}</Button>}
  </div>
}
