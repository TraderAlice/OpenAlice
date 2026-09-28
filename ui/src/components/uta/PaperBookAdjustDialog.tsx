/**
 * CN Local Paper — 调整账面 dialog.
 *
 * Product bookkeeping only (cash / position / T+1 / whole-book snapshot).
 * Not the /dev/simulator god-mode surface.
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Button } from '../ui/button'
import { SegmentedControl } from '../SegmentedControl'
import { inputClass as sharedInputClass } from '../form'

const inputClass = `${sharedInputClass} min-h-8 py-1 text-sm`
const inputClassMono = `${sharedInputClass} min-h-8 py-1 font-mono text-xs`

type TabId = 'cash' | 'position' | 'sellable' | 'snapshot'

type BookView = {
  cash: string
  buyingPower: string
  positions: Array<{
    nativeKey: string
    quantity: string
    avgCost: string
    locked: string
    sellable: string
  }>
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'cash', label: '现金' },
  { id: 'position', label: '持仓' },
  { id: 'sellable', label: '可卖' },
  { id: 'snapshot', label: '整账' },
]

export function PaperBookAdjustDialog({
  utaId,
  onDone,
  onClose,
}: {
  utaId: string
  onDone: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<TabId>('cash')
  const [book, setBook] = useState<BookView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const [cashDelta, setCashDelta] = useState('')
  const [posKey, setPosKey] = useState('')
  const [posDelta, setPosDelta] = useState('')
  const [posAvgCost, setPosAvgCost] = useState('')
  const [sellKey, setSellKey] = useState('')
  const [sellable, setSellable] = useState('')
  const [snapCash, setSnapCash] = useState('')
  const [snapRows, setSnapRows] = useState('600519,100,10,100')

  const refresh = useCallback(async () => {
    const r = await api.trading.paperBook(utaId)
    setBook(r.book)
    setSnapCash(r.book.cash)
    if (!posKey && r.book.positions[0]) setPosKey(r.book.positions[0].nativeKey)
    if (!sellKey && r.book.positions[0]) {
      setSellKey(r.book.positions[0].nativeKey)
      setSellable(r.book.positions[0].sellable)
    }
  }, [utaId, posKey, sellKey])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [refresh])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (!reason.trim()) {
      setError('请填写调整原因')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await fn()
      await refresh()
      onDone()
      setReason('')
      setCashDelta('')
      setPosDelta('')
      setPosAvgCost('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const submitCash = () => run('cash', () =>
    api.trading.paperAdjustCash(utaId, { delta: cashDelta.trim(), reason: reason.trim() }),
  )

  const submitPosition = () => run('position', () =>
    api.trading.paperAdjustPosition(utaId, {
      nativeKey: posKey.trim(),
      quantityDelta: posDelta.trim(),
      ...(posAvgCost.trim() ? { avgCost: posAvgCost.trim() } : {}),
      reason: reason.trim(),
    }),
  )

  const submitSellable = () => run('sellable', () =>
    api.trading.paperSetSellable(utaId, {
      nativeKey: sellKey.trim(),
      sellable: sellable.trim(),
      reason: reason.trim(),
    }),
  )

  const submitSnapshot = () => run('snapshot', async () => {
    const positions = snapRows
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [nativeKey, quantity, avgCost, sell] = line.split(/[,，\s]+/)
        if (!nativeKey || !quantity) throw new Error(`整账行无效: ${line}`)
        return {
          nativeKey,
          quantity,
          ...(avgCost ? { avgCost } : {}),
          ...(sell ? { sellable: sell } : {}),
        }
      })
    await api.trading.paperSetSnapshot(utaId, {
      cash: snapCash.trim(),
      positions,
      reason: reason.trim(),
    })
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">调整账面</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              仅 CN Local Paper。写入纸面账并记入账户流水，不是假成交。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {book && (
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12px] font-mono space-y-1">
              <div>现金 {book.cash} · 可用 {book.buyingPower}</div>
              {book.positions.length === 0 ? (
                <div className="text-muted-foreground">无持仓</div>
              ) : book.positions.map((p) => (
                <div key={p.nativeKey}>
                  {p.nativeKey} qty={p.quantity} cost={p.avgCost} 可卖={p.sellable} 锁定={p.locked}
                </div>
              ))}
            </div>
          )}

          <SegmentedControl
            value={tab}
            options={TABS.map((t) => ({ value: t.id, label: t.label }))}
            onChange={setTab}
            ariaLabel="调整类型"
          />

          {tab === 'cash' && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  className={`${inputClassMono} w-40`}
                  placeholder="增减额，如 10000"
                  value={cashDelta}
                  onChange={(e) => setCashDelta(e.target.value)}
                />
                <Button size="sm" disabled={loading || !cashDelta.trim()} onClick={submitCash}>确认现金</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                在现有现金上加减；要对齐绝对金额请用「整账」。
              </p>
            </div>
          )}

          {tab === 'position' && (
            <div className="flex flex-wrap gap-2 items-center">
              <input className={`${inputClassMono} w-24`} placeholder="代码" value={posKey} onChange={(e) => setPosKey(e.target.value)} />
              <input className={`${inputClassMono} w-24`} placeholder="Δ股数" value={posDelta} onChange={(e) => setPosDelta(e.target.value)} />
              <input className={`${inputClassMono} w-24`} placeholder="成本可选" value={posAvgCost} onChange={(e) => setPosAvgCost(e.target.value)} />
              <Button size="sm" disabled={loading || !posKey.trim() || !posDelta.trim()} onClick={submitPosition}>确认持仓</Button>
            </div>
          )}

          {tab === 'sellable' && (
            <div className="flex flex-wrap gap-2 items-center">
              <input className={`${inputClassMono} w-24`} placeholder="代码" value={sellKey} onChange={(e) => setSellKey(e.target.value)} />
              <input className={`${inputClassMono} w-24`} placeholder="可卖股数" value={sellable} onChange={(e) => setSellable(e.target.value)} />
              <Button size="sm" disabled={loading || !sellKey.trim() || !sellable.trim()} onClick={submitSellable}>确认可卖</Button>
            </div>
          )}

          {tab === 'snapshot' && (
            <div className="space-y-2">
              <input className={`${inputClassMono} w-full`} placeholder="现金" value={snapCash} onChange={(e) => setSnapCash(e.target.value)} />
              <textarea
                className={`${inputClassMono} w-full min-h-24`}
                placeholder={'每行: 代码,股数,成本,可卖\n600519,100,1680,100'}
                value={snapRows}
                onChange={(e) => setSnapRows(e.target.value)}
              />
              <Button size="sm" disabled={loading || !snapCash.trim()} onClick={submitSnapshot}>确认整账替换</Button>
              <p className="text-[11px] text-warning">整账会替换当前账面；须先取消未完成委托。</p>
            </div>
          )}

          <div>
            <label className="text-[11px] text-muted-foreground">调整原因（必填）</label>
            <input
              className={`${inputClass} w-full mt-1`}
              placeholder="例如：对齐券商 App 入金 / 红股到账"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
