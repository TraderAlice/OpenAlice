import { useEffect, useId, useState } from 'react'
import Decimal from 'decimal.js'
import { Check, Loader2, Search } from 'lucide-react'
import { Field, inputClass } from '../form'
import { Dialog } from './Dialog'
import { tradingApi, OrderEntryError, type ContractSearchHit } from '../../api/trading'
import type { WalletPushResult, PlaceOrderRequest, ClosePositionRequest, SubAccountRef } from '../../api/types'

// ==================== Modes ====================

export type OrderEntryMode =
  | { kind: 'place'; aliceId?: string }
  | { kind: 'close'; aliceId: string; quantity: string; symbol?: string }

interface Props {
  utaId: string
  mode: OrderEntryMode
  onClose: () => void
  /** Sub-accounts (wallets) the UTA spans. >1 ⇒ the form shows a wallet picker
   *  and requires a choice (the backend loud-refuses a write without one). */
  subAccounts?: SubAccountRef[]
  /** Pre-selected wallet (the page's current view scope). */
  defaultSubAccountId?: string
  /** Called once after a *successful* push so the parent can refresh positions/orders without waiting for the polling tick. */
  onPushComplete?: (result: WalletPushResult) => void
}

// ==================== Component ====================

/**
 * Manual order entry — single dialog driving the one-shot
 * stage→commit→push backend endpoints. Displays the full
 * `WalletPushResult` after submit so the user can see per-op
 * submitted/rejected outcomes (and in particular, watch the async
 * "Submitted → Filled" transition in real-time).
 *
 * Two modes share the form-then-result flow:
 *   - `place`: full order entry form (aliceId, side, type, qty, limit)
 *   - `close`: tiny confirm form with overridable qty for an existing
 *     position
 */
export function OrderEntryDialog({ utaId, mode, onClose, subAccounts, defaultSubAccountId, onPushComplete }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; phase?: string } | null>(null)
  const [result, setResult] = useState<WalletPushResult | null>(null)
  const dialogTitle = mode.kind === 'place' ? 'Place Order' : 'Close Position'

  // Whether the result panel has shown — once it has, parent should
  // refresh on close. We notify via onPushComplete after a successful
  // push so parent can refresh immediately AND on close.
  const handleClose = () => {
    if (result && onPushComplete) onPushComplete(result)
    onClose()
  }

  return (
    <Dialog ariaLabel={dialogTitle} onClose={handleClose} width="w-[560px]">
      <Header title={dialogTitle} onClose={handleClose} />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {result
          ? <PushResultPanel result={result} />
          : mode.kind === 'place'
            ? <PlaceForm utaId={utaId} initialAliceId={mode.aliceId} subAccounts={subAccounts} defaultSubAccountId={defaultSubAccountId} submitting={submitting} error={error} setError={setError} setSubmitting={setSubmitting} setResult={setResult} onPushComplete={onPushComplete} />
            : <CloseForm utaId={utaId} aliceId={mode.aliceId} initialQty={mode.quantity} symbol={mode.symbol} subAccounts={subAccounts} defaultSubAccountId={defaultSubAccountId} submitting={submitting} error={error} setError={setError} setSubmitting={setSubmitting} setResult={setResult} onPushComplete={onPushComplete} />
        }
      </div>

      <div className="shrink-0 flex items-center justify-end px-6 py-4 border-t border-border">
        <button onClick={handleClose} className="btn-secondary">
          {result ? 'Done' : 'Cancel'}
        </button>
      </div>
    </Dialog>
  )
}

