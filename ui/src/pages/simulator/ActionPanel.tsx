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

import { Autocomplete } from '@/components/ui/autocomplete'
import { Select } from '@/components/ui/select'

import { useMemo, useState } from 'react'
import { api } from '../../api'
import { simulatorApi, type SimulatorState } from '../../api/simulator'
import { InstrumentInput } from './InstrumentInput'
import { buildInstrument, type InstrumentDraft } from './instruments'
import { Button } from '../../components/ui/button'
import { inputClass as sharedInputClass } from '../../components/form'
import { SegmentedControl } from '../../components/SegmentedControl'

const inputClassMono =
  `${sharedInputClass} min-h-8 py-1 font-mono text-xs`

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
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      <SegmentedControl
        value={tab}
        options={TABS.map((item, index) => ({
          value: item.id,
          label: item.label,
          ariaLabel: `${item.label}: ${item.hint} (${index + 1})`,
        }))}
        onChange={setTab}
        ariaLabel="Simulator action"
        className="mb-3"
      />

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
    if (loading || !key || !setPriceInput) return
    void run(
      `Set ${key} = ${setPriceInput}`,
      async () => {
        await simulatorApi.setMarkPrice(utaId, key, setPriceInput)
        setSetPriceInput('')
      },
    )
  }

  return (
    <form
      className="flex items-center gap-2 flex-wrap"
      onSubmit={(e) => {
        e.preventDefault()
        setExact()
      }}
    >
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder="symbol" ariaLabel="Symbol" />
      <span className="text-muted-foreground text-xs">Δ</span>
      <Button type="button" disabled={loading || !key} onClick={() => tick(-5)} variant="outline" size="sm">−5%</Button>
      <Button type="button" disabled={loading || !key} onClick={() => tick(-1)} variant="outline" size="sm">−1%</Button>
      <Button type="button" disabled={loading || !key} onClick={() => tick(1)} variant="outline" size="sm">+1%</Button>
      <Button type="button" disabled={loading || !key} onClick={() => tick(5)} variant="outline" size="sm">+5%</Button>
      <input
        className={`${inputClassMono} w-32 tabular-nums`}
        placeholder="set exact"
        aria-label="Exact mark price"
        value={setPriceInput}
        onChange={(e) => setSetPriceInput(e.target.value)}
      />
      <Button type="submit" disabled={loading || !key || !setPriceInput} size="sm">Set</Button>
    </form>
  )
}

// ==================== External Deposit ====================

