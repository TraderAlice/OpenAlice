/**
 * ActionPanel — sticky bottom dock with tabbed action surfaces.
 *
 * Tabs:
 *   1. Quick Tick      — symbol picker + tick buttons + set price input
 *   2. External Deposit — fund a position out of nowhere (bypasses orders)
 *   3. External Trade  — simulate user trading on the exchange app outside Alice
 *   4. Place Order     — go through the real Alice order pipeline (stage→commit→push)
 *
 * Every action funnels through `run(label, fn)` so the EventLog gets
 * uniform entries and state refresh is automatic. Tab content keeps its
 * own form state across tab switches so partial inputs aren't lost.
 */

import { useMemo, useState } from 'react'
import { api } from '../../api'
import { simulatorApi, type SimulatorState } from '../../api/simulator'

const inputClass =
  'px-2 py-1 bg-bg text-text border border-border rounded text-sm outline-none transition-colors focus:border-accent'
const inputClassMono =
  'px-2 py-1 bg-bg text-text border border-border rounded font-mono text-xs outline-none transition-colors focus:border-accent'

type TabId = 'tick' | 'deposit' | 'trade' | 'order'

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'tick',    label: 'Quick Tick',       hint: 'Move a mark price' },
  { id: 'deposit', label: 'External Deposit', hint: 'Funds appear outside Alice (airdrop / transfer-in)' },
  { id: 'trade',   label: 'External Trade',   hint: 'User manually traded on the exchange app' },
  { id: 'order',   label: 'Place Order',      hint: 'Stage → commit → push through Alice' },
]

