import { useState, useEffect, useCallback, useMemo, useRef, type Ref } from 'react'
import type { TFunction } from 'i18next'
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock3, GitCommitHorizontal, GitPullRequest, History, RefreshCw, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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

interface ReviewVerification {
  total: number
  verified: number
  failed: AccountRef[]
  listUnavailable: boolean
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
  return hash ? hash.slice(0, 8) : '—'
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

function orderTypeLabel(type: string | undefined, t: TFunction): string {
  const raw = (type || '').toUpperCase()
  if (raw === 'MKT' || raw === 'MARKET') return 'MKT'
  if (raw === 'LMT' || raw === 'LIMIT') return 'LMT'
  return raw || t('tradingReview.operation.order')
}

function operationDisplay(op: WalletOperation, t: TFunction): OperationDisplay {
  const symbol = opSymbol(op)
  switch (op.action) {
    case 'placeOrder': {
      const sideRaw = (op.order?.action || '').toUpperCase()
      const isBuy = sideRaw === 'BUY'
      const side = isBuy
        ? t('tradingReview.operation.buy')
        : sideRaw === 'SELL'
          ? t('tradingReview.operation.sell')
          : sideRaw || t('tradingReview.operation.order')
      const type = orderTypeLabel(op.order?.orderType, t)
      const qty = fmtNum(op.order?.totalQuantity ?? op.order?.cashQty)
      const price = fmtNum(op.order?.lmtPrice)
      const aux = fmtNum(op.order?.auxPrice)
      const detailParts = [
        type,
        qty ? t('tradingReview.operation.quantityShort', { value: qty }) : null,
        price ? t('tradingReview.operation.limitPrice', { value: price }) : null,
        aux ? t('tradingReview.operation.auxPrice', { value: aux }) : null,
      ].filter(Boolean)
      return {
        marker: isBuy ? '+' : '-',
        tone: isBuy ? 'buy' : 'sell',
        title: t('tradingReview.operation.placeTitle', {
          side,
          symbol: symbol || t('tradingReview.operation.unknown'),
        }),
        detail: detailParts.join(' → '),
        symbol,
      }
    }
    case 'closePosition': {
      const qty = fmtNum(op.quantity)
      return {
        marker: '-',
        tone: 'sell',
        title: t('tradingReview.operation.closeTitle', {
          symbol: symbol || t('tradingReview.operation.position'),
        }),
        detail: qty ? t('tradingReview.operation.quantity', { value: qty }) : undefined,
        symbol,
      }
    }
    case 'modifyOrder':
      return {
        marker: '~',
        tone: 'modify',
        title: t('tradingReview.operation.modifyTitle', {
          order: op.orderId || t('tradingReview.operation.order'),
        }),
        detail: symbol || undefined,
        symbol,
      }
    case 'cancelOrder':
      return {
        marker: '-',
        tone: 'danger',
        title: t('tradingReview.operation.cancelTitle', {
          order: op.orderId || t('tradingReview.operation.order'),
        }),
        detail: symbol || undefined,
        symbol,
      }
    case 'syncOrders':
      return {
        marker: '~',
        tone: 'neutral',
        title: t('tradingReview.operation.syncOrders'),
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
    case 'buy': return 'border-success/30 bg-success/5 text-success'
    case 'sell': return 'border-destructive/30 bg-destructive/5 text-destructive'
    case 'danger': return 'border-destructive/35 bg-destructive/10 text-destructive'
    case 'modify': return 'border-warning/30 bg-warning/5 text-warning'
    default: return 'border-border bg-muted text-muted-foreground'
  }
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case 'submitted': return 'text-info'
    case 'filled': return 'text-success'
    case 'rejected': return 'text-destructive'
    case 'user-rejected': return 'text-warning'
    case 'cancelled': return 'text-muted-foreground'
    default: return 'text-muted-foreground'
  }
}

function statusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'submitted': return t('tradingReview.operationStatus.submitted')
    case 'filled': return t('tradingReview.operationStatus.filled')
    case 'rejected': return t('tradingReview.operationStatus.rejected')
    case 'user-rejected': return t('tradingReview.operationStatus.userRejected')
    case 'cancelled': return t('tradingReview.operationStatus.cancelled')
    default: return status
  }
}

function itemTimestamp(item: ReviewItem): string | null {
  return item.kind === 'history' ? item.commit.timestamp : null
}

