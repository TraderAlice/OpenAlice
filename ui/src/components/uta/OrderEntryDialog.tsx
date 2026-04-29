import { useState } from 'react'
import { Field, inputClass } from '../form'
import { Dialog } from './Dialog'
import { tradingApi, OrderEntryError } from '../../api/trading'
import type { WalletPushResult, PlaceOrderRequest, ClosePositionRequest } from '../../api/types'

// ==================== Modes ====================

export type OrderEntryMode =
  | { kind: 'place'; aliceId?: string }
  | { kind: 'close'; aliceId: string; quantity: string; symbol?: string }

interface Props {
  utaId: string
  mode: OrderEntryMode
  onClose: () => void
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
export function OrderEntryDialog({ utaId, mode, onClose, onPushComplete }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; phase?: string } | null>(null)
  const [result, setResult] = useState<WalletPushResult | null>(null)

  // Whether the result panel has shown — once it has, parent should
  // refresh on close. We notify via onPushComplete after a successful
  // push so parent can refresh immediately AND on close.
  const handleClose = () => {
    if (result && onPushComplete) onPushComplete(result)
    onClose()
  }

  return (
    <Dialog onClose={handleClose} width="w-[560px]">
      <Header mode={mode} onClose={handleClose} />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {result
          ? <PushResultPanel result={result} />
          : mode.kind === 'place'
            ? <PlaceForm utaId={utaId} initialAliceId={mode.aliceId} submitting={submitting} error={error} setError={setError} setSubmitting={setSubmitting} setResult={setResult} onPushComplete={onPushComplete} />
            : <CloseForm utaId={utaId} aliceId={mode.aliceId} initialQty={mode.quantity} symbol={mode.symbol} submitting={submitting} error={error} setError={setError} setSubmitting={setSubmitting} setResult={setResult} onPushComplete={onPushComplete} />
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

function Header({ mode, onClose }: { mode: OrderEntryMode; onClose: () => void }) {
  const title = mode.kind === 'place' ? 'Place Order' : 'Close Position'
  return (
    <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
      <h3 className="text-[14px] font-semibold text-text">{title}</h3>
      <button onClick={onClose} className="text-text-muted hover:text-text p-1 transition-colors">
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
  submitting: boolean
  error: { message: string; phase?: string } | null
  setError: (e: { message: string; phase?: string } | null) => void
  setSubmitting: (b: boolean) => void
  setResult: (r: WalletPushResult) => void
  onPushComplete?: (result: WalletPushResult) => void
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

  const canSubmit =
    !!aliceId.trim() &&
    !!message.trim() &&
    (!!quantity.trim() || !!cashQty.trim()) &&
    (orderType !== 'LMT' || !!lmtPrice.trim()) &&
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
        ...(quantity.trim() && { totalQuantity: quantity.trim() }),
        ...(cashQty.trim() && { cashQty: cashQty.trim() }),
        ...(orderType === 'LMT' && lmtPrice.trim() && { lmtPrice: lmtPrice.trim() }),
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
      <Field label="aliceId">
        <input
          className={`${inputClass} font-mono text-[12px]`}
          value={aliceId}
          onChange={(e) => setAliceId(e.target.value)}
          placeholder="okx-test|BTC/USDT"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Action">
          <Segmented value={action} options={[{ id: 'BUY' }, { id: 'SELL' }]} onChange={(v) => setAction(v as 'BUY' | 'SELL')} />
        </Field>
        <Field label="Order Type">
          <Segmented value={orderType} options={[{ id: 'MKT', label: 'Market' }, { id: 'LMT', label: 'Limit' }]} onChange={(v) => setOrderType(v as 'MKT' | 'LMT')} />
        </Field>
      </div>

      <Field label={`Quantity${cashQty ? ' (or use Cash Qty below)' : ''}`}>
        <input
          className={`${inputClass} font-mono`}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0.001"
          inputMode="decimal"
        />
        <p className="text-[11px] text-text-muted/60 mt-1">Numeric string — preserved at full precision through to the broker (no float roundtrip).</p>
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
        className="text-[11px] text-text-muted hover:text-text transition-colors"
      >
        {showAdvanced ? '▾ Hide advanced' : '▸ Show advanced (cash qty, TIF)'}
      </button>
      {showAdvanced && (
        <div className="space-y-3 border-l border-border pl-3">
          <Field label="Cash Qty (notional)">
            <input
              className={`${inputClass} font-mono`}
              value={cashQty}
              onChange={(e) => setCashQty(e.target.value)}
              placeholder="50"
              inputMode="decimal"
            />
            <p className="text-[11px] text-text-muted/60 mt-1">USDT-equivalent notional. Overrides Quantity if both are set.</p>
          </Field>
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
          <p className="text-[11px] text-text-muted/60 mt-1">Goes into the trading-as-git commit log alongside the order. Required, even for manual entries.</p>
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

// ==================== Close form ====================

function CloseForm({ aliceId, initialQty, symbol, ...p }: SharedFormProps & { aliceId: string; initialQty: string; symbol?: string }) {
  const [qty, setQty] = useState(initialQty)
  const [message, setMessage] = useState('')

  const canSubmit = !!message.trim() && !p.submitting

  const handleSubmit = async () => {
    p.setError(null)
    p.setSubmitting(true)
    try {
      const body: ClosePositionRequest = {
        aliceId,
        ...(symbol && { symbol }),
        ...(qty.trim() && { qty: qty.trim() }),
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
      <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5 space-y-1">
        <div className="text-[11px] text-text-muted uppercase tracking-wide">Closing</div>
        <div className="font-mono text-[13px] text-text">{aliceId}</div>
      </div>

      <Field label="Quantity to close">
        <input
          className={`${inputClass} font-mono`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="(empty = full position)"
          inputMode="decimal"
        />
        <p className="text-[11px] text-text-muted/60 mt-1">Defaults to current position size. Override for partial close. Empty = close entire position.</p>
      </Field>

      <Field label="Commit Message — required">
        <input
          className={inputClass}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Why are you closing?"
          autoFocus
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${fullySubmitted ? 'bg-green' : 'bg-yellow-400'}`} />
        <span className={`text-[13px] font-medium ${fullySubmitted ? 'text-green' : 'text-yellow-400'}`}>
          {fullySubmitted
            ? `${totalSubmitted} operation${totalSubmitted > 1 ? 's' : ''} submitted to broker`
            : `${totalSubmitted} submitted, ${totalRejected} rejected`}
        </span>
      </div>

      <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5 space-y-1.5">
        <div className="flex justify-between text-[12px]">
          <span className="text-text-muted">Commit hash</span>
          <span className="font-mono text-text">{result.hash}</span>
        </div>
        <div className="text-[12px]">
          <span className="text-text-muted">Message:</span>
          <span className="ml-2 text-text">{result.message}</span>
        </div>
      </div>

      {result.submitted.length > 0 && (
        <OpTable title="Submitted" rows={result.submitted} kind="submitted" />
      )}
      {result.rejected.length > 0 && (
        <OpTable title="Rejected" rows={result.rejected} kind="rejected" />
      )}

      <p className="text-[11px] text-text-muted leading-relaxed">
        Status <strong className="text-text">Submitted</strong> means the broker accepted the order — fills happen async.
        Refresh the positions / orders panels in a moment to see the order transition to <strong className="text-text">Filled</strong>.
      </p>
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
      <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide mb-1.5">{title} ({rows.length})</p>
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-bg-tertiary/30 text-text-muted">
              <th className="text-left px-2.5 py-1.5 font-medium">Action</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Order ID</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Status / Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-2.5 py-1.5 text-text">{r.action}</td>
                <td className="px-2.5 py-1.5 font-mono text-text-muted text-[11px]">{r.orderId ?? '—'}</td>
                <td className={`px-2.5 py-1.5 ${kind === 'rejected' ? 'text-red' : 'text-text'}`}>
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
    <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full bg-red shrink-0" />
        <span className="text-[12px] font-medium text-red">
          {phase ? `Failed at ${phase} step` : 'Failed'}
        </span>
      </div>
      <p className="text-[12px] text-text whitespace-pre-wrap">{message}</p>
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
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-tertiary/30'
          }`}
        >
          {o.label ?? o.id}
        </button>
      ))}
    </div>
  )
}