function DepositTab({ utaId, knownKeys, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [draft, setDraft] = useState<InstrumentDraft>({ symbol: '', secType: 'CRYPTO' })
  const [qty, setQty] = useState('')
  const [withdrawKey, setWithdrawKey] = useState('')
  const [withdrawQty, setWithdrawQty] = useState('')
  const [mode, setMode] = useState<'in' | 'out'>('in')

  const built = mode === 'in' ? buildInstrument(draft) : null
  const draftError = built && 'error' in built ? built.error : null
  const draftOk = built && 'nativeKey' in built ? built : null

  const submitDeposit = () => {
    if (loading || !draftOk || !qty) return
    void run(
      `Deposit ${qty} ${draftOk.nativeKey}`,
      async () => {
        await simulatorApi.externalDeposit(utaId, {
          nativeKey: draftOk.nativeKey,
          quantity: qty,
          contract: draftOk.contract,
        })
        setQty('')
      },
    )
  }

  const submitWithdraw = () => {
    if (loading || !withdrawKey || !withdrawQty) return
    void run(
      `Withdraw ${withdrawQty} ${withdrawKey}`,
      async () => {
        await simulatorApi.externalWithdraw(utaId, withdrawKey, withdrawQty)
        setWithdrawQty('')
      },
    )
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (mode === 'in') submitDeposit()
        else submitWithdraw()
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <SegmentedControl
          value={mode}
          options={[
            { value: 'in', label: 'Deposit' },
            { value: 'out', label: 'Withdraw' },
          ]}
          onChange={setMode}
          ariaLabel="Transfer direction"
          compact
        />

        {mode === 'in' ? (
          <>
            <InstrumentInput draft={draft} onChange={setDraft} />
            <input
              className={`${inputClassMono} w-24 tabular-nums`}
              placeholder="quantity"
              aria-label="Deposit quantity"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <Button
              type="submit"
              disabled={loading || !draftOk || !qty}
              size="sm"
            >Deposit</Button>
            {draftOk && <span className="text-sm leading-5 text-muted-foreground/70 font-mono">→ {draftOk.nativeKey}</span>}
            {draftError && draft.symbol && <span className="text-sm text-warning">{draftError}</span>}
          </>
        ) : (
          <>
            <KeySelect value={withdrawKey} onChange={setWithdrawKey} options={knownKeys} placeholder="native key" ariaLabel="Withdraw instrument" />
            <input
              className={`${inputClassMono} w-32 tabular-nums`}
              placeholder="quantity"
              aria-label="Withdraw quantity"
              value={withdrawQty}
              onChange={(e) => setWithdrawQty(e.target.value)}
            />
            <Button
              type="submit"
              disabled={loading || !withdrawKey || !withdrawQty}
              size="sm"
            >Withdraw</Button>
          </>
        )}

      </div>
    </form>
  )
}

// ==================== External Trade ====================

function TradeTab({ utaId, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const [draft, setDraft] = useState<InstrumentDraft>({ symbol: '', secType: 'CRYPTO' })
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')

  const built = buildInstrument(draft)
  const draftError = 'error' in built ? built.error : null
  const draftOk = 'nativeKey' in built ? built : null

  const submit = () => {
    if (loading || !draftOk || !qty || !price) return
    void run(
      `External ${side} ${qty} ${draftOk.nativeKey} @ ${price}`,
      async () => {
        await simulatorApi.externalTrade(utaId, {
          nativeKey: draftOk.nativeKey,
          side,
          quantity: qty,
          price,
          contract: draftOk.contract,
        })
        setQty('')
      },
    )
  }

  return (
    <form
      className="flex items-center gap-2 flex-wrap"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <SegmentedControl
        value={side}
        options={[
          { value: 'BUY', label: 'BUY' },
          { value: 'SELL', label: 'SELL' },
        ]}
        onChange={setSide}
        ariaLabel="Trade side"
        compact
      />
      <InstrumentInput draft={draft} onChange={setDraft} />
      <input
        className={`${inputClassMono} w-24 tabular-nums`}
        placeholder="qty"
        aria-label="Trade quantity"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
      <input
        className={`${inputClassMono} w-24 tabular-nums`}
        placeholder="price"
        aria-label="Trade price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <Button type="submit" disabled={loading || !draftOk || !qty || !price} size="sm">Submit</Button>
      {draftOk && <span className="text-sm leading-5 text-muted-foreground/70 font-mono">→ {draftOk.nativeKey}</span>}
      {draftError && draft.symbol && <span className="text-sm text-warning">{draftError}</span>}
    </form>
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
    if (loading || !key || !qty) return
    if (orderType === 'LMT' && !lmtPrice) return
    const aliceId = `${utaId}|${key}`
    const labelBits = [side, orderType, qty, key]
    if (orderType === 'LMT') labelBits.push(`@${lmtPrice}`)
    void run(
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
    <form
      className="flex items-center gap-2 flex-wrap"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <SegmentedControl
        value={side}
        options={[
          { value: 'BUY', label: 'BUY' },
          { value: 'SELL', label: 'SELL' },
        ]}
        onChange={setSide}
        ariaLabel="Order side"
        compact
      />
      <Select value={orderType} onValueChange={(selectedValue) => setOrderType(selectedValue as 'MKT' | 'LMT')} className="w-24" aria-label="Order type"
        options={[
          { value: 'MKT', label: 'MKT' },
          { value: 'LMT', label: 'LMT' },
        ]}
      />
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder="symbol" ariaLabel="Order symbol" />
      <input
        className={`${inputClassMono} w-28 tabular-nums`}
        placeholder="qty"
        aria-label="Order quantity"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
      {orderType === 'LMT' && (
        <input
          className={`${inputClassMono} w-28 tabular-nums`}
          placeholder="limit price"
          aria-label="Limit price"
          value={lmtPrice}
          onChange={(e) => setLmtPrice(e.target.value)}
        />
      )}
      <Button type="submit" disabled={loading || !key || !qty || (orderType === 'LMT' && !lmtPrice)} size="sm">Place</Button>
    </form>
  )
}

// ==================== Shared helper ====================

function KeySelect({ value, onChange, options, placeholder, ariaLabel }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  ariaLabel?: string
}) {
  return (
    <Autocomplete
      className="w-36 font-mono"
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      value={value}
      onValueChange={(symbol) => onChange(symbol.trim())}
      options={options}
    />
  )
}