function itemTitle(item: ReviewItem, t: TFunction): string {
  if (item.kind === 'pending') return item.status.pendingMessage || t('tradingReview.pendingPush')
  if (item.kind === 'staged') return t('tradingReview.stagedOperations')
  return item.commit.message
}

function itemAccountLabel(item: ReviewItem): string {
  if (item.kind === 'history') return item.label
  return accountLabel(item.account)
}

function itemOperations(item: ReviewItem, t: TFunction): OperationDisplay[] {
  if (item.kind === 'history') return item.commit.operations.map(historyOperationDisplay)
  return item.status.staged.map((operation) => operationDisplay(operation, t))
}

function mergeAccountResults<T>(
  accounts: AccountRef[],
  verifiedAccountIds: Set<string>,
  fresh: T[],
  previous: T[],
  accountId: (item: T) => string,
): T[] {
  const freshByAccount = new Map(fresh.map((item) => [accountId(item), item]))
  const previousByAccount = new Map(previous.map((item) => [accountId(item), item]))
  return accounts.flatMap((account) => {
    const item = verifiedAccountIds.has(account.id)
      ? freshByAccount.get(account.id)
      : previousByAccount.get(account.id)
    return item ? [item] : []
  })
}

// ==================== Component ====================

export function PushApprovalPanel() {
  const { t } = useTranslation()
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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [retryingVerification, setRetryingVerification] = useState(false)
  const mobileBackRef = useRef<HTMLButtonElement | null>(null)
  const activeQueueRowRef = useRef<HTMLButtonElement | null>(null)
  const [verification, setVerification] = useState<ReviewVerification>({
    total: 0,
    verified: 0,
    failed: [],
    listUnavailable: false,
  })

  const poll = useCallback(async () => {
    try {
      const { utas } = await api.trading.listUTASummaries()
      const accts = filterAccountTierUTAs(utas)
      setAccounts(accts)

      const stagedResults: StagedAccount[] = []
      const pendingResults: PendingAccount[] = []
      const historyResults: AccountHistory[] = []
      const verifiedAccountIds = new Set<string>()
      const failedAccounts: AccountRef[] = []

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
          verifiedAccountIds.add(account.id)
        } catch {
          failedAccounts.push(account)
        }
      }

      setStaged((previous) => mergeAccountResults(
        accts,
        verifiedAccountIds,
        stagedResults,
        previous,
        (item) => item.account.id,
      ))
      setPending((previous) => mergeAccountResults(
        accts,
        verifiedAccountIds,
        pendingResults,
        previous,
        (item) => item.account.id,
      ))
      setHistory((previous) => mergeAccountResults(
        accts,
        verifiedAccountIds,
        historyResults,
        previous,
        (item) => item.accountId,
      ))
      setVerification({
        total: accts.length,
        verified: verifiedAccountIds.size,
        failed: failedAccounts,
        listUnavailable: false,
      })
    } catch {
      setVerification((current) => ({
        ...current,
        verified: 0,
        failed: [],
        listUnavailable: true,
      }))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [poll])

  const retryVerification = useCallback(async () => {
    setRetryingVerification(true)
    try {
      await poll()
    } finally {
      setRetryingVerification(false)
    }
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
      setError(err instanceof Error ? err.message : t('tradingReview.pushFailed'))
    } finally {
      setPushing(null)
    }
  }, [poll, t])

  const handleReject = useCallback(async (accountId: string) => {
    setRejecting(accountId)
    setError(null)
    try {
      await api.trading.walletReject(accountId)
      await poll()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tradingReview.rejectFailed'))
    } finally {
      setRejecting(null)
    }
  }, [poll, t])

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
      setMobileDetailOpen(false)
      return
    }
    if (!selectedId || !reviewItems.some((item) => item.id === selectedId)) {
      setSelectedId(reviewItems[0].id)
      setMobileDetailOpen(false)
    }
  }, [reviewItems, selectedId])

  useEffect(() => {
    if (!mobileDetailOpen) return
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(max-width: 767px)').matches) return
    mobileBackRef.current?.focus()
  }, [mobileDetailOpen])

  const selected = reviewItems.find((item) => item.id === selectedId) ?? null
  const waitingCount = pending.length
  const stagedCount = staged.length
  const historyCount = mergedHistory.length
  const verificationIncomplete = verification.listUnavailable || verification.failed.length > 0
  const statusLabel =
    verificationIncomplete
      ? verification.listUnavailable
        ? t('tradingReview.queue.verificationUnknown')
        : t('tradingReview.queue.verificationCount', {
          verified: verification.verified,
          total: verification.total,
        })
      : waitingCount > 0
      ? t('tradingReview.queue.waitingApproval', { count: waitingCount })
      : stagedCount > 0
        ? t('tradingReview.queue.stagedWaiting', { count: stagedCount })
        : t('tradingReview.queue.clean')

  if (!loaded) return <TradingReviewSkeleton />

  if (accounts.length === 0 && !verification.listUnavailable) {
    return (
      <div className="h-full rounded-lg border border-border bg-secondary/30">
        <EmptyState
          title={t('tradingReview.noAccounts')}
          description={t('tradingReview.noAccountsDescription')}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {verificationIncomplete && (
        <VerificationNotice
          verification={verification}
          retrying={retryingVerification}
          onRetry={() => void retryVerification()}
        />
      )}
      <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-secondary/30 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
        <div
          data-testid="trading-review-queue"
          className={`${mobileDetailOpen ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-col bg-secondary md:flex md:border-r`}
        >
          <div className="shrink-0 border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
              {verificationIncomplete || waitingCount > 0 ? (
                <AlertTriangle size={15} className="text-warning" aria-hidden />
              ) : (
                <CheckCircle2 size={15} className="text-success" aria-hidden />
              )}
              <span className="truncate">{statusLabel}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
              <QueueStat label={t('tradingReview.queue.needs')} value={waitingCount} tone={waitingCount > 0 ? 'warn' : 'muted'} />
              <QueueStat label={t('tradingReview.queue.staged')} value={stagedCount} tone={stagedCount > 0 ? 'warn' : 'muted'} />
              <QueueStat label={t('tradingReview.queue.pushed')} value={historyCount} tone="muted" />
            </div>
          </div>

          {historyAccounts.length > 1 && (
            <div className="shrink-0 border-b border-border/60 px-4 py-2">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {t('tradingReview.queue.accountFilter')}
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setHistoryFilter(null)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    effectiveFilter === null
                      ? 'border-border bg-muted text-foreground'
                      : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  {t('tradingReview.queue.all')}
                </button>
                {historyAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setHistoryFilter(account.id)}
                    title={account.label}
                    className={`max-w-[120px] truncate rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      effectiveFilter === account.id
                        ? 'border-border bg-muted text-foreground'
                        : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'
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
                    buttonRef={item.id === selectedId ? activeQueueRowRef : undefined}
                    onClick={() => {
                      setSelectedId(item.id)
                      setMobileDetailOpen(true)
                    }}
                  />
                ))}
              </div>
            ) : verificationIncomplete ? (
              <UnverifiedQueue />
            ) : (
              <CleanQueue />
            )}
          </div>
        </div>

        <div
          data-testid="trading-review-detail"
          className={`${mobileDetailOpen ? 'block' : 'hidden'} min-h-0 min-w-0 overflow-x-hidden overflow-y-auto md:block`}
        >
          <div className="sticky top-0 z-10 border-b border-border bg-secondary/95 px-3 py-2 md:hidden">
            <button
              ref={mobileBackRef}
              type="button"
              onClick={() => {
                setMobileDetailOpen(false)
                requestAnimationFrame(() => activeQueueRowRef.current?.focus())
              }}
              className="oa-pressable inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-primary"
            >
              <ChevronLeft size={15} aria-hidden />
              {t('tradingReview.queue.backToQueue')}
            </button>
          </div>
          <ReviewDetail
            item={selected}
            verificationIncomplete={verificationIncomplete}
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
    </div>
  )
}

function VerificationNotice({
  verification,
  retrying,
  onRetry,
}: {
  verification: ReviewVerification
  retrying: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const failedAccounts = verification.failed.map(accountLabel).join(', ')
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-warning" role="status">
      <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">
          {verification.listUnavailable
            ? t('tradingReview.queue.verificationUnknown')
            : t('tradingReview.queue.verificationCount', {
              verified: verification.verified,
              total: verification.total,
            })}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {verification.listUnavailable
            ? t('tradingReview.queue.listUnavailableDescription')
            : t('tradingReview.queue.verificationDescription')}
        </p>
        {failedAccounts && (
          <p className="mt-1 text-[11px] text-warning">
            {t('tradingReview.queue.failedAccounts', { accounts: failedAccounts })}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={retrying}
        onClick={onRetry}
        className="oa-pressable inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-warning/35 bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-warning/10 disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={13} className={retrying ? 'animate-spin' : undefined} aria-hidden />
        {retrying ? t('tradingReview.queue.retrying') : t('tradingReview.queue.retry')}
      </button>
    </div>
  )
}

function TradingReviewSkeleton() {
  return (
    <div className="grid h-full min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/30 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
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
    <div className={`rounded-md border px-2 py-1.5 ${tone === 'warn' ? 'border-warning/30 bg-warning/5' : 'border-border/60 bg-background/35'}`}>
      <div className={`text-sm font-semibold tabular-nums ${tone === 'warn' ? 'text-warning' : 'text-foreground'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/55">{label}</div>
    </div>
  )
}

function QueueRow({
  item,
  active,
  buttonRef,
  onClick,
}: {
  item: ReviewItem
  active: boolean
  buttonRef?: Ref<HTMLButtonElement>
  onClick: () => void
}) {
  const { t } = useTranslation()
  const ops = itemOperations(item, t)
  const timestamp = itemTimestamp(item)
  const icon =
    item.kind === 'pending' ? <GitPullRequest size={14} aria-hidden />
      : item.kind === 'staged' ? <Clock3 size={14} aria-hidden />
        : <History size={14} aria-hidden />
  const badge =
    item.kind === 'pending' ? t('tradingReview.queue.review')
      : item.kind === 'staged' ? t('tradingReview.queue.stagedBadge')
        : shortHash(item.commit.hash)

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-primary/50 bg-primary-muted text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent hover:text-foreground'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-primary' : 'text-muted-foreground/70'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{itemTitle(item, t)}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground/65">
        <span className="truncate">{itemAccountLabel(item)}</span>
        <span className="text-muted-foreground/35">/</span>
        <span>{t('tradingReview.queue.operationCount', { count: ops.length })}</span>
        <span className="ml-auto rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/60">{badge}</span>
      </div>
      {timestamp && (
        <div className="mt-1 text-[10px] text-muted-foreground/45">{formatRelativeTime(timestamp)}</div>
      )}
    </button>
  )
}

function CleanQueue() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-4 text-center">
      <CheckCircle2 size={26} className="text-success/80" aria-hidden />
      <div className="mt-3 text-[13px] font-medium text-foreground">{t('tradingReview.queue.clean')}</div>
      <div className="mt-1 max-w-[190px] text-[12px] leading-relaxed text-muted-foreground/60">
        {t('tradingReview.queue.cleanDescription')}
      </div>
    </div>
  )
}

function UnverifiedQueue() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-4 text-center">
      <AlertTriangle size={26} className="text-warning/80" aria-hidden />
      <div className="mt-3 text-[13px] font-medium text-foreground">{t('tradingReview.queue.verificationUnknown')}</div>
      <div className="mt-1 max-w-[210px] text-[12px] leading-relaxed text-muted-foreground/70">
        {t('tradingReview.queue.verificationDescription')}
      </div>
    </div>
  )
}

