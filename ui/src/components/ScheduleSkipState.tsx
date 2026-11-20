import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { Clock, Pause } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ScheduleSkipState } from '../api/schedule'
import { formatRelativeTime } from '../lib/intl'

const LOCALE_BCP47: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  'zh-Hant': 'zh-Hant',
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()

function resolveBcp47(language: string | undefined): string {
  if (!language) return 'en-US'
  if (LOCALE_BCP47[language]) return LOCALE_BCP47[language]
  if (language.startsWith('zh-TW') || language.startsWith('zh-HK') || language.startsWith('zh-Hant')) {
    return 'zh-Hant'
  }
  if (language.startsWith('zh')) return 'zh-CN'
  if (language.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

function getRtf(locale: string, numeric: 'always' | 'auto'): Intl.RelativeTimeFormat {
  const key = `${locale}|narrow|${numeric}`
  let fmt = rtfCache.get(key)
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric })
    rtfCache.set(key, fmt)
  }
  return fmt
}

/**
 * Format a future `retryAtMs` timestamp into a narrow locale-aware phrase
 * (e.g. "in 5m", "5分钟后", "5分後") using ceiling rounding so exact boundaries
 * like `now + 5 * 60_000` never drift down to "in 4m" across render ticks.
 */
export function formatFutureRetryTime(
  retryAtMs: number | undefined,
  nowMs: number,
  language?: string,
): string | null {
  if (retryAtMs == null || !Number.isFinite(retryAtMs)) return null
  const diffMs = retryAtMs - nowMs
  if (diffMs <= 0) return null

  const locale = resolveBcp47(language)
  const fmt = getRtf(locale, 'always')

  if (diffMs < 60_000) {
    const seconds = Math.max(1, Math.ceil(diffMs / 1_000))
    if (seconds >= 60) return fmt.format(1, 'minute')
    return fmt.format(seconds, 'second')
  }
  if (diffMs < 3_600_000) {
    const minutes = Math.ceil(diffMs / 60_000)
    if (minutes >= 60) return fmt.format(1, 'hour')
    return fmt.format(minutes, 'minute')
  }
  if (diffMs < 86_400_000) {
    const hours = Math.ceil(diffMs / 3_600_000)
    if (hours >= 24) return fmt.format(1, 'day')
    return fmt.format(hours, 'hour')
  }
  const days = Math.ceil(diffMs / 86_400_000)
  return fmt.format(days, 'day')
}

function formatPastSinceTime(sinceMs: number, nowMs: number, language?: string): string {
  const locale = resolveBcp47(language)
  const elapsedMs = Math.max(0, nowMs - sinceMs)
  if (elapsedMs < 5_000) {
    return getRtf(locale, 'auto').format(0, 'second')
  }
  const fmt = getRtf(locale, 'always')
  if (elapsedMs >= 86_400_000) return fmt.format(-Math.floor(elapsedMs / 86_400_000), 'day')
  if (elapsedMs >= 3_600_000) return fmt.format(-Math.floor(elapsedMs / 3_600_000), 'hour')
  if (elapsedMs >= 60_000) return fmt.format(-Math.floor(elapsedMs / 60_000), 'minute')
  return fmt.format(-Math.max(1, Math.floor(elapsedMs / 1_000)), 'second')
}

function exactWallTime(epochMs: number | undefined): string | undefined {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) return undefined
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epochMs))
}

function deferredStatusLabel(code: string, t: TFunction): string {
  return code === 'session_blocked'
    ? t('issues.skipState.coolingDown')
    : t('issues.skipState.backingOff')
}

export function parkedRecoveryHint(code: string, t: TFunction): string {
  switch (code) {
    case 'session_blocked':
      return t('issues.skipState.hintSessionBlocked')
    case 'retired':
    case 'deleted':
    case 'not_found':
    case 'wrong_workspace':
    case 'wrong_agent':
    case 'missing_session':
    case 'unbound_session':
    case 'claim_persistence_unsupported':
      return t('issues.skipState.hintSessionUnavailable')
    case 'no_headless':
    case 'adapter_no_headless':
    case 'invalid_runtime':
    case 'invalid_runtime_settings':
    case 'runtime_unavailable':
    case 'background_unsupported':
    case 'adapter_missing':
      return t('issues.skipState.hintRuntimeUnavailable')
    case 'workspace_unavailable':
    case 'assignee_workspace_unavailable':
    case 'workspace_inactive':
    case 'workspace_not_active':
    case 'no_agent_owner':
    case 'ownership_changed':
      return t('issues.skipState.hintWorkspaceUnavailable')
    default:
      return t('issues.skipState.hintParkedDefault')
  }
}

function useLiveNow(active: boolean, overrideNowMs?: number): number {
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || overrideNowMs !== undefined) return
    setTickNow(Date.now())
    const id = setInterval(() => setTickNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [active, overrideNowMs])
  return overrideNowMs ?? tickNow
}