export function ActionPanel({ utaId, state, run, loading }: {
  utaId: string
  state: SimulatorState
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [tab, setTab] = useState<TabId>('tick')
  const knownKeys = useMemo(() => {
    const set = new Set<string>()
    for (const m of state.markPrices) set.add(m.nativeKey)
    for (const p of state.positions) set.add(p.nativeKey)
    return [...set].sort()
  }, [state])

  return (
    <div className="sticky bottom-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-bg-secondary/95 backdrop-blur border-t border-border z-10">
      {/* Tab strip */}
      <div className="flex items-center gap-1 mb-3" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            title={`${t.hint} (${i + 1})`}
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tab === t.id
                ? 'bg-accent/20 text-accent font-medium'
                : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
            }`}
          >
            <span className="text-[10px] text-text-muted/60 mr-1.5">{i + 1}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'tick' && <QuickTickTab utaId={utaId} knownKeys={knownKeys} run={run} loading={loading} />}
      {tab === 'deposit' && <DepositTab utaId={utaId} knownKeys={knownKeys} run={run} loading={loading} />}
      {tab === 'trade' && <TradeTab utaId={utaId} knownKeys={knownKeys} run={run} loading={loading} />}
      {tab === 'order' && <OrderTab utaId={utaId} knownKeys={knownKeys} run={run} loading={loading} />}
    </div>
  )
}

// ==================== Quick Tick ====================

function QuickTickTab({ utaId, knownKeys, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [key, setKey] = useState(knownKeys[0] ?? '')
  const [setPriceInput, setSetPriceInput] = useState('')

  const tick = (deltaPercent: number) => {
    if (!key) return
    run(
      `${key} ${deltaPercent > 0 ? '+' : ''}${deltaPercent}%`,
      () => simulatorApi.tickPrice(utaId, key, deltaPercent),
    )
  }

  const setExact = () => {
    if (!key || !setPriceInput) return
    run(
      `Set ${key} = ${setPriceInput}`,
      async () => {
        await simulatorApi.setMarkPrice(utaId, key, setPriceInput)
        setSetPriceInput('')
      },
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder="symbol" />
      <span className="text-text-muted text-xs">Δ</span>
      <button disabled={loading || !key} onClick={() => tick(-5)} className="btn-secondary-sm">−5%</button>
      <button disabled={loading || !key} onClick={() => tick(-1)} className="btn-secondary-sm">−1%</button>
      <button disabled={loading || !key} onClick={() => tick(1)} className="btn-secondary-sm">+1%</button>
      <button disabled={loading || !key} onClick={() => tick(5)} className="btn-secondary-sm">+5%</button>
      <span className="text-text-muted/60 text-xs px-1">|</span>
      <input
        className={`${inputClassMono} w-32`}
        placeholder="set exact"
        value={setPriceInput}
        onChange={(e) => setSetPriceInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') setExact() }}
      />
      <button disabled={loading || !key || !setPriceInput} onClick={setExact} className="btn-primary-sm">Set</button>
    </div>
  )
}

// ==================== External Deposit ====================

function DepositTab({ utaId, knownKeys, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [key, setKey] = useState('')
  const [qty, setQty] = useState('')
  const [secType, setSecType] = useState<'CRYPTO' | 'CRYPTO_PERP' | 'STK'>('CRYPTO')
  const [mode, setMode] = useState<'in' | 'out'>('in')

  const submit = () => {
    if (!key || !qty) return
    if (mode === 'in') {
      run(
        `Deposit ${qty} ${key}`,
        async () => {
          await simulatorApi.externalDeposit(utaId, {
            nativeKey: key,
            quantity: qty,
            contract: { symbol: key, secType },
          })
          setQty('')
        },
      )
    } else {
      run(
        `Withdraw ${qty} ${key}`,
        async () => {
          await simulatorApi.externalWithdraw(utaId, key, qty)
          setQty('')
        },
      )
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded overflow-hidden border border-border">
        <button
          onClick={() => setMode('in')}
          className={`px-2 py-1 text-xs ${mode === 'in' ? 'bg-green/20 text-green' : 'text-text-muted hover:text-text'}`}
        >Deposit</button>
        <button
          onClick={() => setMode('out')}
          className={`px-2 py-1 text-xs ${mode === 'out' ? 'bg-red/20 text-red' : 'text-text-muted hover:text-text'}`}
        >Withdraw</button>
      </div>
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder="symbol" />
      <input
        className={`${inputClassMono} w-32`}
        placeholder="quantity"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />
      {mode === 'in' && (
        <select value={secType} onChange={(e) => setSecType(e.target.value as 'CRYPTO' | 'CRYPTO_PERP' | 'STK')} className={`${inputClass} w-32`}>
          <option value="CRYPTO">CRYPTO</option>
          <option value="CRYPTO_PERP">CRYPTO_PERP</option>
          <option value="STK">STK</option>
        </select>
      )}
      <button disabled={loading || !key || !qty} onClick={submit} className="btn-primary-sm">
        {mode === 'in' ? 'Deposit' : 'Withdraw'}
      </button>
      <span className="text-[11px] text-text-muted">Cash unchanged. Triggers UTA reconcile pipeline.</span>
    </div>
  )
}

// ==================== External Trade ====================

function TradeTab({ utaId, knownKeys, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [key, setKey] = useState('')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [secType, setSecType] = useState<'CRYPTO' | 'CRYPTO_PERP' | 'STK'>('CRYPTO')

  const submit = () => {
    if (!key || !qty || !price) return
    run(
      `External ${side} ${qty} ${key} @ ${price}`,
      async () => {
        await simulatorApi.externalTrade(utaId, {
          nativeKey: key,
          side,
          quantity: qty,
          price,
          contract: { symbol: key, secType },
        })
        setQty('')
      },
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded overflow-hidden border border-border">
        <button
          onClick={() => setSide('BUY')}
          className={`px-2 py-1 text-xs ${side === 'BUY' ? 'bg-green/20 text-green' : 'text-text-muted hover:text-text'}`}
        >BUY</button>
        <button
          onClick={() => setSide('SELL')}
          className={`px-2 py-1 text-xs ${side === 'SELL' ? 'bg-red/20 text-red' : 'text-text-muted hover:text-text'}`}
        >SELL</button>
      </div>
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder="symbol" />
      <input className={`${inputClassMono} w-28`} placeholder="qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      <input className={`${inputClassMono} w-28`} placeholder="price" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      <select value={secType} onChange={(e) => setSecType(e.target.value as 'CRYPTO' | 'CRYPTO_PERP' | 'STK')} className={`${inputClass} w-32`}>
        <option value="CRYPTO">CRYPTO</option>
        <option value="CRYPTO_PERP">CRYPTO_PERP</option>
        <option value="STK">STK</option>
      </select>
      <button disabled={loading || !key || !qty || !price} onClick={submit} className="btn-primary-sm">Submit</button>
      <span className="text-[11px] text-text-muted">Cash {side === 'BUY' ? '−' : '+'} qty × price.</span>
    </div>
  )
}

// ==================== Place Order (through Alice trading API) ====================

function OrderTab({ utaId, knownKeys, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [key, setKey] = useState('')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [orderType, setOrderType] = useState<'MKT' | 'LMT'>('MKT')
  const [qty, setQty] = useState('')
  const [lmtPrice, setLmtPrice] = useState('')

  const submit = () => {
    if (!key || !qty) return
    if (orderType === 'LMT' && !lmtPrice) return
    const aliceId = `${utaId}|${key}`
    const labelBits = [side, orderType, qty, key]
    if (orderType === 'LMT') labelBits.push(`@${lmtPrice}`)
    run(
      labelBits.join(' '),
      async () => {
        await api.trading.placeOrder(utaId, {
          aliceId,
          symbol: key,
          action: side,
          orderType,
          totalQuantity: qty,
          ...(orderType === 'LMT' && { lmtPrice }),
          message: `Simulator: ${labelBits.join(' ')}`,
        })
        setQty('')
        if (orderType === 'LMT') setLmtPrice('')
      },
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded overflow-hidden border border-border">
        <button onClick={() => setSide('BUY')} className={`px-2 py-1 text-xs ${side === 'BUY' ? 'bg-green/20 text-green' : 'text-text-muted hover:text-text'}`}>BUY</button>
        <button onClick={() => setSide('SELL')} className={`px-2 py-1 text-xs ${side === 'SELL' ? 'bg-red/20 text-red' : 'text-text-muted hover:text-text'}`}>SELL</button>
      </div>
      <select value={orderType} onChange={(e) => setOrderType(e.target.value as 'MKT' | 'LMT')} className={`${inputClass} w-20`}>
        <option value="MKT">MKT</option>
        <option value="LMT">LMT</option>
      </select>
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder="symbol" />
      <input className={`${inputClassMono} w-28`} placeholder="qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      {orderType === 'LMT' && (
        <input className={`${inputClassMono} w-28`} placeholder="limit price" value={lmtPrice} onChange={(e) => setLmtPrice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      )}
      <button disabled={loading || !key || !qty || (orderType === 'LMT' && !lmtPrice)} onClick={submit} className="btn-primary-sm">Place</button>
      <span className="text-[11px] text-text-muted">Stage → commit → push via Alice's trading pipeline.</span>
    </div>
  )
}

// ==================== Shared helper ====================

function KeySelect({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <>
      <input
        className={`${inputClassMono} w-36`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        list="sim-action-known-keys"
      />
      <datalist id="sim-action-known-keys">
        {options.map(k => <option key={k} value={k} />)}
      </datalist>
    </>
  )
}
