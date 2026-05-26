import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { fmt, fmtPnl } from '../lib/i18n-format'
import { isUnsetDecimal } from '../lib/format'
import type { TradingAccount, WalletStatus, WalletPushResult, WalletCommitLog } from '../api/types'

// ==================== Types ====================

interface StagedAccount {
  account: TradingAccount
  status: WalletStatus
}

interface PendingAccount {
  account: TradingAccount
  status: WalletStatus
}

interface AccountHistory {
  accountId: string
  label: string
  commits: WalletCommitLog[]
}

// ==================== Helpers ====================

/** Extract symbol from operation. */
function opSymbol(op: WalletStatus['staged'][number]): string {
  const raw = op.contract?.aliceId || op.contract?.symbol || op.contract?.localSymbol || ''
  // Strip "accountId|" prefix from aliceId
  const sep = raw.indexOf('|')
  return sep !== -1 ? raw.slice(sep + 1) : raw
}

function fmtNum(n: number | string | undefined | null): string {
  if (n == null || n === '') return ''
  if (isUnsetDecimal(n)) return ''
  if (typeof n === 'string') return n
  if (!Number.isFinite(n)) return String(n)
  return fmt(n, 'USD')
}

/** Format operation for display — returns { text, isBuy } */
function formatOp(op: WalletStatus['staged'][number]): { text: string; side?: 'buy' | 'sell' } {
  const symbol = opSymbol(op)
  switch (op.action) {
    case 'placeOrder': {
      const sideRaw = (op.order?.action || '').toUpperCase()
      const isBuy = sideRaw === 'BUY'
      const type = (op.order?.orderType || '').toUpperCase()
      const typeBadge = type === 'MKT' || type === 'MARKET' ? 'MKT' : type === 'LMT' || type === 'LIMIT' ? 'LMT' : type
      const qtyStr = fmtNum(op.order?.totalQuantity ?? op.order?.cashQty)
      const priceStr = fmtNum(op.order?.lmtPrice)
      const price = priceStr ? ` @ ${priceStr}` : ''
      return {
        text: `${sideRaw} ${qtyStr} ${symbol} ${typeBadge}${price}`.trim(),
        side: isBuy ? 'buy' : 'sell',
      }
    }
    case 'closePosition': {
      const qtyStr = fmtNum(op.quantity)
      return { text: `CLOSE ${symbol}${qtyStr ? ` (${qtyStr})` : ''}`, side: 'sell' }
    }
    case 'modifyOrder':
      return { text: `MODIFY ${op.orderId || '?'}` }
    case 'cancelOrder':
      return { text: `CANCEL ${op.orderId || '?'}` }
    case 'syncOrders':
      return { text: 'SYNC' }
    default:
      return { text: op.action }
  }
}

/** Relative time string. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Status badge color. */
function statusColor(status: string): string {
  switch (status) {
    case 'submitted': return 'text-blue-400'
    case 'filled': return 'text-green'
    case 'rejected': return 'text-red'
    case 'user-rejected': return 'text-orange-400'
    case 'cancelled': return 'text-text-muted'
    default: return 'text-text-muted'
  }
}

// ==================== Component ====================

