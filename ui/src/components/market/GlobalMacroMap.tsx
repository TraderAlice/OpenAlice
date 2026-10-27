import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { GlobalMacroCell, GlobalMacroRow } from '../../api/reference'
import { inputClass } from '../form'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { GlobalMacroHistory } from './GlobalMacroHistory'
import world from './world-map.json'
import { newsCountryCode } from '../../../../src/domain/market-data/reference/countries'

// One China path keeps all its regions under the same fill and hit target.
const taiwanPath = world.countries.find(country => country.id === 'TW')!.path
const regions = world.countries.filter(country => country.id !== 'TW').map(country =>
  country.id === 'CN' ? { ...country, path: `${country.path} ${taiwanPath}` } : country)
const countryIds = new Set(regions.map(country => country.id))
const indicators = [
  { key: 'cpiYoy', label: 'market.colCpiYoy', percent: true },
  { key: 'shortRate', label: 'market.colShortRate', percent: true },
  { key: 'cli', label: 'market.colCli', percent: false },
  { key: 'housePrice', label: 'market.colHousePrice', percent: false },
  { key: 'sharePrice', label: 'market.colSharePrice', percent: false },
] as const
type Indicator = typeof indicators[number]['key']

function countryCode(country: string): string | undefined {
  const code = newsCountryCode(country) ?? country.toUpperCase()
  return countryIds.has(code) ? code : undefined
}

export function macroCountryName(row: GlobalMacroRow, locale: string): string {
  const code = countryCode(row.country)
  try { return code ? new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? row.label : row.label }
  catch { return row.label }
}

export function macroCellAtPeriod(cell: GlobalMacroCell, period: string): GlobalMacroCell {
  const point = cell.history?.find(point => point.date === period) ?? (cell.date === period ? cell : undefined)
  return point?.value != null && Number.isFinite(point.value)
    ? { value: point.value, date: period }
    : { value: null, date: null, error: cell.error }
}