function ReviewDetail({
  item,
  verificationIncomplete,
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
  verificationIncomplete: boolean
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
  const { t } = useTranslation()
  if (!item) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <EmptyState
          icon={verificationIncomplete
            ? <AlertTriangle size={24} className="text-warning" aria-hidden />
            : <CheckCircle2 size={24} aria-hidden />}
          title={t(verificationIncomplete
            ? 'tradingReview.queue.verificationUnknown'
            : 'tradingReview.queue.clean')}
          description={t(verificationIncomplete
            ? 'tradingReview.queue.verificationDescription'
            : 'tradingReview.queue.cleanDetailDescription')}
        />
      </div>
    )
  }

  const ops = itemOperations(item, t)
  const isPending = item.kind === 'pending'
  const isStaged = item.kind === 'staged'
  const accountId = item.kind === 'history' ? item.accountId : item.account.id
  const title = itemTitle(item, t)

  return (
    <div className="min-h-full p-4 md:p-5">
      <div className="mx-auto max-w-[980px] space-y-4">
        {lastResult && (
          <ResultBanner result={lastResult.data} onDismiss={onDismissResult} />
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={onDismissError} className="text-muted-foreground hover:text-foreground">
              {t('tradingReview.dismiss')}
            </button>
          </div>
        )}

        <div className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <StatusPill item={item} />
                  <span className="text-[11px] text-muted-foreground">{itemAccountLabel(item)}</span>
                  {item.kind === 'history' && (
                    <span className="font-mono text-[11px] text-muted-foreground/60">{shortHash(item.commit.hash)}</span>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {item.kind === 'history'
                    ? t('tradingReview.pushedAgo', { time: formatRelativeTime(item.commit.timestamp) })
                    : t('tradingReview.proposedOperations', {
                      count: ops.length,
                      head: shortHash(item.status.head),
                    })}
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
                        {pushing === accountId ? t('tradingReview.pushing') : t('tradingReview.confirmPush')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfirmPush(null)}
                        className="rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {t('tradingReview.cancel')}
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
                        {t('tradingReview.approvePush')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject(accountId)}
                        disabled={pushing !== null || rejecting !== null}
                        className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {rejecting === accountId ? t('tradingReview.rejecting') : t('tradingReview.reject')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className="min-w-0 space-y-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <GitCommitHorizontal size={14} aria-hidden />
                {t('tradingReview.operationDiff')}
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
                <div className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-[12px] leading-relaxed text-warning/80">
                  {t('tradingReview.stagedWarning')}
                </div>
              )}
              {isPending && (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] leading-relaxed text-destructive/90">
                  {t('tradingReview.approvalWarning')}
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
  const { t } = useTranslation()
  if (item.kind === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
        <AlertTriangle size={12} aria-hidden />
        {t('tradingReview.status.needsApproval')}
      </span>
    )
  }
  if (item.kind === 'staged') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-info/25 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
        <Clock3 size={12} aria-hidden />
        {t('tradingReview.status.staged')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
      <CheckCircle2 size={12} aria-hidden />
      {t('tradingReview.status.pushed')}
    </span>
  )
}

function OperationRow({ op }: { op: OperationDisplay }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-secondary/50">
      <div className={`flex items-center justify-center border-r font-mono text-sm font-semibold ${toneClass(op.tone)}`}>
        {op.marker}
      </div>
      <div className="min-w-0 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-[13px] font-medium text-foreground">{op.title}</span>
          {op.status && (
            <span className={`text-[11px] ${statusClass(op.status)}`}>{statusLabel(op.status, t)}</span>
          )}
        </div>
        {op.detail && (
          <div className="mt-0.5 break-words text-[12px] text-muted-foreground">{op.detail}</div>
        )}
      </div>
    </div>
  )
}

