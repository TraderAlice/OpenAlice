import { Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { useTranslation } from 'react-i18next'
import type { GlobalMacroCell } from '../../api/reference'
import { MeasuredChartFrame } from '../MeasuredChartFrame'

export function GlobalMacroHistory({ cell, periods, period, title, format }: {
  cell: GlobalMacroCell
  periods: string[]
  period: string | undefined
  title: string
  format: (value: number) => string
}) {
  const { t } = useTranslation()
  const observations = new Map(cell.history?.filter(point => Number.isFinite(point.value)).map(point => [point.date, point.value]))
  const data = periods.map(date => ({ date, value: observations.get(date) ?? null }))
  const selected = period ? observations.get(period) : undefined
  const selectedValue = selected === undefined ? t('market.mapNoData') : format(selected)
  return <figure aria-label={title} className="border-t border-border pt-4">
    <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
      <span className="font-medium">{title}</span>
      <span aria-label={t('market.mapSelectedObservation', { value: selectedValue, date: period ?? t('market.observationUnknown') })} className="font-mono tabular-nums">
        {selectedValue}<span className="ml-2 font-sans text-muted-foreground">{period ?? t('market.observationUnknown')}</span>
      </span>
    </figcaption>
    {observations.size ? <>
      <MeasuredChartFrame className="h-44">
        {({ width, height }) => <LineChart accessibilityLayer width={width} height={height} data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tickFormatter={value => String(value).slice(0, 7)} minTickGap={32} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" />
          <YAxis domain={['auto', 'auto']} tickFormatter={value => format(Number(value))} width={58} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" />
          <Tooltip isAnimationActive={false} formatter={value => [format(Number(value)), title]} labelFormatter={value => String(value)} />
          {period && <ReferenceLine x={period} stroke="var(--muted-foreground)" strokeDasharray="3 3" />}
          <Line type="linear" dataKey="value" stroke="var(--chart-1)" strokeWidth={1.5} connectNulls={false}
            dot={{ r: 1.5 }} activeDot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>}
      </MeasuredChartFrame>
      <p className="mt-1 text-[11px] text-muted-foreground">{t('market.mapHistoryObservations', { count: observations.size })}</p>
    </> : <p className="py-3 text-xs text-muted-foreground">{t('market.mapHistoryEmpty')}</p>}
  </figure>
}
