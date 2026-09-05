import { AppWindow, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'

/** Workspace tools, visually distinct from the recent conversation rows. */
export function HarnessWorkspaceEntry({ state, active, onOpen }: {
  state: 'ready' | 'select'
  active: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  if (state !== 'ready') {
    return (
      <div className="px-2 pb-1 pt-1">
        <p className="text-[12px] leading-[18px] text-muted-foreground">
          {t('harnessNavigation.selectHint')}
        </p>
        <Button variant="ghost" onClick={onOpen}
          className="mt-1 h-auto min-h-10 max-w-full justify-start gap-2 px-0 text-left text-[13px] font-medium whitespace-normal hover:bg-transparent hover:text-primary md:min-h-8">
          <span>{t('harnessNavigation.selectAction')}</span>
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    )
  }
  return (
    <div className="px-2 pb-1 pt-1">
      <Button variant="outline" onClick={onOpen} aria-current={active ? 'page' : undefined}
        className={`h-auto min-h-10 w-full justify-start gap-2 px-2.5 text-[13px] font-normal whitespace-normal shadow-none md:min-h-8 ${active
          ? 'border-primary/35 bg-sidebar-accent text-sidebar-accent-foreground dark:border-primary/35 dark:bg-sidebar-accent'
          : 'border-sidebar-border/70 bg-transparent text-sidebar-foreground/85 dark:border-sidebar-border/70 dark:bg-transparent'}`}>
        <AppWindow className="size-3.5" aria-hidden />
        <span className="min-w-0 flex-1 text-left">{t('harnessNavigation.openStudio')}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
      </Button>
    </div>
  )
}
