import { useCallback, useEffect, useMemo, useState } from 'react'

import { referenceApi, type GlobalMacroBoard, type GlobalMacroCell, type MacroBoard } from '../../api/reference'
import { Card } from '../../components/market/Card'
import { KlinePanel, type KlineSnapshot } from '../../components/market/KlinePanel'
import { SegmentedControl } from '../../components/SegmentedControl'
import { Skeleton } from '../../components/StateViews'
import { fmtPctSigned, fmtPnl } from '../../lib/format'
import { useWorkspace } from '../../tabs/store'
import {
  broadDollarChange,
  buildIndicativeForwardCurve,
  calculateFxScenario,
  computeFxPriceStats,
  macroRowForCurrency,
  parseFxPair,
  resolveFxCountry,
} from './fx-analysis'

interface Props {
  symbol: string
  source?: string
}

const EMPTY_SNAPSHOT: KlineSnapshot = {
  bars: null,
  meta: null,
  loading: true,
  error: null,
  interval: '1d',
  timeframe: '1Y',
}
const SHOCKS = [-100, -25, 25, 100]

function fxDigits(value: number, pair: ReturnType<typeof parseFxPair>): number {
  if (!pair) return 4
  return pair.quote === 'JPY' || Math.abs(value) >= 100 ? 3 : 5
}

function fmtFx(value: number | null | undefined, pair: ReturnType<typeof parseFxPair>): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fxDigits(value, pair),
    maximumFractionDigits: fxDigits(value, pair),
  })
}