// ==================== Header ====================

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${title}`}
        className="text-muted-foreground hover:text-foreground p-1 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ==================== Place form ====================

interface SharedFormProps {
  utaId: string
  subAccounts?: SubAccountRef[]
  defaultSubAccountId?: string
  submitting: boolean
  error: { message: string; phase?: string } | null
  setError: (e: { message: string; phase?: string } | null) => void
  setSubmitting: (b: boolean) => void
  setResult: (r: WalletPushResult) => void
  onPushComplete?: (result: WalletPushResult) => void
}

/** Wallet picker for separate-wallet venues. Returns null (renders nothing)
 *  when the account has a single wallet — the field only appears when a choice
 *  is genuinely required. */
function WalletPicker({ subAccounts, value, onChange }: {
  subAccounts?: SubAccountRef[]
  value: string
  onChange: (id: string) => void
}) {
  if (!subAccounts || subAccounts.length <= 1) return null
  return (
    <Field label="Wallet — required">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {subAccounts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <p className="text-[11px] text-muted-foreground/60 mt-1">This venue has separate wallets; the order routes to the one you pick.</p>
    </Field>
  )
}

/** Initial wallet selection: the page's current scope if it names a real
 *  wallet, else the first wallet. Empty when single-wallet (field is hidden). */
function initialWallet(subAccounts?: SubAccountRef[], preferred?: string): string {
  if (!subAccounts || subAccounts.length <= 1) return ''
  if (preferred && subAccounts.some(s => s.id === preferred)) return preferred
  return subAccounts[0].id
}

function PlaceForm({ initialAliceId, ...p }: SharedFormProps & { initialAliceId?: string }) {
  const [aliceId, setAliceId] = useState(initialAliceId ?? '')
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [orderType, setOrderType] = useState<'MKT' | 'LMT'>('MKT')
  const [quantity, setQuantity] = useState('')
  const [cashQty, setCashQty] = useState('')
  const [lmtPrice, setLmtPrice] = useState('')
  const [tif, setTif] = useState('DAY')
  const [message, setMessage] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [subAccountId, setSubAccountId] = useState(() => initialWallet(p.subAccounts, p.defaultSubAccountId))

  const multiWallet = (p.subAccounts?.length ?? 0) > 1
  const hasOrderSize = !!quantity.trim() || (orderType === 'MKT' && !!cashQty.trim())
  const canSubmit =
    !!aliceId.trim() &&
    !!message.trim() &&
    hasOrderSize &&
    (orderType !== 'LMT' || !!lmtPrice.trim()) &&
    (!multiWallet || !!subAccountId) &&
    !p.submitting

  const handleSubmit = async () => {
    p.setError(null)
    p.setSubmitting(true)
    try {
      const body: PlaceOrderRequest = {
        aliceId: aliceId.trim(),
        action,
        orderType,
        tif,
        message: message.trim(),
        ...(orderType === 'MKT' && cashQty.trim()
          ? { cashQty: cashQty.trim() }
          : quantity.trim()
            ? { totalQuantity: quantity.trim() }
            : {}),
        ...(orderType === 'LMT' && lmtPrice.trim() && { lmtPrice: lmtPrice.trim() }),
        ...(multiWallet && subAccountId && { subAccountId }),
      }
      const result = await tradingApi.placeOrder(p.utaId, body)
      p.setResult(result)
      p.onPushComplete?.(result)
    } catch (err) {
      if (err instanceof OrderEntryError) {
        p.setError({ message: err.response.error, phase: err.response.phase })
      } else {
        p.setError({ message: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      p.setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <ContractPicker
        utaId={p.utaId}
        value={aliceId}
        initialAliceId={initialAliceId}
        onChange={setAliceId}
      />

      <WalletPicker subAccounts={p.subAccounts} value={subAccountId} onChange={setSubAccountId} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Action">
          <Segmented value={action} options={[{ id: 'BUY' }, { id: 'SELL' }]} onChange={(v) => setAction(v as 'BUY' | 'SELL')} />
        </Field>
        <Field label="Order Type">
          <Segmented
            value={orderType}
            options={[{ id: 'MKT', label: 'Market' }, { id: 'LMT', label: 'Limit' }]}
            onChange={(v) => {
              const next = v as 'MKT' | 'LMT'
              setOrderType(next)
              if (next !== 'MKT') setCashQty('')
            }}
          />
        </Field>
      </div>

      <Field label={`Quantity${cashQty ? ' (using Cash Qty below)' : ''}`}>
        <input
          className={`${inputClass} font-mono`}
          value={quantity}
          onChange={(e) => {
            const next = e.target.value
            setQuantity(next)
            if (next.trim()) setCashQty('')
          }}
          placeholder="0.001"
          inputMode="decimal"
        />
        <p className="text-[11px] text-muted-foreground/60 mt-1">Numeric string — preserved at full precision through to the broker (no float roundtrip).</p>
      </Field>

      {orderType === 'LMT' && (
        <Field label="Limit Price">
          <input
            className={`${inputClass} font-mono`}
            value={lmtPrice}
            onChange={(e) => setLmtPrice(e.target.value)}
            placeholder="60000"
            inputMode="decimal"
          />
        </Field>
      )}

      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? '▾ Hide advanced' : '▸ Show advanced (cash qty, TIF)'}
      </button>
      {showAdvanced && (
        <div className="space-y-3 border-l border-border pl-3">
          {orderType === 'MKT' && (
            <Field label="Cash Qty (notional)">
              <input
                className={`${inputClass} font-mono`}
                value={cashQty}
                onChange={(e) => {
                  const next = e.target.value
                  setCashQty(next)
                  if (next.trim()) setQuantity('')
                }}
                placeholder="50"
                inputMode="decimal"
              />
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                Market orders only. Entering a cash quantity clears Quantity.
              </p>
            </Field>
          )}
          <Field label="Time in Force">
            <select className={inputClass} value={tif} onChange={(e) => setTif(e.target.value)}>
              <option value="DAY">DAY</option>
              <option value="GTC">GTC (Good Till Cancelled)</option>
            </select>
          </Field>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <Field label="Commit Message — required">
          <input
            className={inputClass}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Why are you placing this order?"
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground/60 mt-1">Goes into the trading-as-git commit log alongside the order. Required, even for manual entries.</p>
        </Field>
      </div>

      {p.error && <ErrorPanel message={p.error.message} phase={p.error.phase} />}

      <div className="pt-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="btn-primary w-full"
        >
          {p.submitting ? 'Submitting…' : 'Place Order'}
        </button>
      </div>
    </div>
  )
}

function contractLabel(hit: ContractSearchHit): string {
  return hit.contract.symbol
    ?? hit.contract.localSymbol
    ?? hit.contract.aliceId?.split('|').slice(1).join('|')
    ?? ''
}

function initialContractLabel(aliceId?: string): string {
  if (!aliceId) return ''
  const separator = aliceId.indexOf('|')
  return separator >= 0 ? aliceId.slice(separator + 1) : aliceId
}

/**
 * Resolve a broker-native contract before the form can submit. The search is
 * intentionally scoped to the account whose dialog is open: a result from a
 * different UTA may look identical by symbol while carrying an aliceId that
 * the backend must reject.
 *
 * Exact aliceIds remain pasteable for advanced/debug workflows. Ordinary users
 * can stay in the symbol-and-description layer and never have to construct the
 * internal identifier themselves.
 */
function ContractPicker({
  utaId,
  value,
  initialAliceId,
  onChange,
}: {
  utaId: string
  value: string
  initialAliceId?: string
  onChange: (aliceId: string) => void
}) {
  const resultsId = useId()
  const [query, setQuery] = useState(() => initialContractLabel(initialAliceId))
  const [selected, setSelected] = useState<ContractSearchHit | null>(() => (
    initialAliceId
      ? {
          source: utaId,
          derivativeSecTypes: [],
          contract: {
            aliceId: initialAliceId,
            symbol: initialContractLabel(initialAliceId),
          },
        }
      : null
  ))
  const [results, setResults] = useState<ContractSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const trimmedQuery = query.trim()
  const hasExactAliceId = trimmedQuery.includes('|')
  const canSearch = trimmedQuery.length >= 2 && selected === null && !hasExactAliceId

  useEffect(() => {
    if (!canSearch) {
      setResults([])
      setLoading(false)
      setSearchError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setSearchError(null)
    const timeout = window.setTimeout(() => {
      tradingApi.searchContracts(trimmedQuery, undefined, utaId)
        .then((response) => {
          if (cancelled) return
          setResults(response.results.filter((hit) => hit.source === utaId && hit.contract.aliceId))
        })
        .catch((error) => {
          if (cancelled) return
          setResults([])
          setSearchError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [canSearch, trimmedQuery, utaId])

  const updateQuery = (next: string) => {
    setQuery(next)
    setSelected(null)
    setResults([])
    setSearchError(null)
    setLoading(next.trim().length >= 2 && !next.trim().includes('|'))
    onChange(next.trim().includes('|') ? next.trim() : '')
  }

  const chooseContract = (hit: ContractSearchHit) => {
    const nextAliceId = hit.contract.aliceId
    if (!nextAliceId) return
    setSelected(hit)
    setQuery(contractLabel(hit))
    setResults([])
    setSearchError(null)
    onChange(nextAliceId)
  }

  const showResults = canSearch && (searchError !== null || results.length > 0)
  const showNoMatches = canSearch && !loading && searchError === null && results.length === 0

  return (
    <Field label="Contract" controlId={`${resultsId}-input`}>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
        />
        <input
          id={`${resultsId}-input`}
          type="search"
          className={`${inputClass} pl-9 pr-9`}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Search this account — AAPL, BTC, EUR…"
          autoComplete="off"
          aria-controls={resultsId}
          aria-expanded={showResults || showNoMatches}
          aria-describedby={`${resultsId}-help`}
        />
        {loading && (
          <Loader2
            aria-label="Searching contracts"
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        )}
      </div>

      <p id={`${resultsId}-help`} className="mt-1 text-[11px] text-muted-foreground/70">
        Search tradeable contracts on this account, or paste an exact aliceId.
      </p>

      {selected && value && (
        <div className="mt-2 flex min-w-0 items-start gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2">
          <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-foreground">
              <span>{contractLabel(selected)}</span>
              {selected.contract.secType && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {selected.contract.secType}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={value}>
              {value}
            </div>
          </div>
        </div>
      )}

      {showResults && (
        <div
          id={resultsId}
          role="group"
          aria-label="Matching contracts"
          className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-sm"
        >
          {searchError !== null ? (
            <div className="px-2 py-2 text-[12px] text-destructive">
              Could not search this account: {searchError}
            </div>
          ) : results.map((hit) => {
            const aliceId = hit.contract.aliceId
            const details = [
              hit.contract.description,
              hit.contract.primaryExchange ?? hit.contract.exchange,
              hit.contract.currency,
            ].filter(Boolean).join(' · ')
            return (
              <button
                key={aliceId}
                type="button"
                onClick={() => chooseContract(hit)}
                className="oa-pressable flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[13px] font-semibold text-foreground">
                      {contractLabel(hit)}
                    </span>
                    {hit.contract.secType && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {hit.contract.secType}
                      </span>
                    )}
                  </span>
                  {details && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {details}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {showNoMatches && (
        <div id={resultsId} role="status" className="mt-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          No matching tradeable contract on this account.
        </div>
      )}

      {hasExactAliceId && selected === null && value && (
        <div id={resultsId} role="status" className="mt-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground">
          Exact aliceId entered. It will still be validated by the account before the order is staged.
        </div>
      )}
    </Field>
  )
}

// ==================== Close form ====================

function closeQuantityError(qty: string, availableQty: string): string | null {
  if (!qty.trim()) return null

  const available = new Decimal(availableQty).abs()
  let requested: Decimal
  try {
    requested = new Decimal(qty.trim())
  } catch {
    return `Enter a positive quantity no greater than ${available.toString()}.`
  }

  if (!requested.isFinite() || requested.lte(0)) {
    return `Enter a positive quantity no greater than ${available.toString()}.`
  }
  if (requested.gt(available)) {
    return `Quantity cannot exceed the current position size (${available.toString()}).`
  }
  return null
}

function CloseForm({ aliceId, initialQty, symbol, ...p }: SharedFormProps & { aliceId: string; initialQty: string; symbol?: string }) {
  const [qty, setQty] = useState(initialQty)
  const [message, setMessage] = useState('')
  const [subAccountId, setSubAccountId] = useState(() => initialWallet(p.subAccounts, p.defaultSubAccountId))

  const multiWallet = (p.subAccounts?.length ?? 0) > 1
  const quantityError = closeQuantityError(qty, initialQty)
  const canSubmit = !!message.trim() && !quantityError && (!multiWallet || !!subAccountId) && !p.submitting

  const handleSubmit = async () => {
    p.setError(null)
    p.setSubmitting(true)
    try {
      const body: ClosePositionRequest = {
        aliceId,
        ...(symbol && { symbol }),
        ...(qty.trim() && { qty: qty.trim() }),
        ...(multiWallet && subAccountId && { subAccountId }),
        message: message.trim(),
      }
      const result = await tradingApi.closePosition(p.utaId, body)
      p.setResult(result)
      p.onPushComplete?.(result)
    } catch (err) {
      if (err instanceof OrderEntryError) {
        p.setError({ message: err.response.error, phase: err.response.phase })
      } else {
        p.setError({ message: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      p.setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-secondary/50 px-3 py-2.5 space-y-1">
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Closing</div>
        <div className="font-mono text-[13px] text-foreground">{aliceId}</div>
      </div>

      <WalletPicker subAccounts={p.subAccounts} value={subAccountId} onChange={setSubAccountId} />

      <Field label="Quantity to close">
        <input
          className={`${inputClass} font-mono`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="(empty = full position)"
          inputMode="decimal"
          aria-label="Quantity to close"
          aria-invalid={quantityError ? 'true' : undefined}
          aria-describedby="close-position-quantity-help"
        />
        <p
          id="close-position-quantity-help"
          className={`text-[11px] mt-1 ${quantityError ? 'text-destructive' : 'text-muted-foreground/60'}`}
        >
          {quantityError ?? `Current position size: ${new Decimal(initialQty).abs().toString()}. Enter less for a partial close, or clear to close all.`}
        </p>
      </Field>

      <Field label="Commit Message — required">
        <input
          className={inputClass}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Why are you closing?"
          autoFocus
          aria-label="Commit Message — required"
        />
      </Field>

      {p.error && <ErrorPanel message={p.error.message} phase={p.error.phase} />}

      <div className="pt-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="btn-danger w-full"
        >
          {p.submitting ? 'Closing…' : 'Close Position'}
        </button>
      </div>
    </div>
  )
}

// ==================== Push result panel ====================

function PushResultPanel({ result }: { result: WalletPushResult }) {
  const totalRejected = result.rejected.length
  const totalSubmitted = result.submitted.length
  const fullySubmitted = totalRejected === 0 && totalSubmitted > 0
  const simulated = result.simulated === true

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${fullySubmitted ? 'bg-success' : 'bg-warning'}`} />
        <span className={`text-[13px] font-medium ${fullySubmitted ? 'text-success' : 'text-warning'}`}>
          {simulated
            ? `${totalSubmitted} operation${totalSubmitted > 1 ? 's' : ''} simulated`
            : fullySubmitted
            ? `${totalSubmitted} operation${totalSubmitted > 1 ? 's' : ''} submitted to broker`
            : `${totalSubmitted} submitted, ${totalRejected} rejected`}
        </span>
      </div>

      <div className="rounded-md border border-border bg-secondary/50 px-3 py-2.5 space-y-1.5">
        <div className="flex justify-between text-[12px]">
          <span className="text-muted-foreground">Commit hash</span>
          <span className="font-mono text-foreground">{result.hash}</span>
        </div>
        <div className="text-[12px]">
          <span className="text-muted-foreground">Message:</span>
          <span className="ml-2 text-foreground">{result.message}</span>
        </div>
      </div>

      {result.submitted.length > 0 && (
        <OpTable title={simulated ? 'Simulated' : 'Submitted'} rows={result.submitted} kind="submitted" />
      )}
      {result.rejected.length > 0 && (
        <OpTable title="Rejected" rows={result.rejected} kind="rejected" />
      )}

      {simulated
        ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Demo simulation only — no order was sent to a broker and portfolio data was not changed.
          </p>
        )
        : (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Status <strong className="text-foreground">Submitted</strong> means the broker accepted the order — fills happen async.
            Refresh the positions / orders panels in a moment to see the order transition to <strong className="text-foreground">Filled</strong>.
          </p>
        )}
    </div>
  )
}

