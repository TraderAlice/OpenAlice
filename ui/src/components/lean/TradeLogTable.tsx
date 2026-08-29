import { useState, useMemo } from 'react'
import type { ClosedTrade, LeanOrder } from '../../api/lean'
import { SegmentedControl } from '../SegmentedControl'
import { Search, ArrowDownRight, ArrowUpRight, ArrowUpDown } from 'lucide-react'

interface TradeLogTableProps {
  closedTrades?: ClosedTrade[]
  orders?: LeanOrder[]
}

export function TradeLogTable({ closedTrades = [], orders = [] }: TradeLogTableProps) {
  const [tab, setTab] = useState<'trades' | 'orders'>('trades')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<string>('time')
  const [sortAsc, setSortAsc] = useState(false)

  const filteredTrades = useMemo(() => {
    let list = [...closedTrades]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.entryTime.toLowerCase().includes(q) ||
          t.exitTime.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      let valA: any = a.exitTime
      let valB: any = b.exitTime
      if (sortField === 'pnl') {
        valA = a.profitLoss
        valB = b.profitLoss
      } else if (sortField === 'qty') {
        valA = a.quantity
        valB = b.quantity
      }
      if (valA < valB) return sortAsc ? -1 : 1
      if (valA > valB) return sortAsc ? 1 : -1
      return 0
    })
    return list
  }, [closedTrades, search, sortField, sortAsc])

  const filteredOrders = useMemo(() => {
    let list = [...orders]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (o) =>
          o.symbol.toLowerCase().includes(q) ||
          o.direction.toLowerCase().includes(q) ||
          o.status.toLowerCase().includes(q) ||
          o.time.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      let valA: any = a.time
      let valB: any = b.time
      if (sortField === 'qty') {
        valA = a.quantity
        valB = b.quantity
      } else if (sortField === 'price') {
        valA = a.price
        valB = b.price
      }
      if (valA < valB) return sortAsc ? -1 : 1
      if (valA > valB) return sortAsc ? 1 : -1
      return 0
    })
    return list
  }, [orders, search, sortField, sortAsc])

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          options={[
            { value: 'trades', label: `Closed Trades (${closedTrades.length})` },
            { value: 'orders', label: `Orders (${orders.length})` }
          ]}
          onChange={(val) => setTab(val as 'trades' | 'orders')}
          ariaLabel="Trade logs view mode"
          compact
        />

        <div className="relative w-64 max-w-full">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search symbol, time, or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Table Content */}
      {tab === 'trades' ? (
        filteredTrades.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground italic">
            No closed trades found for this backtest
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="border-b border-border/80 text-[11px] font-sans text-muted-foreground uppercase">
                  <th className="py-2 px-3">Symbol</th>
                  <th
                    className="py-2 px-3 cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('time')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Entry / Exit Time</span>
                      <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th className="py-2 px-3">Entry Price</th>
                  <th className="py-2 px-3">Exit Price</th>
                  <th
                    className="py-2 px-3 cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('qty')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Quantity</span>
                      <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th
                    className="py-2 px-3 cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('pnl')}
                  >
                    <div className="flex items-center gap-1">
                      <span>P&L ($)</span>
                      <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th className="py-2 px-3">Fees</th>
                  <th className="py-2 px-3">Duration</th>
                  <th className="py-2 px-3">MAE / MFE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredTrades.map((t, idx) => {
                  const isWin = t.profitLoss >= 0
                  return (
                    <tr key={idx} className="hover:bg-secondary/40 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-foreground">{t.symbol}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                        <div>{new Date(t.entryTime).toLocaleDateString()} {new Date(t.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        <div className="text-muted-foreground/70">{new Date(t.exitTime).toLocaleDateString()} {new Date(t.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td className="py-2.5 px-3 text-foreground">{t.entryPrice.toFixed(5)}</td>
                      <td className="py-2.5 px-3 text-foreground">{t.exitPrice.toFixed(5)}</td>
                      <td className="py-2.5 px-3 text-foreground">{t.quantity.toLocaleString()}</td>
                      <td className={`py-2.5 px-3 font-bold ${isWin ? 'text-success' : 'text-destructive'}`}>
                        <div className="flex items-center gap-1">
                          {isWin ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                          <span>
                            {isWin ? '+' : ''}${t.profitLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">${t.totalFees.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">{t.duration}</td>
                      <td className="py-2.5 px-3 text-[11px] text-muted-foreground">
                        <span className="text-destructive">-${Math.abs(t.mae).toFixed(2)}</span> /{' '}
                        <span className="text-success">+${Math.abs(t.mfe).toFixed(2)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : filteredOrders.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground italic">
          No order records found for this backtest
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-border/80 text-[11px] font-sans text-muted-foreground uppercase">
                <th className="py-2 px-3">Order ID</th>
                <th className="py-2 px-3">Symbol</th>
                <th className="py-2 px-3">Direction</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Price</th>
                <th className="py-2 px-3">Quantity</th>
                <th className="py-2 px-3">Fee</th>
                <th className="py-2 px-3">Execution Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredOrders.map((o) => (
                <tr key={o.id} className="hover:bg-secondary/40 transition-colors">
                  <td className="py-2.5 px-3 text-muted-foreground font-mono">#{o.id}</td>
                  <td className="py-2.5 px-3 font-semibold text-foreground">{o.symbol}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        o.direction === 'Buy'
                          ? 'bg-success/15 text-success'
                          : o.direction === 'Sell'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {o.direction}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground">{o.status}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{o.type}</td>
                  <td className="py-2.5 px-3 text-foreground">${o.price.toFixed(5)}</td>
                  <td className="py-2.5 px-3 text-foreground">{o.quantity.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">${o.fee.toFixed(2)}</td>
                  <td className="py-2.5 px-3 text-muted-foreground text-[11px]">{o.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
