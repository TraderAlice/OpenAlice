/**
 * Positions panel — read-only view of current holdings, joined with
 * mark prices to render live PnL. Mutates only via mark price moves,
 * order fills, or external events from the action panel.
 */

import { useMemo } from 'react'
import { Section } from '../../components/form'
import type { SimulatorState } from '../../api/simulator'

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
              const pnl = mark && Number.isFinite(qty) && Number.isFinite(avg)
                ? (Number(mark) - avg) * qty * (p.side === 'long' ? 1 : -1)
                : null
              const pnlClass = pnl == null ? 'text-text-muted' : pnl > 0 ? 'text-green' : pnl < 0 ? 'text-red' : 'text-text'
              return (
                <tr key={p.nativeKey} className="text-text">
                  <td className="py-1 pr-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-xs">{p.nativeKey}</span>
                      {p.secType && (
                        <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-bg-tertiary text-text-muted/80">{p.secType}</span>
                      )}
                      <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
                        {p.side}
                      </span>
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