export function formatScheduleNextRunLabel(
  nextDueAtMs: number | null | undefined,
  skipState: ScheduleSkipState | undefined,
  t: TFunction,
  language?: string,
  nowMs: number = Date.now(),
): string {
  if (skipState?.kind === 'parked') {
    return t('issues.skipState.paused')
  }
  if (skipState?.kind === 'deferred' && skipState.retryAtMs != null) {
    const effectiveMs = Math.max(nextDueAtMs ?? 0, skipState.retryAtMs)
    const retryLabel = formatFutureRetryTime(effectiveMs, nowMs, language)
    if (retryLabel) return retryLabel
  }
  return nextDueAtMs ? formatRelativeTime(nextDueAtMs) : '—'
}

/**
 * Compact single-line status pill for dense list rows (`IssuesBoard`).
 * Keeps row height stable on narrow split-panes while exposing the full
 * human-readable skip reason to screen readers and hover tooltips.
 */
export function ScheduleSkipPill({
  skipState,
  nowMs: overrideNowMs,
}: {
  skipState: ScheduleSkipState
  nowMs?: number
}) {
  const { t, i18n } = useTranslation()
  const hasFutureRetry = skipState.kind === 'deferred' && skipState.retryAtMs != null
  const nowMs = useLiveNow(hasFutureRetry, overrideNowMs)
  const reason = skipState.reason.trim()

  if (skipState.kind === 'parked') {
    const status = t('issues.skipState.paused')
    const accessibleLabel = reason
      ? t('issues.skipState.ariaLabel', { status, reason })
      : status
    return (
      <span
        data-testid="schedule-skip-pill"
        data-skip-kind="parked"
        title={accessibleLabel}
        aria-label={accessibleLabel}
        className="inline-flex max-w-36 shrink-0 items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive @sm/content:max-w-44"
      >
        <Pause size={10} className="shrink-0" aria-hidden />
        <span className="truncate">{status}</span>
      </span>
    )
  }

  const futureRetry = formatFutureRetryTime(skipState.retryAtMs, nowMs, i18n.language)
  const status = futureRetry
    ? t('issues.skipState.retryingAt', { time: futureRetry })
    : deferredStatusLabel(skipState.code, t)
  const accessibleLabel = reason
    ? t('issues.skipState.ariaLabel', { status, reason })
    : status

  return (
    <span
      data-testid="schedule-skip-pill"
      data-skip-kind="deferred"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      className="inline-flex max-w-36 shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning @sm/content:max-w-44"
    >
      <Clock size={10} className="shrink-0" aria-hidden />
      <span className="truncate tabular-nums">{status}</span>
    </span>
  )
}

/**
 * Inspector callout for `IssueDetail` Schedule section (`16rem` rail + stacked
 * narrow panes). Surfaces the pill badge, countdown / streak start, exact
 * dispatch failure reason, and actionable recovery guidance when parked.
 */
export function ScheduleSkipStateNotice({
  skipState,
  nowMs: overrideNowMs,
}: {
  skipState: ScheduleSkipState
  nowMs?: number
}) {
  const { t, i18n } = useTranslation()
  const nowMs = useLiveNow(skipState.kind === 'deferred', overrideNowMs)
  const reason = skipState.reason.trim()

  if (skipState.kind === 'parked') {
    const status = t('issues.skipState.paused')
    const hasSince = Number.isFinite(skipState.sinceMs) && skipState.sinceMs > 0
    const sinceLabel = hasSince
      ? t('issues.skipState.sinceRelative', {
          time: formatPastSinceTime(skipState.sinceMs, nowMs, i18n.language),
        })
      : null

    return (
      <div
        data-testid="schedule-skip-notice"
        data-skip-kind="parked"
        role="status"
        className="mt-3 min-w-0 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
            <Pause size={10} className="shrink-0" aria-hidden />
            {status}
          </span>
          {sinceLabel && (
            <span
              title={exactWallTime(skipState.sinceMs)}
              className="tabular-nums text-[11px] text-muted-foreground"
            >
              {sinceLabel}
            </span>
          )}
        </div>
        {reason && (
          <p className="mt-1.5 break-words text-xs font-medium leading-relaxed text-foreground">
            {reason}
          </p>
        )}
        <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
          {parkedRecoveryHint(skipState.code, t)}
        </p>
      </div>
    )
  }

  const badgeLabel = deferredStatusLabel(skipState.code, t)
  const futureRetry = formatFutureRetryTime(skipState.retryAtMs, nowMs, i18n.language)
  const retryText = futureRetry
    ? t('issues.skipState.retryingAt', { time: futureRetry })
    : t('issues.skipState.retryingSoon')

  return (
    <div
      data-testid="schedule-skip-notice"
      data-skip-kind="deferred"
      role="status"
      className="mt-3 min-w-0 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2.5 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
          <Clock size={10} className="shrink-0" aria-hidden />
          {badgeLabel}
        </span>
        <span
          title={exactWallTime(skipState.retryAtMs)}
          className="tabular-nums text-[11px] font-medium text-warning"
        >
          {retryText}
        </span>
      </div>
      {reason && (
        <p className="mt-1.5 break-words text-xs leading-relaxed text-foreground/90">
          {reason}
        </p>
      )}
    </div>
  )
}
