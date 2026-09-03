import { useState } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import type { BrokerEngine, BrokerHealthInfo } from '../../api/types'
import type { AccountPackReadiness } from '../../hooks/useBrokerPackReadiness'
import { HealthBadge } from './HealthBadge'
import { Button } from '../ui/button'

export function AccountReadinessBadge({ readiness, health, size = 'sm' }: {
  readiness: AccountPackReadiness
  health?: BrokerHealthInfo
  size?: 'sm' | 'md'
}) {
  if (!readiness.configuredEnabled) {
    return <span className="text-[11px] text-muted-foreground">Disabled in config</span>
  }
  if (readiness.operational) return <HealthBadge health={health} size={size} />

  const label = readiness.state === 'checking'
    ? 'Checking support…'
    : readiness.state === 'needs-repair'
      ? 'Support needs repair'
      : readiness.state === 'needs-install'
        ? 'Support not installed'
        : readiness.state === 'unsupported-preset'
          ? 'Unsupported preset'
          : 'Support status unavailable'
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] leading-[15px] text-warning"
      title={readiness.reason}
      data-testid="account-readiness-badge"
    >
      {readiness.state === 'checking'
        ? <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
        : <AlertTriangle aria-hidden className="size-3 shrink-0" />}
      {label}
    </span>
  )
}

export function BrokerSupportGate({ readiness, installingEngine, onInstall, onRetry, compact = false }: {
  readiness: AccountPackReadiness
  installingEngine?: BrokerEngine | null
  onInstall?: (engine: Exclude<BrokerEngine, 'mock'>) => Promise<void>
  onRetry: () => Promise<void>
  compact?: boolean
}) {
  const [actionError, setActionError] = useState<string | null>(null)
  if (readiness.operational) return null

  const installable = readiness.engine && readiness.engine !== 'mock' && onInstall
  const isInstalling = installingEngine === readiness.engine
  const actionLabel = readiness.state === 'needs-repair' ? 'Repair' : 'Install'
  const title = readiness.state === 'checking'
    ? 'Checking broker support'
    : readiness.state === 'needs-repair'
      ? 'Broker support needs repair'
      : readiness.state === 'needs-install'
        ? 'Broker support is not installed'
        : readiness.state === 'unsupported-preset'
          ? 'This broker preset is no longer supported'
          : 'Broker support status is unavailable'

  return (
    <div
      className={`rounded-lg border border-warning/30 bg-warning/5 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}
      role="status"
      data-testid="broker-support-gate"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          {!compact && <div className="text-[12px] font-medium text-foreground">{title}</div>}
          <p className={`${compact ? '' : 'mt-0.5'} text-[11px] leading-relaxed text-muted-foreground`}>
            {readiness.reason ?? (
              readiness.state === 'checking'
                ? 'Reading support installed on this Runtime.'
                : 'This Runtime can load the configured account after its machine-local Broker Pack is available.'
            )}
          </p>
          {!compact && !readiness.operational && readiness.state !== 'checking' && (
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
              Installation changes this Runtime. Broker connections and trading remain unchanged.
            </p>
          )}
          {actionError && <p className="mt-1 text-[11px] text-destructive" role="alert">{actionError}</p>}
        </div>
        {installable && (readiness.state === 'needs-install' || readiness.state === 'needs-repair') ? (
          <Button
            type="button"
            className="shrink-0"
            variant="outline"
            size="sm"
            disabled={Boolean(installingEngine)}
            onClick={() => {
              setActionError(null)
              void onInstall(readiness.engine as Exclude<BrokerEngine, 'mock'>).catch((err: unknown) => {
                setActionError(err instanceof Error ? err.message : String(err))
              })
            }}
          >
            {isInstalling ? (actionLabel === 'Repair' ? 'Repairing…' : 'Installing…') : actionLabel}
          </Button>
        ) : readiness.state !== 'checking' ? (
          <Button
            type="button"
            className="shrink-0"
            variant="outline"
            size="sm"
            onClick={() => {
              setActionError(null)
              void onRetry().catch((err: unknown) => {
                setActionError(err instanceof Error ? err.message : String(err))
              })
            }}
          >
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  )
}