function fmtFxRange(value: number, pair: ReturnType<typeof parseFxPair>): string {
  const digits = pair?.quote === 'JPY' ? 2 : 4
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtCell(cell: GlobalMacroCell | undefined, suffix: string): string {
  return cell?.value == null ? '—' : `${cell.value.toFixed(suffix === '%' ? 2 : 1)}${suffix}`
}

export function CurrencyDetail({ symbol, source }: Props) {
  const pair = useMemo(() => parseFxPair(symbol), [symbol])
  const [snapshot, setSnapshot] = useState<KlineSnapshot>(EMPTY_SNAPSHOT)
  const [globalMacro, setGlobalMacro] = useState<GlobalMacroBoard | null>(null)
  const [macro, setMacro] = useState<MacroBoard | null>(null)
  const [macroError, setMacroError] = useState<string | null>(null)
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [notional, setNotional] = useState('1000000')
  const [movePips, setMovePips] = useState('25')
  const handleSnapshot = useCallback((next: KlineSnapshot) => setSnapshot(next), [])
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([referenceApi.globalMacro(), referenceApi.macro()])
      .then(([globalResult, macroResult]) => {
        if (cancelled) return
        if (globalResult.status === 'fulfilled') setGlobalMacro(globalResult.value)
        if (macroResult.status === 'fulfilled') setMacro(macroResult.value)
        setMacroError(globalResult.status === 'rejected'
          ? (globalResult.reason instanceof Error ? globalResult.reason.message : String(globalResult.reason))
          : null)
      })
    return () => { cancelled = true }
  }, [])

  const stats = useMemo(() => computeFxPriceStats(snapshot.bars ?? []), [snapshot.bars])
  const dailyRisk = snapshot.interval === '1d' ? stats : null
  const baseRow = pair ? macroRowForCurrency(pair.base, globalMacro) : null
  const quoteRow = pair ? macroRowForCurrency(pair.quote, globalMacro) : null
  const baseCountry = pair ? resolveFxCountry(pair.base) : null
  const quoteCountry = pair ? resolveFxCountry(pair.quote) : null
  const baseRate = baseRow?.shortRate.value ?? null
  const quoteRate = quoteRow?.shortRate.value ?? null
  const rateDiff = baseRate != null && quoteRate != null ? baseRate - quoteRate : null
  const cpiDiff = baseRow?.cpiYoy.value != null && quoteRow?.cpiYoy.value != null
    ? baseRow.cpiYoy.value - quoteRow.cpiYoy.value
    : null
  const cliDiff = baseRow?.cli.value != null && quoteRow?.cli.value != null
    ? baseRow.cli.value - quoteRow.cli.value
    : null
  const forwards = stats && pair && baseRate != null && quoteRate != null
    ? buildIndicativeForwardCurve(stats.spot, baseRate, quoteRate, pair.pipSize)
    : []
  const scenario = pair && stats
    ? calculateFxScenario({
        pair,
        spot: stats.spot,
        notionalBase: Number(notional),
        movePips: Number(movePips),
        side,
      })
    : null
  const dollar = broadDollarChange(macro)

  if (!pair) {
    return (
      <div className="flex flex-col gap-3 min-h-0 flex-1">
        <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-muted-foreground">
          Open a six-letter currency pair such as EURUSD or USDJPY to use the FX workbench.
        </div>
        <div className="h-[420px] shrink-0">
          <KlinePanel selection={{ symbol, assetClass: 'currency' }} source={source} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-lg border border-border bg-secondary/35 px-4 py-3.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[22px] font-semibold tracking-tight text-foreground">{pair.base}/{pair.quote}</span>
              <span className="text-[11px] text-muted-foreground">spot research · no account required</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[26px] font-semibold text-foreground">{fmtFx(stats?.spot, pair)}</span>
              <span className="text-[11px] text-muted-foreground">{stats?.asOf ?? (snapshot.loading ? 'loading price history…' : 'no price')}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
            <FxMetric label="1W" value={snapshot.interval === '1d' ? fmtPctSigned(dailyRisk?.oneWeekReturn) : '1d candles'} />
            <FxMetric label="1M" value={snapshot.interval === '1d' ? fmtPctSigned(dailyRisk?.oneMonthReturn) : '1d candles'} />
            <FxMetric label="3M" value={snapshot.interval === '1d' ? fmtPctSigned(dailyRisk?.threeMonthReturn) : '1d candles'} />
            <FxMetric label="20D vol" value={dailyRisk?.realizedVol20 == null ? (snapshot.interval === '1d' ? '—' : '1d candles') : `${dailyRisk.realizedVol20.toFixed(1)}%`} />
            <FxMetric
              label={`${snapshot.timeframe} range`}
              value={stats ? `${fmtFxRange(stats.rangeLow, pair)}–${fmtFxRange(stats.rangeHigh, pair)}` : '—'}
              subvalue={stats?.rangePosition == null ? undefined : `${stats.rangePosition.toFixed(0)}% through range`}
            />
          </div>
        </div>
      </section>

      <div className="h-[390px] shrink-0">
        <KlinePanel
          selection={{ symbol: pair.symbol, assetClass: 'currency' }}
          source={source}
          onSnapshot={handleSnapshot}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
        <Card
          title="Macro divergence"
          info="Country-level OECD proxies. EUR uses Germany and CNH uses onshore China; dates can differ by indicator. Read the dates before treating a spread as current."
          right={
            <button
              type="button"
              className="text-[11px] font-medium text-primary hover:text-primary/80"
              onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'global-macro' } })}
            >
              Open board
            </button>
          }
          contentClassName="p-0"
        >
          {!globalMacro && !macroError ? (
            <div className="space-y-3 p-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : macroError ? (
            <p className="p-3 text-[12px] text-destructive">{macroError}</p>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <div className="min-w-[430px]">
                  <div className="grid grid-cols-[minmax(110px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)_80px] border-b border-border/60 bg-muted/25 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>Driver</span><span className="text-right">{pair.base}</span><span className="text-right">{pair.quote}</span><span className="text-right">Spread</span>
                  </div>
                  <MacroCompareRow label="Short rate" base={baseRow?.shortRate} quote={quoteRow?.shortRate} diff={rateDiff} cellSuffix="%" diffSuffix="pp" />
                  <MacroCompareRow label="CPI YoY" base={baseRow?.cpiYoy} quote={quoteRow?.cpiYoy} diff={cpiDiff} cellSuffix="%" diffSuffix="pp" />
                  <MacroCompareRow label="Growth CLI" base={baseRow?.cli} quote={quoteRow?.cli} diff={cliDiff} cellSuffix="" diffSuffix="" />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
                <span>{baseCountry?.label}{baseCountry?.proxy ? ` · ${baseCountry.proxy}` : ''} vs {quoteCountry?.label}{quoteCountry?.proxy ? ` · ${quoteCountry.proxy}` : ''}</span>
                {pair.symbol.includes('USD') && dollar && (
                  <span>Broad USD {dollar.latest.toFixed(1)} · 20 obs {fmtPctSigned(dollar.changePct)}</span>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Indicative carry curve"
          info="Covered-interest-parity estimate from OECD short-rate proxies. It excludes cross-currency basis, bid/ask, holidays and exact tenor curves; it is not an executable forward quote."
          right={rateDiff == null ? null : (
            <span className={`text-[11px] font-medium ${rateDiff >= 0 ? 'text-success' : 'text-warning'}`}>
              {pair.base}–{pair.quote} {rateDiff >= 0 ? '+' : ''}{rateDiff.toFixed(2)}pp
            </span>
          )}
          contentClassName="p-0"
        >
          {forwards.length === 0 ? (
            <p className="p-3 text-[12px] leading-relaxed text-muted-foreground">
              Short-rate data is unavailable for one or both currencies. Price history remains usable; carry is left blank instead of guessed.
            </p>
          ) : (
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-border/60 bg-muted/25 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Tenor</th><th className="px-3 py-2 text-right font-medium">Outright</th><th className="px-3 py-2 text-right font-medium">Forward points</th>
              </tr></thead>
              <tbody>{forwards.map((point) => (
                <tr key={point.months} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-medium text-foreground">{point.months}M</td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">{fmtFx(point.outright, pair)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${point.points >= 0 ? 'text-success' : 'text-destructive'}`}>{point.points >= 0 ? '+' : ''}{point.points.toFixed(1)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>

      <Card
        title="Exposure scenario"
        info="Manual what-if calculator for exposure held in another system. P&L is linear spot delta and excludes options convexity, forward carry, funding, fees and basis. Inputs stay in this tab and are never sent to a broker."
      >
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[auto_minmax(150px,220px)_minmax(180px,1fr)_minmax(210px,1fr)] 2xl:items-end">
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Exposure side</label>
            <SegmentedControl
              value={side}
              options={[
                { value: 'long', label: `Long ${pair.base}` },
                { value: 'short', label: `Short ${pair.base}` },
              ]}
              onChange={setSide}
              ariaLabel="Exposure side"
            />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Notional · {pair.base}</span>
            <input
              type="number"
              min="0"
              step="100000"
              value={notional}
              onChange={(event) => setNotional(event.target.value)}
              className="min-h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12px] font-mono text-foreground focus:border-primary focus:outline-none"
            />
          </label>
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Pair move · pips</label>
            <div className="flex flex-wrap gap-1.5">
              {SHOCKS.map((shock) => (
                <button
                  key={shock}
                  type="button"
                  aria-pressed={Number(movePips) === shock}
                  onClick={() => setMovePips(String(shock))}
                  className={`min-h-8 rounded-md border px-2 text-[11px] font-medium transition-colors ${Number(movePips) === shock ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                  {shock > 0 ? '+' : ''}{shock}
                </button>
              ))}
              <input
                aria-label="Custom pair move in pips"
                type="number"
                step="1"
                value={movePips}
                onChange={(event) => setMovePips(event.target.value)}
                className="min-h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-[11px] font-mono text-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/25 px-3 py-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimated P&amp;L · {pair.quote}</p>
                <p className={`mt-0.5 font-mono text-[20px] font-semibold ${scenario && scenario.quotePnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {scenario ? fmtPnl(scenario.quotePnl, pair.quote) : '—'}
                </p>
              </div>
              <div className="text-right text-[10px] text-muted-foreground">
                <p>spot {scenario ? fmtFx(scenario.shockedSpot, pair) : '—'}</p>
                <p>{scenario ? fmtPctSigned(scenario.movePercent) : '—'} · ≈ {scenario ? fmtPnl(scenario.basePnlApprox, pair.base) : '—'}</p>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          Manual research only. OpenAlice does not need the bank account or position feed; enter a receivable, payable or hedge notional here and take the result back to the desk system.
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2 pb-2">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Continue analysis</span>
        <DeskLink label="Global Macro" onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'global-macro' } })} />
        <DeskLink label="US Macro" onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })} />
        <DeskLink label="Fed" onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'fed' } })} />
      </div>
    </div>
  )
}

function FxMetric({ label, value, subvalue }: { label: string; value: string; subvalue?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[12px] font-medium text-foreground">{value}</p>
      {subvalue && <p className="truncate text-[9px] text-muted-foreground">{subvalue}</p>}
    </div>
  )
}

function MacroCompareRow({ label, base, quote, diff, cellSuffix, diffSuffix }: {
  label: string
  base?: GlobalMacroCell
  quote?: GlobalMacroCell
  diff: number | null
  cellSuffix: string
  diffSuffix: string
}) {
  return (
    <div className="grid grid-cols-[minmax(110px,1fr)_minmax(90px,1fr)_minmax(90px,1fr)_80px] items-center border-b border-border/50 px-3 py-2.5 text-[12px] last:border-0">
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-right font-mono text-foreground" title={base?.date ?? 'No data'}>{fmtCell(base, cellSuffix)}</span>
      <span className="text-right font-mono text-foreground" title={quote?.date ?? 'No data'}>{fmtCell(quote, cellSuffix)}</span>
      <span className={`text-right font-mono ${diff == null ? 'text-muted-foreground' : diff >= 0 ? 'text-success' : 'text-destructive'}`}>
        {diff == null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}${diffSuffix}`}
      </span>
    </div>
  )
}

function DeskLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
    >
      {label} →
    </button>
  )
}
