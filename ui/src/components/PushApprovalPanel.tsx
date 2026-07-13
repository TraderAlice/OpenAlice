import { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, GitCommitHorizontal, GitPullRequest, History, XCircle } from 'lucide-react'
import { EmptyState, Skeleton } from './StateViews'
import { formatRelativeTime, getIntlLocale } from '../lib/intl'
import { api } from '../api'
import { isUnsetDecimal } from '../lib/format'
import { filterAccountTierUTAs } from '../lib/uta-account-filter'
import type { UTASummary, WalletCommitLog, WalletOperation, WalletPushResult, WalletStatus } from '../api/types'

// ==================== Types ====================

type AccountRef = Pick<UTASummary, 'id' | 'label'>

interface StagedAccount {
  account: AccountRef
  status: WalletStatus
}

interface PendingAccount {
  account: AccountRef
  status: WalletStatus
}

interface AccountHistory {
  accountId: string
  label: string
  commits: WalletCommitLog[]
}

interface FlatCommit {
  accountId: string
  label: string
  commit: WalletCommitLog
}

type ReviewItem =
  | { id: string; kind: 'pending'; account: AccountRef; status: WalletStatus }
  | { id: string; kind: 'staged'; account: AccountRef; status: WalletStatus }
  | { id: string; kind: 'history'; accountId: string; label: string; commit: WalletCommitLog }

interface OperationDisplay {
  marker: '+' | '-' | '~' | '?'
  tone: 'buy' | 'sell' | 'modify' | 'neutral' | 'danger'
  title: string
  detail?: string
  symbol?: string
  status?: string
}

// ==================== Helpers ====================

function accountLabel(account: AccountRef): string {
  return account.label || account.id
}

function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 8) : 'none'
}

function opSymbol(op: WalletOperation): string {
  const raw = op.contract?.aliceId || op.contract?.symbol || op.contract?.localSymbol || ''
  const sep = raw.indexOf('|')
  return sep !== -1 ? raw.slice(sep + 1) : raw
}

function fmtNum(n: number | string | undefined | null): string {
  if (n == null || n === '') return ''
  if (isUnsetDecimal(n)) return ''
  if (typeof n === 'string') return n
  if (!Number.isFinite(n)) return String(n)
  const rounded = n.toFixed(8).replace(/\.?0+$/, '')
  const [intPart, decPart] = rounded.split('.')
  const withCommas = Number(intPart).toLocaleString(getIntlLocale())
  return decPart ? `${withCommas}.${decPart}` : withCommas
}

function orderTypeLabel(type: string | undefined): string {
  const raw = (type || '').toUpperCase()
  if (raw === 'MKT' || raw === 'MARKET') return 'MKT'
  if (raw === 'LMT' || raw === 'LIMIT') return 'LMT'
  return raw || 'ORDER'
}

function operationDisplay(op: WalletOperation): OperationDisplay {
  const symbol = opSymbol(op)
  switch (op.action) {
    case 'placeOrder': {
      const sideRaw = (op.order?.action || '').toUpperCase()
      const isBuy = sideRaw === 'BUY'
      const type = orderTypeLabel(op.order?.orderType)
      const qty = fmtNum(op.order?.totalQuantity ?? op.order?.cashQty)
      const price = fmtNum(op.order?.lmtPrice)
      const aux = fmtNum(op.order?.auxPrice)
      const detailParts = [
        type,
        qty ? `qty ${qty}` : null,
        price ? `limit ${price}` : null,
        aux ? `aux ${aux}` : null,
      ].filter(Boolean)
      return {
        marker: isBuy ? '+' : '-',
        tone: isBuy ? 'buy' : 'sell',
        title: `${sideRaw || 'ORDER'} ${symbol || 'unknown'}`.trim(),
        detail: detailParts.join(' -> '),
        symbol,
      }
    }
    case 'closePosition': {
      const qty = fmtNum(op.quantity)
      return {
        marker: '-',
        tone: 'sell',
        title: `CLOSE ${symbol || 'position'}`,
        detail: qty ? `quantity ${qty}` : undefined,
        symbol,
      }
    }
    case 'modifyOrder':
      return {
        marker: '~',
        tone: 'modify',
        title: `MODIFY ${op.orderId || 'order'}`,
        detail: symbol || undefined,
        symbol,
      }
    case 'cancelOrder':
      return {
        marker: '-',
        tone: 'danger',
        title: `CANCEL ${op.orderId || 'order'}`,
        detail: symbol || undefined,
        symbol,
      }
    case 'syncOrders':
      return {
        marker: '~',
        tone: 'neutral',
        title: 'SYNC ORDERS',
      }
    default:
      return {
        marker: '?',
        tone: 'neutral',
        title: op.action,
        symbol,
      }
  }
}