export function PushApprovalPanel() {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [staged, setStaged] = useState<StagedAccount[]>([])
  const [pending, setPending] = useState<PendingAccount[]>([])
  const [history, setHistory] = useState<AccountHistory[]>([])
  const [pushing, setPushing] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [confirmingPush, setConfirmingPush] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ accountId: string; data: WalletPushResult } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const { utas: accts } = await api.trading.listUTAs()
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
            historyResults.push({ accountId: account.id, label: account.label || account.id, commits })
          }
        } catch { /* skip unreachable */ }
      }

      setStaged(stagedResults)
      setPending(pendingResults)
      setHistory(historyResults)
    } catch { /* ignore */ }
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

  // No trading accounts configured — hide panel entirely
  if (accounts.length === 0) return null

  const hasStaged = staged.length > 0
  const hasPending = pending.length > 0
  const hasHistory = history.length > 0

  return (
    <div className="h-full bg-bg-secondary/30 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
          <path d="M12 20V10M18 20V4M6 20v-4" />
        </svg>
        <h3 className="text-sm font-semibold text-text">{t('trading.title')}</h3>
        {hasPending && (
          <span className="ml-auto w-2 h-2 rounded-full bg-accent animate-pulse" title="Pending operations" />
        )}
        {!hasPending && hasStaged && (
          <span className="ml-auto w-2 h-2 rounded-full bg-yellow-400 animate-pulse" title={t('push.stagedUncommitted')} />
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ==================== Staged (uncommitted) Section ==================== */}
        {hasStaged && (
          <div className="px-3 py-3 space-y-3">
            {staged.map(({ account, status }) => (
              <div key={account.id} className="space-y-2">
                <div className="text-[11px] text-text-muted font-medium uppercase tracking-wider">
                  {account.label || account.id}
                </div>

                <div className="text-xs text-yellow-400/80 font-medium px-2 py-1.5 rounded bg-yellow-400/5 border border-yellow-400/20">
                  {t('push.stagedWaiting', 'Staged — waiting for AI to commit')}
                </div>

                <div className="space-y-0.5">
                  {status.staged.map((op, i) => {
                    const { text, side } = formatOp(op)
                    return (
                      <div
                        key={i}
                        className={`text-xs font-mono px-2 py-1 rounded bg-bg/50 ${
                          side === 'buy' ? 'text-green' : side === 'sell' ? 'text-red' : 'text-text-muted'
                        }`}
                      >
                        {text}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ==================== Pending Section ==================== */}
        {hasPending ? (
          <div className="px-3 py-3 space-y-3">
            {pending.map(({ account, status }) => (
              <div key={account.id} className="space-y-2">
                <div className="text-[11px] text-text-muted font-medium uppercase tracking-wider">
                  {account.label || account.id}
                </div>

                {/* Commit message */}
                <div className="text-xs text-text font-medium px-2 py-1.5 rounded bg-bg-secondary border border-border">
                  {status.pendingMessage}
                </div>

                {/* Staged operations */}
                <div className="space-y-0.5">
                  {status.staged.map((op, i) => {
                    const { text, side } = formatOp(op)
                    return (
                      <div
                        key={i}
                        className={`text-xs font-mono px-2 py-1 rounded bg-bg/50 ${
                          side === 'buy' ? 'text-green' : side === 'sell' ? 'text-red' : 'text-text-muted'
                        }`}
                      >
                        {text}
                      </div>
                    )
                  })}
                </div>

                {/* Inline confirm or action buttons */}
                {confirmingPush === account.id ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted">{t('push.executeOps', 'Execute {{count}} op(s)?', { count: status.staged.length })}</span>
                    <button
                      onClick={() => handlePush(account.id)}
                      disabled={pushing !== null}
                      className="btn-primary-sm"
                    >
                      {pushing === account.id ? '...' : t('push.confirm', 'Confirm')}
                    </button>
                    <button
                      onClick={() => setConfirmingPush(null)}
                      className="px-2 py-1 rounded text-text-muted hover:text-text transition-colors"
                    >
                      {t('common.cancel', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmingPush(account.id)}
                      disabled={pushing !== null || rejecting !== null}
                      className="flex-1 btn-primary-sm"
                    >
                      {t('push.approveAndPush', 'Approve & Push')}
                    </button>
                    <button
                      onClick={() => handleReject(account.id)}
                      disabled={pushing !== null || rejecting !== null}
                      className="text-xs px-3 py-1.5 rounded font-medium border border-border text-text-muted hover:text-red hover:border-red/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {rejecting === account.id ? '...' : t('push.reject', 'Reject')}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Last push result feedback */}
            {lastResult && (
              <div className="space-y-1 pt-2 border-t border-border">
                <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{t('push.lastPush', 'Last push')}</div>
                <div className="text-xs text-text">
                  {lastResult.data.submitted.length > 0 && (
                    <span className="text-green">{t('push.submitted', '{{count}} submitted', { count: lastResult.data.submitted.length })}</span>
                  )}
                  {lastResult.data.rejected.length > 0 && (
                    <>
                      {lastResult.data.submitted.length > 0 && ', '}
                      <span className="text-red">{t('push.rejected', '{{count}} rejected', { count: lastResult.data.rejected.length })}</span>
                    </>
                  )}
                </div>
                {lastResult.data.rejected.map((r, i) => (
                  <div key={i} className="text-xs text-red/80 px-2">{r.error || t('common.unknownError', 'Unknown error')}</div>
                ))}
                <button onClick={() => setLastResult(null)} className="text-[11px] text-text-muted hover:text-text">
                  {t('common.dismiss', 'Dismiss')}
                </button>
              </div>
            )}

            {error && (
              <div className="text-xs text-red pt-2 border-t border-border">
                {error}
                <button onClick={() => setError(null)} className="ml-2 text-text-muted hover:text-text">{t('common.dismiss', 'Dismiss')}</button>
              </div>
            )}
          </div>
        ) : !hasStaged ? (
          <div className="px-3 py-4 text-xs text-text-muted text-center">
            {t('push.noPendingOperations', 'No pending operations')}
          </div>
        ) : null}

        {/* ==================== History Section ==================== */}
        {hasHistory && (
          <div className="border-t border-border">
            <div className="px-3 py-2">
              <div className="text-[11px] text-text-muted font-medium uppercase tracking-wider">{t('push.history', 'History')}</div>
            </div>
            <div className="px-3 pb-3 space-y-3">
              {history.map(({ accountId, label, commits }) => (
                <div key={accountId} className="space-y-1">
                  {history.length > 1 && (
                    <div className="text-[10px] text-text-muted/60 font-medium uppercase tracking-wider">{label}</div>
                  )}
                  {commits.map((commit) => (
                    <div key={commit.hash} className="group px-2 py-1.5 rounded hover:bg-bg-secondary/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-text-muted/50">{commit.hash}</span>
                        <span className="text-[10px] text-text-muted/40">{timeAgo(commit.timestamp)}</span>
                      </div>
                      <div className="text-xs text-text mt-0.5 leading-snug">{commit.message}</div>
                      {commit.operations.length > 0 && (
                        <div className="flex flex-wrap gap-x-2 mt-0.5">
                          {commit.operations.map((op, i) => (
                            <span key={i} className={`text-[10px] ${statusColor(op.status)}`}>
                              {op.symbol !== 'unknown' ? op.symbol : op.action} · {op.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
