/**
 * PendingOrders panel — limit/stop orders waiting on a price trigger or
 * manual fill. Adds a "distance" column = `current mark − trigger price`,
 * giving a one-glance read on how close each order is to firing.
 */

import { useMemo, useState } from 'react'
import { Section } from '../../components/form'
import { simulatorApi, type SimulatorState } from '../../api/simulator'

const inputClass =
  'w-full px-2 py-1 bg-bg text-text border border-border rounded font-mono text-xs outline-none transition-colors focus:border-accent'

export function PendingOrders({ utaId, state, run, loading }: {
  utaId: string
  state: SimulatorState
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [fillForms, setFillForms] = useState<Record<string, { price: string; qty: string }>>({})
  const updateForm = (id: string, field: 'price' | 'qty', value: string) => {
    setFillForms({ ...fillForms, [id]: { ...(fillForms[id] ?? { price: '', qty: '' }), [field]: value } })
  }

  const markByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const mp of state.markPrices) m.set(mp.nativeKey, mp.price)
    return m
  }, [state.markPrices])

  return (
    <Section
      title="Pending Orders"
      description="Submitted limit/stop orders waiting on a price trigger or manual fill."
    >
      {state.pendingOrders.length === 0 ? (
        <p className="text-xs text-text-muted">No pending orders.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted text-xs">
              <th className="pb-1 pr-3">Order</th>
              <th className="pb-1 pr-3">Symbol</th>
              <th className="pb-1 pr-3">Side</th>
              <th className="pb-1 pr-3">Type</th>
              <th className="pb-1 pr-3 text-right">Qty</th>
              <th className="pb-1 pr-3 text-right">Trigger</th>
              <th className="pb-1 pr-3 text-right">Distance</th>
              <th className="pb-1 pr-3 w-32">Fill price (opt)</th>
              <th className="pb-1 pr-3 w-24">Fill qty (opt)</th>
              <th className="pb-1 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.pendingOrders.map((o) => {
              const form = fillForms[o.orderId] ?? { price: '', qty: '' }
              const trigger = o.lmtPrice ?? o.auxPrice
              const mark = markByKey.get(o.nativeKey)
              const distance = trigger && mark ? Number(mark) - Number(trigger) : null
              // Pct vs trigger — < 1% lights yellow as "about to fire".
              const distancePct = distance != null && trigger ? Math.abs(distance) / Number(trigger) : null
              const closeToFire = distancePct != null && distancePct < 0.01
              return (
                <tr key={o.orderId} className="text-text">
                  <td className="py-1 pr-3 font-mono text-[11px]">{o.orderId}</td>
                  <td className="py-1 pr-3">{o.symbol}</td>
                  <td className="py-1 pr-3">{o.action}</td>
                  <td className="py-1 pr-3">{o.orderType}</td>
                  <td className="py-1 pr-3 font-mono text-xs text-right">{o.totalQuantity}</td>
                  <td className="py-1 pr-3 font-mono text-xs text-right">{trigger ?? '—'}</td>
                  <td className={`py-1 pr-3 font-mono text-xs text-right ${closeToFire ? 'text-yellow-400' : 'text-text-muted'}`}>
                    {distance == null ? '—' : `${distance >= 0 ? '+' : ''}${distance.toFixed(2)}`}
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      className={inputClass}
                      placeholder="markPrice"
                      value={form.price}
                      onChange={(e) => updateForm(o.orderId, 'price', e.target.value)}
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      className={inputClass}
                      placeholder="full"
                      value={form.qty}
                      onChange={(e) => updateForm(o.orderId, 'qty', e.target.value)}
                    />
                  </td>
                  <td className="py-1 text-right space-x-1">
                    <button
                      disabled={loading}
                      onClick={() => run(
                        `Fill ${o.orderId}`,
                        () => simulatorApi.fillOrder(utaId, o.orderId, {
                          ...(form.price && { price: form.price }),
                          ...(form.qty && { qty: form.qty }),
                        }),
                      )}
                      className="btn-secondary-xs"
                    >Fill</button>
                    <button
                      disabled={loading}
                      onClick={() => run(`Cancel ${o.orderId}`, () => simulatorApi.cancelOrder(utaId, o.orderId))}
                      className="btn-secondary-xs"
                    >×</button>
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