function historyOperationDisplay(op: WalletCommitLog['operations'][number]): OperationDisplay {
  const action = op.action.toUpperCase()
  const marker: OperationDisplay['marker'] =
    action.includes('BUY') || action.includes('PLACE') ? '+'
      : action.includes('SELL') || action.includes('CLOSE') || action.includes('CANCEL') ? '-'
        : '~'
  const tone: OperationDisplay['tone'] =
    op.status === 'rejected' ? 'danger'
      : marker === '+' ? 'buy'
        : marker === '-' ? 'sell'
          : 'modify'
  return {
    marker,
    tone,
    title: `${op.symbol !== 'unknown' ? op.symbol : op.action}`,
    detail: op.change || op.action,
    symbol: op.symbol,
    status: op.status,
  }
}

function toneClass(tone: OperationDisplay['tone']): string {
  switch (tone) {
    case 'buy': return 'border-green/30 bg-green/5 text-green'
    case 'sell': return 'border-red/30 bg-red/5 text-red'
    case 'danger': return 'border-red/35 bg-red/10 text-red'
    case 'modify': return 'border-yellow-400/30 bg-yellow-400/5 text-yellow-300'
    default: return 'border-border bg-bg-tertiary text-text-muted'
  }
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case 'submitted': return 'text-blue-400'
    case 'filled': return 'text-green'
    case 'rejected': return 'text-red'
    case 'user-rejected': return 'text-orange-400'
    case 'cancelled': return 'text-text-muted'
    default: return 'text-text-muted'
  }
}

function itemTimestamp(item: ReviewItem): string | null {
  return item.kind === 'history' ? item.commit.timestamp : null
}

function itemTitle(item: ReviewItem): string {
  if (item.kind === 'pending') return item.status.pendingMessage || 'Pending broker push'
  if (item.kind === 'staged') return 'Staged operations'
  return item.commit.message
}

function itemAccountLabel(item: ReviewItem): string {
  if (item.kind === 'history') return item.label
  return accountLabel(item.account)
}

function itemOperations(item: ReviewItem): OperationDisplay[] {
  if (item.kind === 'history') return item.commit.operations.map(historyOperationDisplay)
  return item.status.staged.map(operationDisplay)
}

// ==================== Component ====================

