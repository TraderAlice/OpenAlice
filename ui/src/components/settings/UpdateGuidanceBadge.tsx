import { useTranslation } from 'react-i18next'

export function UpdateGuidanceBadge({ count, setupCount = 0, tone = 'available' }: { count: number; setupCount?: number; tone?: 'available' | 'attention' }) {
  const { t } = useTranslation()
  const total = count + setupCount
  if (total < 1) return null
  return <span
    aria-label={[count > 0 ? t(tone === 'available' ? 'nav.updatesAvailable' : 'nav.updatesNeedAttention', { count }) : '', setupCount > 0 ? t('projectSetup.title') : ''].filter(Boolean).join('; ')}
    className={`inline-flex min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none ${tone === 'available' ? 'bg-primary/15 text-primary' : 'bg-warning/15 text-warning'}`}
  >{total > 99 ? '99+' : total}</span>
}