interface OpRow {
  action: string
  success: boolean
  status: string
  orderId?: string
  error?: string
}

function OpTable({ title, rows, kind }: { title: string; rows: OpRow[]; kind: 'submitted' | 'rejected' }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{title} ({rows.length})</p>
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground">
              <th className="text-left px-2.5 py-1.5 font-medium">Action</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Order ID</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Status / Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-2.5 py-1.5 text-foreground">{r.action}</td>
                <td className="px-2.5 py-1.5 font-mono text-muted-foreground text-[11px]">{r.orderId ?? '—'}</td>
                <td className={`px-2.5 py-1.5 ${kind === 'rejected' ? 'text-destructive' : 'text-foreground'}`}>
                  {kind === 'rejected' ? (r.error ?? r.status) : r.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ==================== Error display ====================

function ErrorPanel({ message, phase }: { message: string; phase?: string }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
        <span className="text-[12px] font-medium text-destructive">
          {phase ? `Failed at ${phase} step` : 'Failed'}
        </span>
      </div>
      <p className="text-[12px] text-foreground whitespace-pre-wrap">{message}</p>
    </div>
  )
}

// ==================== Segmented control ====================

function Segmented({ value, options, onChange }: {
  value: string
  options: Array<{ id: string; label?: string }>
  onChange: (v: string) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
            value === o.id
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
          }`}
        >
          {o.label ?? o.id}
        </button>
      ))}
    </div>
  )
}
