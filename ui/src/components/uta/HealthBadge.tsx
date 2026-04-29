import type { BrokerHealthInfo } from '../../api/types'

/** Connection-status pill for a UTA. Two sizes: 'sm' (cards) / 'md' (dialog headers). */
export function HealthBadge({ health, size = 'sm' }: { health?: BrokerHealthInfo; size?: 'sm' | 'md' }) {
  const textSize = size === 'md' ? 'text-[12px]' : 'text-[11px]'
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5'

  if (!health) return <span className="text-text-muted/40">—</span>

  if (health.disabled) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${textSize} text-text-muted`} title={health.lastError}>
        <span className={`${dotSize} rounded-full bg-text-muted/40 shrink-0`} />
        Disabled
      </span>
    )
  }

  switch (health.status) {
    case 'healthy':
      return (
        <span className={`inline-flex items-center gap-1.5 ${textSize} text-green`}>
          <span className={`${dotSize} rounded-full bg-green shrink-0`} />
          Connected
        </span>
      )
    case 'degraded':
      return (
        <span className={`inline-flex items-center gap-1.5 ${textSize} text-yellow-400`}>
          <span className={`${dotSize} rounded-full bg-yellow-400 shrink-0`} />
          Unstable
        </span>
      )
    case 'offline':
      return (
        <span className={`inline-flex items-center gap-1.5 ${textSize} text-red`} title={health.lastError}>
          <span className={`${dotSize} rounded-full bg-red shrink-0 animate-pulse`} />
          {health.recovering ? 'Reconnecting...' : 'Offline'}
        </span>
      )
  }
}
