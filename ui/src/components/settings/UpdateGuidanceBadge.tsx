import { useTranslation } from 'react-i18next'
import { CountBadge } from '../CountBadge'

export function UpdateGuidanceBadge({ count, setupCount = 0, tone = 'available' }: { count: number; setupCount?: number; tone?: 'available' | 'attention' }) {
  const { t } = useTranslation()
  const total = count + setupCount
  if (total < 1) return null
  return <CountBadge
    count={total}
    limit={99}
    tone={tone === 'attention' ? 'attention' : 'info'}
    label={[count > 0 ? t(tone === 'available' ? 'nav.updatesAvailable' : 'nav.updatesNeedAttention', { count }) : '', setupCount > 0 ? t('projectSetup.title') : ''].filter(Boolean).join('; ')}
  />
}