function ReviewSummary({ item, operations }: { item: ReviewItem; operations: OperationDisplay[] }) {
  const { t } = useTranslation()
  const symbols = Array.from(new Set(operations.map((op) => op.symbol).filter(Boolean)))
  const buyCount = operations.filter((op) => op.tone === 'buy').length
  const sellCount = operations.filter((op) => op.tone === 'sell' || op.tone === 'danger').length
  const modifyCount = operations.length - buyCount - sellCount

  return (
    <div className="rounded-md border border-border bg-secondary/60 p-3">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {t('tradingReview.summary.title')}
      </div>
      <dl className="mt-3 space-y-2 text-[12px]">
        <SummaryRow label={t('tradingReview.summary.account')} value={itemAccountLabel(item)} />
        <SummaryRow label={t('tradingReview.summary.operations')} value={String(operations.length)} />
        <SummaryRow
          label={t('tradingReview.summary.symbols')}
          value={symbols.length > 0 ? symbols.slice(0, 4).join(', ') : t('tradingReview.summary.none')}
        />
        <SummaryRow label={t('tradingReview.summary.buys')} value={String(buyCount)} />
        <SummaryRow label={t('tradingReview.summary.sellsCancels')} value={String(sellCount)} />
        <SummaryRow label={t('tradingReview.summary.modifySync')} value={String(modifyCount)} />
        {item.kind !== 'history' && <SummaryRow label={t('tradingReview.summary.head')} value={shortHash(item.status.head)} />}
      </dl>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground" title={value}>{value}</dd>
    </div>
  )
}

function ResultBanner({ result, onDismiss }: { result: WalletPushResult; onDismiss: () => void }) {
  const { t } = useTranslation()
  const hasRejected = result.rejected.length > 0
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
      hasRejected ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-success/25 bg-success/5 text-success'
    }`}>
      {hasRejected ? <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {t('tradingReview.result', {
            submitted: result.submitted.length,
            rejected: result.rejected.length,
          })}
        </div>
        {result.rejected.map((entry, index) => (
          <div key={`${entry.action}:${index}`} className="mt-0.5 text-destructive/80">{entry.error || entry.action}</div>
        ))}
      </div>
      <button type="button" onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
        {t('tradingReview.dismiss')}
      </button>
    </div>
  )
}