export function PushApprovalPanel() {
  const [accounts, setAccounts] = useState<AccountRef[]>([])
  const [staged, setStaged] = useState<StagedAccount[]>([])
  const [pending, setPending] = useState<PendingAccount[]>([])
  const [history, setHistory] = useState<AccountHistory[]>([])
  const [pushing, setPushing] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [confirmingPush, setConfirmingPush] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ accountId: string; data: WalletPushResult } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const { utas } = await api.trading.listUTASummaries()
      const accts = filterAccountTierUTAs(utas)
      setAccounts(accts)

      const stagedResults: StagedAccount[] = []
      const pendingResults: PendingAccount[] = []
      const historyResults: AccountHistory[] = []

      for (const account of accts) {
        try {
          const [status, { commits }] = await Promise.all([
            api.trading.walletStatus(account.id),
            api.trading.walletLog(account.id, 10),
          ])
          if (status.pendingMessage) {
            pendingResults.push({ account, status })
          } else if (status.staged.length > 0) {
            stagedResults.push({ account, status })
          }
          if (commits.length > 0) {
            historyResults.push({ accountId: account.id, label: accountLabel(account), commits })
          }
        } catch {
          /* skip unreachable account */
        }
      }

      setStaged(stagedResults)
      setPending(pendingResults)
      setHistory(historyResults)
    } catch {
      /* ignore list failures here; global API surfaces already show errors */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [poll])

  const handlePush = useCallback(async (accountId: string) => {
    setPushing(accountId)
    setConfirmingPush(null)
    setError(null)
    setLastResult(null)
    try {
      const data = await api.trading.walletPush(accountId)
      setLastResult({ accountId, data })
      await poll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setPushing(null)
    }
  }, [poll])

  const handleReject = useCallback(async (accountId: string) => {
    setRejecting(accountId)
    setError(null)
    try {
      await api.trading.walletReject(accountId)
      await poll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setRejecting(null)
    }
  }, [poll])

  const historyAccounts = useMemo(
    () => history.map((h) => ({ id: h.accountId, label: h.label })),
    [history],
  )

  const effectiveFilter =
    historyFilter && historyAccounts.some((a) => a.id === historyFilter)
      ? historyFilter
      : null

  const mergedHistory = useMemo(() => {
    const flat: FlatCommit[] = []
    for (const h of history) {
      if (effectiveFilter && h.accountId !== effectiveFilter) continue
      for (const commit of h.commits) {
        flat.push({ accountId: h.accountId, label: h.label, commit })
      }
    }
    flat.sort(
      (a, b) =>
        new Date(b.commit.timestamp).getTime() - new Date(a.commit.timestamp).getTime(),
    )
    return flat
  }, [history, effectiveFilter])

  const reviewItems = useMemo<ReviewItem[]>(() => [
    ...pending.map(({ account, status }) => ({
      id: `pending:${account.id}`,
      kind: 'pending' as const,
      account,
      status,
    })),
    ...staged.map(({ account, status }) => ({
      id: `staged:${account.id}`,
      kind: 'staged' as const,
      account,
      status,
    })),
    ...mergedHistory.map(({ accountId, label, commit }) => ({
      id: `history:${accountId}:${commit.hash}`,
      kind: 'history' as const,
      accountId,
      label,
      commit,
    })),
  ], [mergedHistory, pending, staged])

  useEffect(() => {
    if (reviewItems.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !reviewItems.some((item) => item.id === selectedId)) {
      setSelectedId(reviewItems[0].id)
    }
  }, [reviewItems, selectedId])

  const selected = reviewItems.find((item) => item.id === selectedId) ?? null
  const waitingCount = pending.length
  const stagedCount = staged.length
  const historyCount = mergedHistory.length
  const statusLabel =
    waitingCount > 0
      ? `${waitingCount} commit${waitingCount === 1 ? '' : 's'} waiting for approval`
      : stagedCount > 0
        ? `${stagedCount} staged set${stagedCount === 1 ? '' : 's'} waiting for commit`
        : 'Working tree clean'

  if (!loaded) return <TradingReviewSkeleton />

  if (accounts.length === 0) {
    return (
      <div className="h-full rounded-lg border border-border bg-bg-secondary/30">
        <EmptyState
          title="No trading accounts"
          description="Connect a broker account in Settings -> Trading before approving staged broker writes."
        />
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-bg-secondary/30 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col border-b border-border bg-bg-secondary md:border-b-0 md:border-r">
        <div className="shrink-0 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-text">
            {waitingCount > 0 ? (
              <AlertTriangle size={15} className="text-yellow-300" aria-hidden />
            ) : (
              <CheckCircle2 size={15} className="text-green" aria-hidden />
            )}
            <span className="truncate">{statusLabel}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
            <QueueStat label="Needs" value={waitingCount} tone={waitingCount > 0 ? 'warn' : 'muted'} />
            <QueueStat label="Staged" value={stagedCount} tone={stagedCount > 0 ? 'warn' : 'muted'} />
            <QueueStat label="Pushed" value={historyCount} tone="muted" />
          </div>
        </div>

        {historyAccounts.length > 1 && (
          <div className="shrink-0 border-b border-border/60 px-4 py-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted/60">Account filter</div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setHistoryFilter(null)}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  effectiveFilter === null
                    ? 'border-border bg-bg-tertiary text-text'
                    : 'border-border/50 text-text-muted hover:border-border hover:text-text'
                }`}
              >
                All
              </button>
              {historyAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setHistoryFilter(account.id)}
                  title={account.label}
                  className={`max-w-[120px] truncate rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    effectiveFilter === account.id
                      ? 'border-border bg-bg-tertiary text-text'
                      : 'border-border/50 text-text-muted hover:border-border hover:text-text'
                  }`}
                >
                  {account.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {reviewItems.length > 0 ? (
            <div className="space-y-1">
              {reviewItems.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  active={item.id === selectedId}
                  onClick={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          ) : (
            <CleanQueue />
          )}
        </div>
      </div>

      <div className="min-h-0 min-w-0 overflow-y-auto">
        <ReviewDetail
          item={selected}
          lastResult={lastResult}
          error={error}
          confirmingPush={confirmingPush}
          pushing={pushing}
          rejecting={rejecting}
          onConfirmPush={setConfirmingPush}
          onPush={handlePush}
          onReject={handleReject}
          onDismissError={() => setError(null)}
          onDismissResult={() => setLastResult(null)}
        />
      </div>
    </div>
  )
}

function TradingReviewSkeleton() {
  return (
    <div className="grid h-full min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-bg-secondary/30 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="border-b border-border p-4 md:border-b-0 md:border-r">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      </div>
      <div className="p-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
        <Skeleton className="mt-3 h-24 w-full rounded-lg" />
      </div>
    </div>
  )
}

function QueueStat({ label, value, tone }: { label: string; value: number; tone: 'warn' | 'muted' }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone === 'warn' ? 'border-yellow-400/30 bg-yellow-400/5' : 'border-border/60 bg-bg/35'}`}>
      <div className={`text-sm font-semibold tabular-nums ${tone === 'warn' ? 'text-yellow-300' : 'text-text'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-text-muted/55">{label}</div>
    </div>
  )
}

function QueueRow({ item, active, onClick }: { item: ReviewItem; active: boolean; onClick: () => void }) {
  const ops = itemOperations(item)
  const timestamp = itemTimestamp(item)
  const icon =
    item.kind === 'pending' ? <GitPullRequest size={14} aria-hidden />
      : item.kind === 'staged' ? <Clock3 size={14} aria-hidden />
        : <History size={14} aria-hidden />
  const badge =
    item.kind === 'pending' ? 'review'
      : item.kind === 'staged' ? 'staged'
        : shortHash(item.commit.hash)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-accent/50 bg-accent-dim text-text'
          : 'border-transparent text-text-muted hover:border-border/70 hover:bg-overlay hover:text-text'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-accent' : 'text-text-muted/70'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{itemTitle(item)}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-text-muted/65">
        <span className="truncate">{itemAccountLabel(item)}</span>
        <span className="text-text-muted/35">/</span>
        <span>{ops.length} op{ops.length === 1 ? '' : 's'}</span>
        <span className="ml-auto rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] text-text-muted/60">{badge}</span>
      </div>
      {timestamp && (
        <div className="mt-1 text-[10px] text-text-muted/45">{formatRelativeTime(timestamp)}</div>
      )}
    </button>
  )
}

function CleanQueue() {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-4 text-center">
      <CheckCircle2 size={26} className="text-green/80" aria-hidden />
      <div className="mt-3 text-[13px] font-medium text-text">Working tree clean</div>
      <div className="mt-1 max-w-[190px] text-[12px] leading-relaxed text-text-muted/60">
        No broker writes are waiting for approval.
      </div>
    </div>
  )
}

function ReviewDetail({
  item,
  lastResult,
  error,
  confirmingPush,
  pushing,
  rejecting,
  onConfirmPush,
  onPush,
  onReject,
  onDismissError,
  onDismissResult,
}: {
  item: ReviewItem | null
  lastResult: { accountId: string; data: WalletPushResult } | null
  error: string | null
  confirmingPush: string | null
  pushing: string | null
  rejecting: string | null
  onConfirmPush: (accountId: string | null) => void
  onPush: (accountId: string) => void
  onReject: (accountId: string) => void
  onDismissError: () => void
  onDismissResult: () => void
}) {
  if (!item) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <EmptyState
          icon={<CheckCircle2 size={24} aria-hidden />}
          title="Working tree clean"
          description="No broker writes are waiting for approval. Recent pushed commits will appear here."
        />
      </div>
    )
  }

  const ops = itemOperations(item)
  const isPending = item.kind === 'pending'
  const isStaged = item.kind === 'staged'
  const accountId = item.kind === 'history' ? item.accountId : item.account.id
  const title = itemTitle(item)

  return (
    <div className="min-h-full p-4 md:p-5">
      <div className="mx-auto max-w-[980px] space-y-4">
        {lastResult && (
          <ResultBanner result={lastResult.data} onDismiss={onDismissResult} />
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={onDismissError} className="text-text-muted hover:text-text">Dismiss</button>
          </div>
        )}

        <div className="rounded-lg border border-border bg-bg">
          <div className="border-b border-border px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <StatusPill item={item} />
                  <span className="text-[11px] text-text-muted">{itemAccountLabel(item)}</span>
                  {item.kind === 'history' && (
                    <span className="font-mono text-[11px] text-text-muted/60">{shortHash(item.commit.hash)}</span>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-text">{title}</h3>
                <div className="mt-1 text-[12px] text-text-muted">
                  {item.kind === 'history'
                    ? `Pushed ${formatRelativeTime(item.commit.timestamp)}`
                    : `${ops.length} proposed broker operation${ops.length === 1 ? '' : 's'} on head ${shortHash(item.status.head)}`}
                </div>
              </div>
              {isPending && (
                <div className="flex shrink-0 items-center gap-2">
                  {confirmingPush === accountId ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onPush(accountId)}
                        disabled={pushing !== null}
                        className="btn-primary-sm"
                      >
                        {pushing === accountId ? 'Pushing...' : 'Confirm push'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirmPush(null)}
                        className="rounded-md px-2.5 py-1.5 text-[12px] text-text-muted transition-colors hover:bg-overlay hover:text-text"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onConfirmPush(accountId)}
                        disabled={pushing !== null || rejecting !== null}
                        className="btn-primary-sm"
                      >
                        Approve & Push
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(accountId)}
                        disabled={pushing !== null || rejecting !== null}
                        className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:border-red/50 hover:text-red disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {rejecting === accountId ? 'Rejecting...' : 'Reject'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 space-y-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-muted/70">
                <GitCommitHorizontal size={14} aria-hidden />
                Operation diff
              </div>
              <div className="space-y-2">
                {ops.map((op, index) => (
                  <OperationRow key={`${op.title}:${index}`} op={op} />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <ReviewSummary item={item} operations={ops} />
              {isStaged && (
                <div className="rounded-md border border-yellow-400/25 bg-yellow-400/5 px-3 py-2 text-[12px] leading-relaxed text-yellow-100/80">
                  These operations are staged but do not have a commit message yet. The agent still needs to commit before this can be pushed.
                </div>
              )}
              {isPending && (
                <div className="rounded-md border border-red/25 bg-red/5 px-3 py-2 text-[12px] leading-relaxed text-red/90">
                  Approval pushes these operations to the broker account. Check account, side, quantity, and order type before confirming.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ item }: { item: ReviewItem }) {
  if (item.kind === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[11px] font-medium text-yellow-200">
        <AlertTriangle size={12} aria-hidden />
        Needs approval
      </span>
    )
  }
  if (item.kind === 'staged') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/25 bg-blue-400/10 px-2 py-0.5 text-[11px] font-medium text-blue-200">
        <Clock3 size={12} aria-hidden />
        Staged
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-green/25 bg-green/10 px-2 py-0.5 text-[11px] font-medium text-green">
      <CheckCircle2 size={12} aria-hidden />
      Pushed
    </span>
  )
}

function OperationRow({ op }: { op: OperationDisplay }) {
  return (
    <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-bg-secondary/50">
      <div className={`flex items-center justify-center border-r font-mono text-sm font-semibold ${toneClass(op.tone)}`}>
        {op.marker}
      </div>
      <div className="min-w-0 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-[13px] font-medium text-text">{op.title}</span>
          {op.status && (
            <span className={`text-[11px] ${statusClass(op.status)}`}>{op.status}</span>
          )}
        </div>
        {op.detail && (
          <div className="mt-0.5 break-words text-[12px] text-text-muted">{op.detail}</div>
        )}
      </div>
    </div>
  )
}

function ReviewSummary({ item, operations }: { item: ReviewItem; operations: OperationDisplay[] }) {
  const symbols = Array.from(new Set(operations.map((op) => op.symbol).filter(Boolean)))
  const buyCount = operations.filter((op) => op.tone === 'buy').length
  const sellCount = operations.filter((op) => op.tone === 'sell' || op.tone === 'danger').length
  const modifyCount = operations.length - buyCount - sellCount

  return (
    <div className="rounded-md border border-border bg-bg-secondary/60 p-3">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-text-muted/70">Review summary</div>
      <dl className="mt-3 space-y-2 text-[12px]">
        <SummaryRow label="Account" value={itemAccountLabel(item)} />
        <SummaryRow label="Operations" value={String(operations.length)} />
        <SummaryRow label="Symbols" value={symbols.length > 0 ? symbols.slice(0, 4).join(', ') : 'none'} />
        <SummaryRow label="Buys" value={String(buyCount)} />
        <SummaryRow label="Sells / cancels" value={String(sellCount)} />
        <SummaryRow label="Modify / sync" value={String(modifyCount)} />
        {item.kind !== 'history' && <SummaryRow label="Head" value={shortHash(item.status.head)} />}
      </dl>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-text" title={value}>{value}</dd>
    </div>
  )
}

function ResultBanner({ result, onDismiss }: { result: WalletPushResult; onDismiss: () => void }) {
  const hasRejected = result.rejected.length > 0
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
      hasRejected ? 'border-red/30 bg-red/5 text-red' : 'border-green/25 bg-green/5 text-green'
    }`}>
      {hasRejected ? <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {result.submitted.length} submitted, {result.rejected.length} rejected
        </div>
        {result.rejected.map((entry, index) => (
          <div key={`${entry.action}:${index}`} className="mt-0.5 text-red/80">{entry.error || entry.action}</div>
        ))}
      </div>
      <button type="button" onClick={onDismiss} className="text-text-muted hover:text-text">Dismiss</button>
    </div>
  )
}
