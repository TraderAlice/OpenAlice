import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'

export function DemoBanner(): ReactElement {
  const { t } = useTranslation()

  return (
    <div className="oa-demo-banner flex min-h-9 items-center gap-2 border-b px-2 py-1 text-[12px] leading-[18px] text-foreground sm:gap-3 sm:px-3">
      <span className="inline-flex h-6 shrink-0 items-center px-1 text-[11px] leading-[15px] font-medium text-warning">
        {t('demoBanner.badge')}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-medium text-muted-foreground sm:hidden"
        aria-label={t('demoBanner.description')}
      >
        {t('demoBanner.compact')}
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">
        {t('demoBanner.description')}
      </span>
      <a
        href="https://github.com/TraderAlice/OpenAlice"
        target="_blank"
        rel="noopener noreferrer"
        className="oa-demo-install oa-pressable inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] leading-[15px] font-medium text-foreground"
      >
        <span>{t('demoBanner.install')}</span>
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      </a>
    </div>
  )
}
