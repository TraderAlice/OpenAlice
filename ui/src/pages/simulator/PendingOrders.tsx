/**
 * PendingOrders panel — limit/stop orders waiting on a price trigger or
 * manual fill. Adds a "distance" column = `current mark − trigger price`,
 * giving a one-glance read on how close each order is to firing.
 */

import { useMemo, useState } from 'react'
import { Section, inputClass as sharedInputClass } from '../../components/form'
import { simulatorApi, type SimulatorState } from '../../api/simulator'
import { Button } from '../../components/ui/button'

const inputClass =
  `${sharedInputClass} min-h-8 py-1 font-mono text-xs`

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
    <Section title="Pending Orders">
      {state.pendingOrders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pending orders.</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pending orders">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs">
                <th scope="col" className="pb-1 pr-3">Order</th>
                <th scope="col" className="pb-1 pr-3">Symbol</th>
                <th scope="col" className="pb-1 pr-3">Side</th>
                <th scope="col" className="pb-1 pr-3">Type</th>
                <th scope="col" className="pb-1 pr-3 text-right">Qty</th>
                <th scope="col" className="pb-1 pr-3 text-right">Trigger</th>
                <th scope="col" className="pb-1 pr-3 text-right">Distance</th>
                <th scope="col" className="pb-1 pr-3 w-32">Fill price (opt)</th>
                <th scope="col" className="pb-1 pr-3 w-24">Fill qty (opt)</th>
                <th scope="col" className="pb-1 text-right">Actions</th>
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
                  <tr key={o.orderId} className="text-foreground">
                    <td className="py-1 pr-3 font-mono text-sm leading-5">{o.orderId}</td>
                    <td className="py-1 pr-3">{o.symbol}</td>
                    <td className="py-1 pr-3">{o.action}</td>
                    <td className="py-1 pr-3">{o.orderType}</td>
                    <td className="py-1 pr-3 font-mono text-xs text-right tabular-nums">{o.totalQuantity}</td>
                    <td className="py-1 pr-3 font-mono text-xs text-right tabular-nums">{trigger ?? '—'}</td>
                    <td className={`py-1 pr-3 font-mono text-xs text-right tabular-nums ${closeToFire ? 'text-warning' : 'text-muted-foreground'}`}>
                      {distance == null ? '—' : `${distance >= 0 ? '+' : ''}${distance.toFixed(2)}`}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      <input
                        className={`${inputClass} tabular-nums`}
                        placeholder="markPrice"
                        aria-label={`Fill price for order ${o.orderId}`}
                        value={form.price}
                        onChange={(e) => updateForm(o.orderId, 'price', e.target.value)}
                      />
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      <input
                        className={`${inputClass} tabular-nums`}
                        placeholder="full"
                        aria-label={`Fill quantity for order ${o.orderId}`}
                        value={form.qty}
                        onChange={(e) => updateForm(o.orderId, 'qty', e.target.value)}
                      />
                    </td>
                    <td className="py-1 text-right space-x-1">
                      <Button
                        type="button"
                        disabled={loading}
                        onClick={() => run(
                          `Fill ${o.orderId}`,
                          () => simulatorApi.fillOrder(utaId, o.orderId, {
                            ...(form.price && { price: form.price }),
                            ...(form.qty && { qty: form.qty }),
                          }),
                        )}
                        variant="outline"
                        size="xs"
                      >Fill</Button>
                      <Button
                        type="button"
                        disabled={loading}
                        onClick={() => run(`Cancel ${o.orderId}`, () => simulatorApi.cancelOrder(utaId, o.orderId))}
                        variant="outline"
                        size="xs"
                        aria-label={`Cancel order ${o.orderId}`}
                      >×</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
