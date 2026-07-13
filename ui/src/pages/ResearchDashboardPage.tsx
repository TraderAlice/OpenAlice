import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Database, FlaskConical, Radio, RefreshCw, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { researchApi, type ResearchDashboard, type ResearchInstrument } from '../api/research'

function percentage(value: number | null | undefined): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`
}

function compactBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function dateTime(value: string | null): string {
  if (!value) return 'not exported'
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function bridgePrice(value: number | null): string {
  if (value == null) return 'n/a'
  return value.toFixed(value >= 100 ? 2 : 5)
}

function toneClass(tone: ResearchInstrument['evidence']['tone']): string {
  if (tone === 'red') return 'border-red/30 bg-red/10 text-red'
  if (tone === 'amber') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
  return 'border-border bg-bg-tertiary text-text-muted'
}

function qualityToneClass(tone: ResearchInstrument['quality']['tone']): string {
  if (tone === 'green') return 'border-green/30 bg-green/10 text-green'
  return toneClass(tone)
}

function bridgeToneClass(state: ResearchInstrument['bridge']['state']): string {
  if (state === 'ready') return 'border-green/30 bg-green/10 text-green'
  if (state === 'awaiting_bridge') return 'border-border bg-bg-tertiary text-text-muted'
  return 'border-red/30 bg-red/10 text-red'
}

function learningTone(state: string): ResearchInstrument['quality']['tone'] {
  if (state === 'learning') return 'green'
  if (state === 'blocked') return 'red'
  if (state === 'stale') return 'amber'
  return 'muted'
}

function stageClass(state: ResearchDashboard['stages'][number]['state']): string {
  if (state === 'complete') return 'bg-green text-bg'
  if (state === 'next') return 'bg-accent text-bg'
  if (state === 'blocked') return 'bg-red text-white'
  return 'bg-border text-text-muted'
}

function InstrumentStudy({ instrument }: { instrument: ResearchInstrument }) {
  const report = instrument.report
  const walkForward = instrument.walkForward
  const bridge = instrument.bridge
  const observation = report?.latest_observation
  const isUp = observation?.direction === 'uptrend'
  const isDown = observation?.direction === 'downtrend'

  return (
    <article className="border border-border bg-bg-secondary rounded-lg overflow-hidden min-w-0">
      <div className="px-4 py-4 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-micro uppercase text-text-muted tracking-[0.14em]">{instrument.broker}</div>
          <h3 className="mt-1 text-title text-text">{instrument.symbol}</h3>
          <p className="mt-0.5 text-caption text-text-muted">{instrument.label}</p>
        </div>
        <span className={`shrink-0 px-2 py-1 text-micro rounded border ${toneClass(instrument.evidence.tone)}`}>
          {instrument.evidence.label}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {observation ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-micro uppercase text-text-muted tracking-[0.14em]">Latest completed trend</div>
              <div className={`mt-1 flex items-center gap-1.5 text-[20px] font-semibold ${isUp ? 'text-green' : isDown ? 'text-red' : 'text-text-muted'}`}>
                {isUp ? <ArrowUpRight size={20} /> : isDown ? <ArrowDownRight size={20} /> : <Activity size={18} />}
                {observation.direction}
              </div>
            </div>
            <div className="text-right">
              <div className="text-body font-mono text-text">{percentage(observation.lookback_return)}</div>
              <div className="text-micro text-text-muted">{observation.lookback_days}d lookback · {observation.as_of}</div>
            </div>
          </div>
        ) : (
          <div className="py-2 text-body text-text-muted">No completed baseline is available for this broker yet.</div>
        )}

        <div className="grid grid-cols-2 gap-px bg-border border border-border rounded-md overflow-hidden">
          <Metric label="Training lookback" value={report ? `${report.selected_on_training_sharpe.lookback_days}d` : '—'} />
          <Metric label="Holdout return" value={percentage(report?.untouched_holdout.total_return)} emphasis={report && (report.untouched_holdout.total_return ?? 0) > 0 ? 'green' : 'red'} />
          <Metric label="Holdout Sharpe" value={report?.untouched_holdout.sharpe?.toFixed(2) ?? '—'} />
          <Metric label="Max drawdown" value={percentage(report?.untouched_holdout.max_drawdown)} emphasis="red" />
        </div>

        <div className="border border-accent/20 rounded-md px-3 py-3 bg-accent/5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro uppercase tracking-[0.14em] text-text-muted">Walk-forward evidence</span>
            <span className="text-micro text-accent font-mono">{walkForward ? `${walkForward.windows.length} unseen windows` : 'not run'}</span>
          </div>
          {walkForward ? (
            <div className="mt-2 grid grid-cols-3 gap-2 text-micro">
              <span className="text-text-muted">{walkForward.method.training_months}m train / {walkForward.method.test_months}m test</span>
              <span className="font-mono text-text text-center">{percentage(walkForward.out_of_sample_aggregate.total_return)}</span>
              <span className="font-mono text-text text-right">Sharpe {walkForward.out_of_sample_aggregate.sharpe?.toFixed(2) ?? 'n/a'}</span>
            </div>
          ) : <p className="mt-2 text-micro text-text-muted">Sequential unseen-period testing has not been recorded yet.</p>}
        </div>

        <div className="border border-border rounded-md px-3 py-3 bg-bg">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro uppercase tracking-[0.14em] text-text-muted">Data quality</span>
            <span className={`shrink-0 px-2 py-0.5 text-micro rounded border ${qualityToneClass(instrument.quality.tone)}`}>{instrument.quality.label}</span>
          </div>
          <p className="mt-2 text-micro text-text-muted leading-relaxed">
            {instrument.quality.inspectedFiles} monthly files inspected · {instrument.quality.likelyM1Files} likely M1
            {instrument.quality.fallbackFiles > 0 ? ` · ${instrument.quality.fallbackFiles} fallback-resolution files excluded from M1-only work` : ''}
            {instrument.quality.badRows > 0 || instrument.quality.duplicateRows > 0 ? ` · ${instrument.quality.badRows} malformed, ${instrument.quality.duplicateRows} duplicates` : ''}
          </p>
        </div>

        <div className="border border-border rounded-md px-3 py-3 bg-bg-secondary">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-micro uppercase tracking-[0.14em] text-text-muted"><Radio size={12} /> MT5 demo bridge</span>
            <span className={`shrink-0 px-2 py-0.5 text-micro rounded border ${bridgeToneClass(bridge.state)}`}>{bridge.label}</span>
          </div>
          {bridge.state === 'ready' ? (
            <p className="mt-2 text-micro text-text-muted leading-relaxed">
              {bridge.server} · terminal symbol {bridge.symbol} · bid {bridgePrice(bridge.bid)} / ask {bridgePrice(bridge.ask)} · spread {bridgePrice(bridge.spread)} · {bridge.openPositions ?? 0} positions
            </p>
          ) : <p className="mt-2 text-micro text-text-muted leading-relaxed">{bridge.detail}</p>}
        </div>

        <div className="border border-border rounded-md px-3 py-3 bg-bg-secondary">
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro uppercase tracking-[0.14em] text-text-muted">Trade-history learning</span>
            <span className={`shrink-0 px-2 py-0.5 text-micro rounded border ${qualityToneClass(learningTone(instrument.learning.state))}`}>{instrument.learning.label}</span>
          </div>
          <p className="mt-2 text-micro text-text-muted leading-relaxed">{instrument.learning.detail}</p>
          <p className="mt-2 text-micro text-text-muted leading-relaxed">
            Deals: {instrument.learning.totalDeals} Â· Manual: {instrument.learning.manualDeals} Â· EA: {instrument.learning.eaDeals} Â· Net: {instrument.learning.netProfit.toFixed(2)}
          </p>
        </div>

        <div className="flex items-center justify-between text-micro text-text-muted border-t border-border/70 pt-3">
          <span>{instrument.export.available ? `${instrument.export.files} monthly files · ${compactBytes(instrument.export.totalBytes)}` : 'No export found'}</span>
          <span>{dateTime(instrument.export.lastUpdated)}</span>
        </div>
      </div>
    </article>
  )
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: 'green' | 'red' }) {
  return (
    <div className="bg-bg px-3 py-2.5 min-w-0">
      <div className="text-micro text-text-muted truncate">{label}</div>
      <div className={`mt-1 font-mono text-body ${emphasis === 'green' ? 'text-green' : emphasis === 'red' ? 'text-red' : 'text-text'}`}>{value}</div>
    </div>
  )
}

function ExperimentLedger({ experiments }: { experiments: ResearchDashboard['experiments'] }) {
  if (experiments.length === 0) {
    return (
      <section className="border border-dashed border-border rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 text-title text-text"><BarChart3 size={16} className="text-accent" /> Fixed-matrix experiment ledger</div>
        <p className="mt-2 text-body text-text-muted">No experiment run has been recorded yet. Runs compare the same declared parameter and cost cases over sequential unseen windows; they do not search for a target win rate.</p>
      </section>
    )
  }

  return (
    <section className="border border-border rounded-lg overflow-hidden bg-bg-secondary">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-title text-text"><BarChart3 size={16} className="text-accent" /> Fixed-matrix experiment ledger</div>
          <p className="mt-1 text-micro text-text-muted">Historical research only · return bars are out-of-sample · red drawdown alerts require review, not another optimisation cycle.</p>
        </div>
        <span className="shrink-0 font-mono text-micro text-accent">{experiments.length} logged run{experiments.length === 1 ? '' : 's'}</span>
      </div>
      <div className="divide-y divide-border/70">
        {experiments.map((run) => {
          const maximum = Math.max(0.01, ...run.scenarios.map((scenario) => Math.abs(scenario.out_of_sample.total_return ?? 0)))
          return (
            <div key={run.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="text-body font-medium text-text">{run.broker} · {run.symbol} <span className="font-normal text-text-muted">{run.data.first_eligible_day} → {run.data.last_day}</span></div>
                <div className="font-mono text-micro text-text-muted">{dateTime(run.created_at)} · {run.data.daily_bars} daily bars</div>
              </div>
              <div className="mt-3 space-y-2">
                {run.scenarios.map((scenario) => {
                  const totalReturn = scenario.out_of_sample.total_return ?? 0
                  const drawdown = scenario.out_of_sample.max_drawdown
                  const width = `${Math.max(3, Math.min(100, Math.abs(totalReturn) / maximum * 100))}%`
                  const positive = totalReturn >= 0
                  const drawdownExceeded = drawdown != null && Math.abs(drawdown) > run.method.drawdown_review_alert
                  return (
                    <div key={scenario.id} className="grid grid-cols-[112px_minmax(0,1fr)_84px] items-center gap-3 text-micro">
                      <div className="font-mono text-text-muted truncate" title={`${scenario.lookbacks.join(', ')} day lookbacks`}>{scenario.id}</div>
                      <div className="h-5 rounded-sm overflow-hidden bg-bg border border-border flex items-center">
                        <div className={`h-full ${positive ? 'bg-green/70' : 'bg-red/70'}`} style={{ width }} />
                        <span className="ml-2 font-mono text-text whitespace-nowrap">{percentage(totalReturn)} · Sharpe {scenario.out_of_sample.sharpe?.toFixed(2) ?? 'n/a'} · {scenario.unseen_windows} windows</span>
                      </div>
                      <div className={`font-mono text-right ${drawdownExceeded ? 'text-red' : 'text-text-muted'}`}>DD {percentage(drawdown)}</div>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-micro text-text-muted">{run.warning}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function ResearchDashboardPage() {
  const [dashboard, setDashboard] = useState<ResearchDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setError(null)
      const next = await researchApi.get()
      setDashboard(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load research status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const hfm = useMemo(() => dashboard?.instruments.filter((instrument) => instrument.broker === 'hfmarkets') ?? [], [dashboard])
  const icMarkets = useMemo(() => dashboard?.instruments.filter((instrument) => instrument.broker === 'icmarkets') ?? [], [dashboard])

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-bg">
      <PageHeader
        title="Research Desk"
        description="Local evidence ledger · no broker orders enabled"
        live={{ lastUpdated: dashboard ? new Date(dashboard.asOf) : null }}
        right={<button onClick={() => void load()} className="btn-secondary-sm inline-flex items-center gap-1.5" title="Refresh research data"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {error ? <div className="border border-red/30 bg-red/10 text-red rounded-md px-4 py-3 text-body">{error}</div> : null}
        {!dashboard && loading ? <div className="text-body text-text-muted py-10">Loading local research artifacts…</div> : null}
        {dashboard ? (
          <div className="max-w-[1440px] mx-auto space-y-6">
            <section className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] border border-border rounded-lg overflow-hidden bg-bg-secondary">
              <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
                <div className="flex items-center gap-2 text-micro uppercase tracking-[0.16em] text-accent"><FlaskConical size={14} /> Research-only mode</div>
                <h3 className="mt-3 text-[22px] font-semibold text-text leading-tight">Evidence before automation.</h3>
                <p className="mt-2 text-body text-text-muted max-w-2xl">The dashboard tracks what has actually been exported, tested, rejected, or still needs proof. It does not calculate a promise of profit and it cannot send orders.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 bg-bg">
                <SummaryStat label="Data feeds" value={String(dashboard.summary.instrumentsWithData)} />
                <SummaryStat label="MT5 bridge" value={`${dashboard.summary.readyDemoBridges}/4`} />
                <SummaryStat label="Experiment runs" value={String(dashboard.summary.experimentRuns)} />
                <SummaryStat label="Trading" value="OFF" red />
              </div>
            </section>

            <ExperimentLedger experiments={dashboard.experiments} />

            <section>
              <div className="flex items-center gap-2 mb-3"><ShieldCheck size={16} className="text-accent" /><h3 className="text-title text-text">Validation path</h3></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                {dashboard.stages.map((stage, index) => (
                  <div key={stage.key} className="border border-border bg-bg-secondary rounded-md px-3 py-3 min-w-0">
                    <div className="flex items-center gap-2"><span className={`w-5 h-5 rounded-full flex items-center justify-center text-micro font-semibold ${stageClass(stage.state)}`}>{index + 1}</span><span className="text-body font-medium text-text truncate">{stage.label}</span></div>
                    <p className="mt-2 text-micro text-text-muted leading-relaxed">{stage.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3"><Database size={16} className="text-accent" /><h3 className="text-title text-text">HFM studies</h3></div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{hfm.map((instrument) => <InstrumentStudy key={`${instrument.broker}-${instrument.symbol}`} instrument={instrument} />)}</div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-3"><Database size={16} className="text-text-muted" /><h3 className="text-title text-text">IC Markets comparison</h3></div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{icMarkets.map((instrument) => <InstrumentStudy key={`${instrument.broker}-${instrument.symbol}`} instrument={instrument} />)}</div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-[0.7fr_1.3fr] gap-4 pb-8">
              <div className="border border-border bg-bg-secondary rounded-lg p-4">
                <div className="text-micro uppercase tracking-[0.14em] text-text-muted">Evidence meaning</div>
                <p className="mt-2 text-body text-text">{dashboard.disclaimer}</p>
                <p className="research-disclaimer mt-3 text-body text-text-muted">Trade-history learning imports manual and demo outcomes for review. It is not approval for live trading and it cannot submit orders.</p>
                <div className="mt-4 border-t border-border pt-3 text-micro text-text-muted">Data source: local MT5 exports. Last analysed candles, not streaming broker quotes.</div>
              </div>
              <div className="border border-border bg-bg-secondary rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between"><h3 className="text-title text-text">Recent news</h3><span className="text-micro text-text-muted">last 24 hours</span></div>
                {dashboard.news.length === 0 ? <div className="p-4 text-body text-text-muted">No collected news yet. Configure feeds in Settings → News Sources.</div> : <div className="divide-y divide-border/60">{dashboard.news.map((item, index) => <a key={`${item.time}-${index}`} href={item.link ?? undefined} target={item.link ? '_blank' : undefined} rel="noreferrer" className="block px-4 py-3 hover:bg-bg-tertiary/50 transition-colors"><div className="text-body text-text leading-snug">{item.title}</div><div className="mt-1 text-micro text-text-muted">{item.source ?? 'Unknown source'} · {new Date(item.time).toLocaleString()}</div></a>)}</div>}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SummaryStat({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return <div className="px-4 py-5 border-r last:border-r-0 border-border"><div className="text-micro uppercase tracking-[0.14em] text-text-muted">{label}</div><div className={`mt-2 font-mono text-[22px] font-semibold ${red ? 'text-red' : 'text-text'}`}>{value}</div></div>
}
