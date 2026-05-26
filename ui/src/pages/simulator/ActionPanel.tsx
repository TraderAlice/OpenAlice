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
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { simulatorApi, type SimulatorState } from '../../api/simulator'
import { InstrumentInput } from './InstrumentInput'
import { buildInstrument, type InstrumentDraft } from './instruments'
import type { TFunction } from 'i18next'

const inputClass =
  'px-2 py-1 bg-bg text-text border border-border rounded text-sm outline-none transition-colors focus:border-accent'
const inputClassMono =
  'px-2 py-1 bg-bg text-text border border-border rounded font-mono text-xs outline-none transition-colors focus:border-accent'

type TabId = 'tick' | 'deposit' | 'trade' | 'order'

function getTabs(t: TFunction): Array<{ id: TabId; label: string; hint: string }> {
  return [
    { id: 'tick',    label: t('simulator.quickTick', 'Quick Tick'),       hint: t('simulator.quickTickHint', 'Move a mark price') },
    { id: 'deposit', label: t('simulator.externalDeposit', 'External Deposit'), hint: t('simulator.externalDepositHint', 'Funds appear outside Alice (airdrop / transfer-in)') },
    { id: 'trade',   label: t('simulator.externalTrade', 'External Trade'),   hint: t('simulator.externalTradeHint', 'User manually traded on the exchange app') },
    { id: 'order',   label: t('simulator.placeOrder', 'Place Order'),      hint: t('simulator.placeOrderHint', 'Stage → commit → push through Alice') },
  ]
}

