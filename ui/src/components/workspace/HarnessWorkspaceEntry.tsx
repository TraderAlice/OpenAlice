import { Layers, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { SidebarChildRow, SidebarChildRowButton } from '../SidebarChildRow'

/** Shared Studio navigation for ready Harness workspaces. */
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
    <SidebarChildRow active={active} className="oa-harness-studio-entry">
      <SidebarChildRowButton onClick={onOpen} aria-current={active ? 'page' : undefined}
        icon={<Layers className="size-3.5 text-muted-foreground" strokeWidth={1.5} />}>
        <span className="min-w-0 flex-1 truncate">{t('harnessSurface.studio')}</span>
        <ArrowRight className="oa-studio-arrow size-3.5 text-muted-foreground" aria-hidden />
      </SidebarChildRowButton>
    </SidebarChildRow>
  )
}
