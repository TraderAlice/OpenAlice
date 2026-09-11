import { CircleCheck, CircleMinus, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { BrokerHealthInfo } from '../../api/types'

/** Connection-status pill for a UTA. Two sizes: 'sm' (cards) / 'md' (dialog headers).
 *  Health is a capability ladder — the label reflects both the connection status
 *  AND what the account is for (a keyless data source reads "Data source", a
 *  read-only account says so), so a data UTA never looks like a broken trader. */
export function HealthBadge({ health, size = 'sm' }: { health?: BrokerHealthInfo; size?: 'sm' | 'md' }) {
  const textSize = size === 'md' ? 'text-[12px]' : 'text-[11px]'
  const iconSize = size === 'md' ? 'size-3.5' : 'size-3'

  if (!health) return <span className="text-muted-foreground/40">—</span>

  const status = (color: string, Icon: LucideIcon, label: string, title?: string, spin = false) => (
    <span className={`inline-flex items-center gap-1.5 ${textSize} ${color}`} title={title}>
      <Icon aria-hidden className={`${iconSize} shrink-0 ${spin ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      {label}
    </span>
  )

  if (health.disabled) return status('text-muted-foreground', CircleMinus, 'Disabled', health.lastError)

  // Initial broker connect still in flight. `status` is optimistically 'healthy'
  // during this window, so this must be checked BEFORE the switch — otherwise a
  // cold-starting account misleadingly reads "Connected" while its data is still
  // loading. Pulses to signal work-in-progress, not a steady state.
  if (health.connecting) return status('text-primary', LoaderCircle, 'Connecting…', health.lastError, true)

  switch (health.status) {
    case 'healthy':
      // At target reach. The label tells the user the account's role.
      return status(
        'text-success',
        CircleCheck,
        health.tier === 'data' ? 'Data source' : health.tier === 'account' ? 'Connected, read-only' : 'Connected',
      )
    case 'degraded':
      // Reachable but below target — e.g. transport up but account-read failing.
      return status(
        'text-warning',
        TriangleAlert,
        health.reach === 'connected' ? 'No account access' : 'Unstable',
        health.lastError,
      )
    case 'offline':
      return status('text-destructive', health.recovering ? LoaderCircle : CircleX, health.recovering ? 'Reconnecting…' : 'Offline', health.lastError, health.recovering)
  }
}
