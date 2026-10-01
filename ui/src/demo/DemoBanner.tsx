import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { ContextHelp } from '../components/ContextHelp'
import { buttonVariants } from '../components/ui/button'

export function DemoBanner(): ReactElement {
  const { t } = useTranslation()

  return (
    <div data-desktop-banner className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-secondary px-4 py-1 text-sm">
      <div className="flex min-w-0 items-center gap-1">
        <span className="font-semibold">{t('demoBanner.badge')}</span>
        <ContextHelp label={t('demoBanner.badge')}>{t('demoBanner.description')}</ContextHelp>
      </div>
      <a
        href="https://github.com/TraderAlice/OpenAlice"
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {t('demoBanner.install')}
        <ArrowUpRight aria-hidden className="size-4" />
      </a>
    </div>
  )
}
