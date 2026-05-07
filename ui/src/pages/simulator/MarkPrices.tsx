/**
 * MarkPrices panel — observation + inline action surface for per-symbol
 * mark prices. Per-row keyboard shortcuts (↑/↓ for ±1%, Shift+↑/↓ for ±5%)
 * make rapid PnL-walking ergonomic without leaving the keyboard.
 *
 * Visual feedback: when a price changes (whether via local action or via
 * a polled state update), the row briefly tints to give "yes, the value
 * moved" affirmation.
 */

import { useEffect, useRef, useState } from 'react'
import { Section } from '../../components/form'
import { simulatorApi, type SimulatorState } from '../../api/simulator'

const inputClass =
  'w-full px-2 py-1 bg-bg text-text border border-border rounded font-mono text-xs outline-none transition-colors focus:border-accent'

const FLASH_MS = 500

export function MarkPrices({ utaId, state, run, loading }: {
  utaId: string
  state: SimulatorState
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newPrice, setNewPrice] = useState('')

  // Track per-key "last seen price" so we can detect changes between renders
  // and flash the row when it moves.
  const lastSeenRef = useRef<Map<string, string>>(new Map())
  const [flashes, setFlashes] = useState<Record<string, 'up' | 'down'>>({})

  useEffect(() => {
    const next: Record<string, 'up' | 'down'> = {}
    let dirty = false
    for (const m of state.markPrices) {
      const prev = lastSeenRef.current.get(m.nativeKey)
      if (prev !== undefined && prev !== m.price) {
        next[m.nativeKey] = Number(m.price) >= Number(prev) ? 'up' : 'down'
        dirty = true
      }
      lastSeenRef.current.set(m.nativeKey, m.price)
    }
    if (!dirty) return
    setFlashes((cur) => ({ ...cur, ...next }))
    const timer = setTimeout(() => {
      setFlashes((cur) => {
        const after = { ...cur }
        for (const k of Object.keys(next)) delete after[k]
        return after
      })
    }, FLASH_MS)
    return () => clearTimeout(timer)
  }, [state.markPrices])

  // Sync drafts: only retain in-flight user edits.
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, string> = {}
      for (const m of state.markPrices) {
        if (prev[m.nativeKey] !== undefined) next[m.nativeKey] = prev[m.nativeKey]
      }
      return next
    })
  }, [state.markPrices])

  const dropDraft = (key: string) => setDrafts((d) => {
    const next = { ...d }
    delete next[key]
    return next
  })

  const tick = (key: string, deltaPercent: number) => run(
    `${key} ${deltaPercent > 0 ? '+' : ''}${deltaPercent}%`,
    async () => {
      await simulatorApi.tickPrice(utaId, key, deltaPercent)
      dropDraft(key)
    },
  )

  const setPrice = (key: string, value: string) => run(
    `Set ${key} = ${value}`,
    async () => {
      await simulatorApi.setMarkPrice(utaId, key, value)
      dropDraft(key)
    },
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, key: string) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const sign = e.key === 'ArrowUp' ? 1 : -1
      const magnitude = e.shiftKey ? 5 : 1
      tick(key, sign * magnitude)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setPrice(key, drafts[key] ?? state.markPrices.find(m => m.nativeKey === key)?.price ?? '')
    }
  }

  const flashClass = (key: string): string => {
    const f = flashes[key]
    if (!f) return ''
    return f === 'up' ? 'bg-green/10' : 'bg-red/10'
  }

  return (
    <Section
      title="Mark Prices"
      description="Per-symbol mark price. Editing or ticking auto-matches any pending limit/stop order whose trigger the new price crosses. Focus a price input and press ↑/↓ for ±1%, Shift+↑/↓ for ±5%."
    >
      <div className="space-y-1">
        {state.markPrices.length === 0 ? (
          <p className="text-xs text-text-muted">No prices set yet — add one below.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted text-xs">
                <th className="pb-1 pr-3">Symbol</th>
                <th className="pb-1 pr-3 w-40">Price</th>
                <th className="pb-1 text-right">Quick</th>
              </tr>
            </thead>
            <tbody>
              {state.markPrices.map((m) => (
                <tr
                  key={m.nativeKey}
                  className={`text-text transition-colors duration-500 ${flashClass(m.nativeKey)}`}
                >
                  <td className="py-1 pr-3 font-mono text-xs">{m.nativeKey}</td>
                  <td className="py-1 pr-3">
                    <input
                      className={inputClass}
                      value={drafts[m.nativeKey] ?? m.price}
                      onChange={(e) => setDrafts({ ...drafts, [m.nativeKey]: e.target.value })}
                      onKeyDown={(e) => handleKeyDown(e, m.nativeKey)}
                    />
                  </td>
                  <td className="py-1 text-right space-x-1">
                    <button disabled={loading} onClick={() => tick(m.nativeKey, -5)} className="btn-secondary-xs">−5%</button>
                    <button disabled={loading} onClick={() => tick(m.nativeKey, -1)} className="btn-secondary-xs">−1%</button>
                    <button disabled={loading} onClick={() => tick(m.nativeKey, 1)} className="btn-secondary-xs">+1%</button>
                    <button disabled={loading} onClick={() => tick(m.nativeKey, 5)} className="btn-secondary-xs">+5%</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <input
            className={`${inputClass} w-44`}
            placeholder="symbol (e.g. BTC)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.trim())}
          />
          <input
            className={`${inputClass} w-32`}
            placeholder="price"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
          <button
            disabled={loading || !newKey || !newPrice}
            onClick={() => run(
              `Add ${newKey} = ${newPrice}`,
              async () => {
                await simulatorApi.setMarkPrice(utaId, newKey, newPrice)
                setNewKey('')
                setNewPrice('')
              },
            )}
            className="btn-primary-sm"
          >Add</button>
        </div>
      </div>
    </Section>
  )
}