export function ActionPanel({ utaId, state, run, loading }: {
  utaId: string
  state: SimulatorState
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabId>('tick')
  const tabs = getTabs(t)
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
        {tabs.map((tabItem, i) => (
          <button
            key={tabItem.id}
            role="tab"
            aria-selected={tab === tabItem.id}
            title={`${tabItem.hint} (${i + 1})`}
            onClick={() => setTab(tabItem.id)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tab === tabItem.id
                ? 'bg-accent/20 text-accent font-medium'
                : 'text-text-muted hover:text-text hover:bg-bg-tertiary/50'
            }`}
          >
            <span className="text-[10px] text-text-muted/60 mr-1.5">{i + 1}</span>
            {tabItem.label}
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
  const { t } = useTranslation()
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
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder={t('simulator.symbol', 'symbol')} />
      <span className="text-text-muted text-xs">Δ</span>
      <button disabled={loading || !key} onClick={() => tick(-5)} className="btn-secondary-sm">−5%</button>
      <button disabled={loading || !key} onClick={() => tick(-1)} className="btn-secondary-sm">−1%</button>
      <button disabled={loading || !key} onClick={() => tick(1)} className="btn-secondary-sm">+1%</button>
      <button disabled={loading || !key} onClick={() => tick(5)} className="btn-secondary-sm">+5%</button>
      <span className="text-text-muted/60 text-xs px-1">|</span>
      <input
        className={`${inputClassMono} w-32`}
        placeholder={t('simulator.setPrice', 'set exact')}
        value={setPriceInput}
        onChange={(e) => setSetPriceInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') setExact() }}
      />
      <button disabled={loading || !key || !setPriceInput} onClick={setExact} className="btn-primary-sm">{t('simulator.setExact', 'Set')}</button>
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
  const { t } = useTranslation()
  const [draft, setDraft] = useState<InstrumentDraft>({ symbol: '', secType: 'CRYPTO' })
  const [qty, setQty] = useState('')
  const [withdrawKey, setWithdrawKey] = useState('')
  const [withdrawQty, setWithdrawQty] = useState('')
  const [mode, setMode] = useState<'in' | 'out'>('in')

  const built = mode === 'in' ? buildInstrument(draft) : null
  const draftError = built && 'error' in built ? built.error : null
  const draftOk = built && 'nativeKey' in built ? built : null

  const submitDeposit = () => {
    if (!draftOk || !qty) return
    run(
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
    if (!withdrawKey || !withdrawQty) return
    run(
      `Withdraw ${withdrawQty} ${withdrawKey}`,
      async () => {
        await simulatorApi.externalWithdraw(utaId, withdrawKey, withdrawQty)
        setWithdrawQty('')
      },
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded overflow-hidden border border-border">
          <button
            onClick={() => setMode('in')}
            className={`px-2 py-1 text-xs ${mode === 'in' ? 'bg-green/20 text-green' : 'text-text-muted hover:text-text'}`}
          >{t('simulator.deposit')}</button>
          <button
            onClick={() => setMode('out')}
            className={`px-2 py-1 text-xs ${mode === 'out' ? 'bg-red/20 text-red' : 'text-text-muted hover:text-text'}`}
          >{t('simulator.withdraw')}</button>
        </div>

        {mode === 'in' ? (
          <>
            <InstrumentInput draft={draft} onChange={setDraft} />
            <input
              className={`${inputClassMono} w-24`}
              placeholder={t('simulator.quantity', 'quantity')}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitDeposit() }}
            />
            <button
              disabled={loading || !draftOk || !qty}
              onClick={submitDeposit}
              className="btn-primary-sm"
            >{t('simulator.deposit')}</button>
            {draftOk && <span className="text-[11px] text-text-muted/70 font-mono">→ {draftOk.nativeKey}</span>}
            {draftError && draft.symbol && <span className="text-[11px] text-yellow-400">{draftError}</span>}
          </>
        ) : (
          <>
            <KeySelect value={withdrawKey} onChange={setWithdrawKey} options={knownKeys} placeholder={t('simulator.nativeKey', 'native key')} />
            <input
              className={`${inputClassMono} w-32`}
              placeholder={t('simulator.quantity', 'quantity')}
              value={withdrawQty}
              onChange={(e) => setWithdrawQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitWithdraw() }}
            />
            <button
              disabled={loading || !withdrawKey || !withdrawQty}
              onClick={submitWithdraw}
              className="btn-primary-sm"
            >{t('simulator.withdraw')}</button>
          </>
        )}

        <span className="text-[11px] text-text-muted ml-auto">{t('simulator.cashUnchanged')}</span>
      </div>
    </div>
  )
}

// ==================== External Trade ====================

function TradeTab({ utaId, run, loading }: {
  utaId: string
  knownKeys: string[]
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>
  loading: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<InstrumentDraft>({ symbol: '', secType: 'CRYPTO' })
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')

  const built = buildInstrument(draft)
  const draftError = 'error' in built ? built.error : null
  const draftOk = 'nativeKey' in built ? built : null

  const submit = () => {
    if (!draftOk || !qty || !price) return
    run(
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
      <InstrumentInput draft={draft} onChange={setDraft} />
      <input className={`${inputClassMono} w-24`} placeholder="qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      <input className={`${inputClassMono} w-24`} placeholder="price" value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      <button disabled={loading || !draftOk || !qty || !price} onClick={submit} className="btn-primary-sm">{t('simulator.submit')}</button>
      {draftOk && <span className="text-[11px] text-text-muted/70 font-mono">→ {draftOk.nativeKey}</span>}
      {draftError && draft.symbol && <span className="text-[11px] text-yellow-400">{draftError}</span>}
      <span className="text-[11px] text-text-muted ml-auto">{t('simulator.cashMinus')}</span>
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
  const { t } = useTranslation()
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
      <KeySelect value={key} onChange={setKey} options={knownKeys} placeholder={t('simulator.symbol', 'symbol')} />
      <input className={`${inputClassMono} w-28`} placeholder="qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      {orderType === 'LMT' && (
        <input className={`${inputClassMono} w-28`} placeholder="limit price" value={lmtPrice} onChange={(e) => setLmtPrice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      )}
      <button disabled={loading || !key || !qty || (orderType === 'LMT' && !lmtPrice)} onClick={submit} className="btn-primary-sm">{t('simulator.place')}</button>
      <span className="text-[11px] text-text-muted">{t('simulator.stageCommitPush')}</span>
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