export function GlobalMacroMap({ rows, selectedCountry, onSelectCountry, onPeriodChange }: {
  rows: GlobalMacroRow[]
  selectedCountry: string | null
  onSelectCountry: (country: string) => void
  onPeriodChange?: (period: string | null) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [indicator, setIndicator] = useState<Indicator>('cpiYoy')
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pinnedRange, setPinnedRange] = useState<number | null>(null)
  const [hoveredRange, setHoveredRange] = useState<number | null>(null)
  const [focusedRange, setFocusedRange] = useState<number | null>(null)
  const definition = indicators.find(item => item.key === indicator)!
  const format = (value: number) => definition.percent ? `${value.toFixed(2)}%` : value.toFixed(1)
  const hasHistory = rows.some(row => row[indicator].history?.length)
  const periods = [...new Set(rows.flatMap(row => [row[indicator].date, ...(row[indicator].history?.map(point => point.date) ?? [])])
    .filter((date): date is string => Boolean(date?.trim())))].sort()
  const period = chosenPeriod && periods.includes(chosenPeriod) ? chosenPeriod : periods[periods.length - 1]
  const periodIndex = period ? periods.indexOf(period) : 0
  const canScrub = hasHistory && periods.length > 1
  useEffect(() => { onPeriodChange?.(hasHistory ? period ?? null : null) }, [hasHistory, period, onPeriodChange])
  const mapped = new Map(rows.flatMap(row => {
    const code = countryCode(row.country)
    return code ? [[code, row] as const] : []
  }))
  const valueAtPeriod = (row: GlobalMacroRow | undefined): number | undefined => {
    return row && period ? macroCellAtPeriod(row[indicator], period).value ?? undefined : undefined
  }
  const values = [...mapped.values()].map(valueAtPeriod).filter((value): value is number => value !== undefined)
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  const rangeCount = min === max ? 1 : 5
  const rangeOf = (value: number) => min === max ? 0 : Math.min(4, Math.floor((value - min!) / (max! - min!) * 5))
  const activeRange = hoveredRange ?? focusedRange ?? pinnedRange
  const clearRange = () => { setPinnedRange(null); setHoveredRange(null); setFocusedRange(null) }
  useEffect(clearRange, [indicator, period])
  const selectedRow = rows.find(row => row.country === selectedCountry)
  const selectedCode = selectedCountry ? countryCode(selectedCountry) : undefined
  const center = world.countries.find(country => country.id === selectedCode)?.center ?? [world.width / 2, world.height / 2]
  const width = world.width / zoom, height = world.height / zoom
  const x = Math.max(0, Math.min(world.width - width, center[0] - width / 2))
  const y = Math.max(0, Math.min(world.height - height, center[1] - height / 2))

  return <TooltipProvider><div className="space-y-3" onKeyDown={event => { if (event.key === 'Escape') clearRange() }}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 text-xs text-muted-foreground">
        <span className="mb-1 block">{t('market.mapIndicator')}</span>
        <select aria-label={t('market.mapIndicator')} value={indicator} onChange={event => { setIndicator(event.target.value as Indicator); setChosenPeriod(null) }} className={`${inputClass} h-8 w-auto max-w-full text-xs`}>
          {indicators.map(item => <option key={item.key} value={item.key}>{t(item.label)}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-xs text-muted-foreground">
        <span className="mb-1 block">{t('market.mapPeriod')}</span>
        <select aria-label={t('market.mapPeriod')} value={period ?? ''} disabled={!periods.length} onChange={event => setChosenPeriod(event.target.value)} className={`${inputClass} h-8 w-auto max-w-full text-xs tabular-nums`}>
          {!periods.length && <option value="">{t('market.observationUnknown')}</option>}
          {periods.toReversed().map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-xs text-muted-foreground">
        <span className="mb-1 block">{t('market.colCountry')}</span>
        <select aria-label={t('market.colCountry')} value={rows.some(row => row.country === selectedCountry) ? selectedCountry! : ''} onChange={event => { if (event.target.value) onSelectCountry(event.target.value) }} className={`${inputClass} h-8 w-auto max-w-full text-xs`}>
          <option value="">{t('market.mapChooseCountry')}</option>
          {rows.map(row => <option key={row.country} value={row.country}>{macroCountryName(row, locale)}</option>)}
        </select>
      </label>
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t('market.mapZoomIn')} disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 1))}><ZoomIn className="size-4" aria-hidden /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('market.mapZoomOut')} disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 1))}><ZoomOut className="size-4" aria-hidden /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={t('market.mapReset')} disabled={zoom === 1} onClick={() => setZoom(1)}><RotateCcw className="size-4" aria-hidden /></Button>
      </div>
    </div>
    <svg role="group" aria-label={t('market.mapWorld')} viewBox={`${x} ${y} ${width} ${height}`} className="block max-h-[52vh] w-full overflow-hidden rounded-sm" style={{ aspectRatio: `${world.width} / ${world.height}` }}>
      {regions.map(country => {
        const row = mapped.get(country.id)
        const value = valueAtPeriod(row)
        const selected = row?.country === selectedCountry
        const name = row ? macroCountryName(row, locale) : country.name
        const label = value === undefined ? `${name}: ${t('market.mapNoPeriodData')}` : `${name}: ${t(definition.label)} ${format(value)}, ${period}`
        const opacity = value !== undefined && min !== null && max !== null ? min === max ? 0.75 : 0.25 + (value - min) / (max - min) * 0.7 : 1
        const matches = activeRange === null || value !== undefined && rangeOf(value) === activeRange
        const path = <path key={country.id} d={country.path} role={row ? 'button' : undefined} tabIndex={row ? 0 : undefined} aria-hidden={row ? undefined : true}
          aria-label={row ? label : undefined} aria-pressed={row ? selected : undefined}
          fill={value === undefined ? 'var(--muted)' : 'var(--chart-1)'} fillOpacity={matches ? opacity : opacity * 0.15}
          stroke={selected ? 'var(--primary)' : 'var(--background)'} strokeWidth={selected ? 2 : 0.7} vectorEffect="non-scaling-stroke"
          onClick={row ? () => onSelectCountry(row.country) : undefined}
          onKeyDown={row ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectCountry(row.country) } } : undefined}
          className={row ? 'cursor-pointer outline-none hover:stroke-primary focus-visible:stroke-ring focus-visible:[stroke-width:2px]' : undefined}>
          {!row && <title>{label}</title>}
        </path>
        return row ? <Tooltip key={country.id}>
          <TooltipTrigger render={path} />
          <TooltipContent role="tooltip" className="block min-w-44 space-y-1.5">
            <p className="font-semibold">{name}</p>
            <p className="text-[11px] opacity-70">{t(definition.label)}</p>
            <p className="font-mono text-lg font-semibold tabular-nums">{value === undefined ? t('market.mapNoPeriodData') : format(value)}</p>
            {period && <p className="tabular-nums opacity-70">{period}</p>}
            <p className="text-[11px] opacity-70">{t('market.mapHistoryHint')}</p>
          </TooltipContent>
        </Tooltip> : path
      })}
    </svg>
    <div className="space-y-1 border-t border-border pt-3">
      <div className="flex justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{periods[0]?.slice(0, 7) ?? '—'}</span>
        <span className="font-medium text-foreground">{period?.slice(0, 7) ?? '—'}</span>
        <span>{periods[periods.length - 1]?.slice(0, 7) ?? '—'}</span>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t('market.mapPreviousPeriod')} disabled={!canScrub || periodIndex === 0} onClick={() => setChosenPeriod(periods[periodIndex - 1])}><ChevronLeft className="size-4" aria-hidden /></Button>
        <input type="range" aria-label={t('market.mapTimeline')} aria-valuetext={period ?? t('market.observationUnknown')}
          min={0} max={Math.max(0, periods.length - 1)} step={1} value={periodIndex} disabled={!canScrub}
          onChange={event => setChosenPeriod(periods[Number(event.target.value)])}
          className="h-8 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-default disabled:opacity-40" />
        <Button variant="ghost" size="icon-sm" aria-label={t('market.mapNextPeriod')} disabled={!canScrub || periodIndex === periods.length - 1} onClick={() => setChosenPeriod(periods[periodIndex + 1])}><ChevronRight className="size-4" aria-hidden /></Button>
        <Button variant="ghost" size="sm" disabled={!canScrub || periodIndex === periods.length - 1} onClick={() => setChosenPeriod(null)}>{t('market.mapLatestPeriod')}</Button>
      </div>
      {!hasHistory && <p className="text-xs text-muted-foreground">{t('market.mapHistoryUnavailable')}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {min !== null && max !== null && <div className="flex items-center gap-2 tabular-nums">
        <span>{format(min)}</span>
        <div role="group" aria-label={t('market.mapLegend')} className="flex">
          {Array.from({ length: rangeCount }, (_, index) => {
            const from = min + (max - min) * index / rangeCount
            const to = min + (max - min) * (index + 1) / rangeCount
            const count = values.filter(value => rangeOf(value) === index).length
            const label = t('market.mapLegendRange', { from: format(from), to: format(to), count })
            return <button key={index} type="button" aria-label={label} title={label} aria-pressed={pinnedRange === index}
              onMouseEnter={() => setHoveredRange(index)} onMouseLeave={() => setHoveredRange(null)}
              onFocus={() => setFocusedRange(index)} onBlur={() => setFocusedRange(null)}
              onClick={() => { setPinnedRange(current => current === index ? null : index); setHoveredRange(null); setFocusedRange(null) }}
              className="flex size-11 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:w-6">
              <span aria-hidden className={`h-2 w-full ${activeRange === index ? 'ring-1 ring-foreground ring-offset-2 ring-offset-background' : ''}`}
                style={{ background: 'var(--chart-1)', opacity: rangeCount === 1 ? 0.75 : 0.25 + index * 0.175 }} />
            </button>
          })}
        </div>
        <span>{format(max)}</span>
      </div>}
      <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 bg-muted" />{t('market.mapNoData')}</span>
      <span role="status" aria-atomic="true" className="sm:ml-auto">{t('market.mapCoverage', { count: values.length, total: rows.length })}</span>
      {activeRange !== null && <span aria-live="polite">{t('market.mapLegendMatches', { count: values.filter(value => rangeOf(value) === activeRange).length })}</span>}
      {pinnedRange !== null && <Button variant="ghost" size="xs" onClick={clearRange}>{t('market.mapClearRange')}</Button>}
    </div>
    {selectedRow && <GlobalMacroHistory key={`${selectedRow.country}:${indicator}`} cell={selectedRow[indicator]} periods={periods} period={period}
      title={t('market.mapHistory', { country: macroCountryName(selectedRow, locale), indicator: t(definition.label) })} format={format} />}
  </div></TooltipProvider>
}
