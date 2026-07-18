import type { BrokerHealthInfo } from '../../api/types'

/** Connection-status pill for a UTA. Two sizes: 'sm' (cards) / 'md' (dialog headers).
 *  Health is a capability ladder — the label reflects both the connection status
 *  AND what the account is for (a keyless data source reads "Data source", a
 *  read-only account says so), so a data UTA never looks like a broken trader. */
export function HealthBadge({ health, size = 'sm' }: { health?: BrokerHealthInfo; size?: 'sm' | 'md' }) {
  const textSize = size === 'md' ? 'text-[12px]' : 'text-[11px]'
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5'

  if (!health) return <span className="text-text-muted/40">—</span>

  const pill = (color: string, dot: string, label: string, title?: string, pulse = false) => (
    <span className={`inline-flex items-center gap-1.5 ${textSize} ${color}`} title={title}>
      <span className={`${dotSize} rounded-full ${dot} shrink-0 ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )

  if (health.disabled) return pill('text-text-muted', 'bg-text-muted/40', 'Disabled', health.lastError)

  // Initial broker connect still in flight. `status` is optimistically 'healthy'
  // during this window, so this must be checked BEFORE the switch — otherwise a
  // cold-starting account misleadingly reads "Connected" while its data is still
  // loading. Pulses to signal work-in-progress, not a steady state.
  if (health.connecting) return pill('text-accent', 'bg-accent', 'Connecting...', health.lastError, true)

  switch (health.status) {
    case 'healthy':
      // At target reach. The label tells the user the account's role.
      return pill(
        'text-[var(--oa-status-success)]',
        'bg-[var(--oa-status-success)]',
        health.tier === 'data' ? 'Data source' : health.tier === 'account' ? 'Connected · read-only' : 'Connected',
      )
    case 'degraded':
      // Reachable but below target — e.g. transport up but account-read failing.
      return pill(
        'text-[var(--oa-status-warning)]',
        'bg-[var(--oa-status-warning)]',
        health.reach === 'connected' ? 'No account access' : 'Unstable',
        health.lastError,
      )
    case 'offline':
      return pill('text-[var(--oa-status-danger)]', 'bg-[var(--oa-status-danger)]', health.recovering ? 'Reconnecting...' : 'Offline', health.lastError, true)
  }
}
