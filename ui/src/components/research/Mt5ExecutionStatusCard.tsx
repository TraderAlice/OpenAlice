import { Radio, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react'
import type { JmbExecutionStatusSummary, JmbResearchExecutionState } from '../../api/research'

function readable(value: string): string {
  return value.replaceAll('_', ' ')
}

function stateTone(state: JmbResearchExecutionState): string {
  if (state === 'filled_protected') return 'border-green/30 bg-green/10 text-green'
  if (state === 'ready') return 'border-accent/30 bg-accent/10 text-accent'
  if (state === 'disabled' || state === 'demo_blocked' || state === 'missing') return 'border-border bg-bg-tertiary text-text-muted'
  if (state === 'paused' || state === 'stale') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
  return 'border-red/30 bg-red/10 text-red'
}

function price(value: number): string {
  return value.toFixed(value >= 100 ? 2 : 5)
}

export function Mt5ExecutionStatusCard({ execution }: { execution: JmbExecutionStatusSummary }) {
  const hasProtectedExposure = execution.position && execution.stopProtectionConfirmed

  return (
    <section aria-label="MT5 demo execution status" className="border border-border rounded-md bg-bg overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 bg-bg-secondary">
        <div className="flex min-w-0 items-center gap-2">
          <Radio size={13} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="text-micro uppercase tracking-[0.14em] text-text-muted">MT5 execution monitor</span>
          <span className="shrink-0 border border-yellow-500/35 bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-yellow-300">DEMO ONLY</span>
        </div>
        <strong className={`shrink-0 rounded-sm border px-2 py-1 font-mono text-[10px] tracking-[0.08em] ${stateTone(execution.state)}`}>
          {execution.label}
        </strong>
      </div>

      <div className="px-3 py-3">
        <p className="text-micro leading-relaxed text-text-muted">{execution.detail}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
          <span className="text-text">{readable(execution.rolloutStage).toUpperCase()}</span>
          <span aria-hidden="true">/</span>
          <span className={execution.executionEnabled ? 'text-green' : 'text-text-muted'}>EXECUTION {execution.executionEnabled ? 'ON' : 'OFF'}</span>
          <span aria-hidden="true">/</span>
          <span className={execution.killSwitch ? 'text-yellow-300' : 'text-text-muted'}>KILL {execution.killSwitch ? 'ON' : 'OFF'}</span>
          {execution.server ? <><span aria-hidden="true">/</span><span className="normal-case tracking-normal">{execution.server}</span></> : null}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
          <div className="bg-bg-secondary px-2.5 py-2">
            <dt className="text-[9px] uppercase tracking-[0.12em] text-text-muted">Latest event</dt>
            <dd className="mt-1 truncate font-mono text-[11px] text-text" title={execution.latestEvent?.detail}>
              {execution.latestEvent ? `${readable(execution.latestEvent.type)} · ${execution.latestEvent.resultCode}` : 'none recorded'}
            </dd>
          </div>
          <div className="bg-bg-secondary px-2.5 py-2">
            <dt className="text-[9px] uppercase tracking-[0.12em] text-text-muted">Stop protection</dt>
            <dd className={`mt-1 flex items-center gap-1 font-mono text-[11px] ${execution.stopProtectionConfirmed ? 'text-green' : 'text-text-muted'}`}>
              {execution.stopProtectionConfirmed ? <ShieldCheck size={12} aria-hidden="true" /> : <ShieldX size={12} aria-hidden="true" />}
              {execution.stopProtectionConfirmed ? 'STOP CONFIRMED' : 'not confirmed'}
            </dd>
          </div>
          <div className="bg-bg-secondary px-2.5 py-2">
            <dt className="text-[9px] uppercase tracking-[0.12em] text-text-muted">EA exposure</dt>
            <dd className={`mt-1 truncate font-mono text-[11px] ${hasProtectedExposure ? 'text-text' : 'text-text-muted'}`}>
              {execution.position
                ? `${execution.position.direction.toUpperCase()} ${execution.position.volume} @ ${price(execution.position.openPrice)} · SL ${price(execution.position.stopLoss)}`
                : 'none'}
            </dd>
          </div>
          <div className="bg-bg-secondary px-2.5 py-2">
            <dt className="text-[9px] uppercase tracking-[0.12em] text-text-muted">Broker-day loss</dt>
            <dd className="mt-1 font-mono text-[11px] text-text">{execution.dailyLossCount} losing / {execution.dailyRealizedLoss.toFixed(2)}</dd>
          </div>
        </dl>

        <div className="mt-3 grid gap-1.5 text-micro sm:grid-cols-2">
          <p className="flex items-start gap-1.5 text-text-muted">
            {execution.blockingGate ? <TriangleAlert size={12} className="mt-0.5 shrink-0 text-yellow-300" aria-hidden="true" /> : <ShieldCheck size={12} className="mt-0.5 shrink-0 text-green" aria-hidden="true" />}
            <span>{execution.blockingGate ? `Blocked by: ${readable(execution.blockingGate)}` : `Reconciliation: ${readable(execution.reconciliationState)}`}</span>
          </p>
          <p className="text-text-muted sm:text-right"><span className="text-text">Next:</span> {execution.nextSafeAction}</p>
        </div>
      </div>
    </section>
  )
}
