/**
 * Positions panel — read-only view of current holdings, joined with
 * mark prices to render live PnL. Mutates only via mark price moves,
 * order fills, or external events from the action panel.
 */

import { useMemo } from 'react'
import { Section } from '../../components/form'
import type { SimulatorState, SimulatorPosition } from '../../api/simulator'
import { describeInstrument } from './instruments'

/** Compose the display name from contract metadata; falls back to nativeKey. */
function describePosition(p: SimulatorPosition): string {
  return describeInstrument({
    symbol: p.symbol,
    secType: p.secType,
    lastTradeDateOrContractMonth: p.expiry,
    strike: p.strike,
    right: p.right as 'C' | 'P' | 'CALL' | 'PUT' | undefined,
    multiplier: p.multiplier,
  })
}

export function Positions({ state }: { state: SimulatorState }) {
  const markByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const mp of state.markPrices) m.set(mp.nativeKey, mp.price)
    return m
  }, [state.markPrices])

  return (
    <Section
      title="Positions"
      description="Read-only — mutate via mark price moves, order fills, or external events."
    >
      {state.positions.length === 0 ? (
        <p className="text-xs text-text-muted">No positions.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted text-xs">
              <th className="pb-1 pr-3">Position</th>
              <th className="pb-1 pr-3 text-right">Qty</th>
              <th className="pb-1 pr-3 text-right">Avg Cost</th>
              <th className="pb-1 pr-3 text-right">Mark</th>
              <th className="pb-1 text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {state.positions.map((p) => {
              const mark = markByKey.get(p.nativeKey)
              const qty = Number(p.quantity)
              const avg = Number(p.avgCost)
              // Match IBroker.Position contract: PnL is multiplier-applied.
              // Defaults to 1 for stocks / crypto; OPT typically ×100; futures vary.
              const mult = p.multiplier ? Number(p.multiplier) || 1 : 1
              const pnl = mark && Number.isFinite(qty) && Number.isFinite(avg)
                ? (Number(mark) - avg) * qty * mult * (p.side === 'long' ? 1 : -1)
                : null
              const pnlClass = pnl == null ? 'text-text-muted' : pnl > 0 ? 'text-[var(--oa-market-positive)]' : pnl < 0 ? 'text-[var(--oa-market-negative)]' : 'text-text'
              return (
                <tr key={p.nativeKey} className="text-text">
                  <td className="py-1 pr-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-text">{describePosition(p)}</span>
                      {p.secType && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-bg-tertiary text-text-muted/80">{p.secType}</span>
                      )}
                      <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-[var(--oa-market-buy)]/15 text-[var(--oa-market-buy)]' : 'bg-[var(--oa-market-sell)]/15 text-[var(--oa-market-sell)]'}`}>
                        {p.side}
                      </span>
                      {p.multiplier && p.multiplier !== '1' && (
                        <span className="text-[9px] text-text-muted/60" title={`Each contract = ${p.multiplier} units`}>×{p.multiplier}</span>
                      )}
                      {p.avgCostSource === 'wallet' && (
                        <span className="text-[9px] text-text-muted/60" title="Cost basis derived from UTA reconcile pipeline (wallet-source position)">wallet</span>
                      )}
                    </div>
                  </td>
                  <td className="py-1 pr-3 font-mono text-xs text-right">{p.quantity}</td>
                  <td className="py-1 pr-3 font-mono text-xs text-right">{p.avgCost}</td>
                  <td className="py-1 pr-3 font-mono text-xs text-right text-text-muted">{mark ?? '—'}</td>
                  <td className={`py-1 font-mono text-xs text-right transition-colors duration-300 ${pnlClass}`}>
                    {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Section>
  )
}
