import { Layers, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
      <SidebarChildRow active={false}>
        <SidebarChildRowButton onClick={onOpen} title={t('harnessNavigation.selectHint')}
          icon={<Layers className="size-4" strokeWidth={1.5} />}>
          <span className="min-w-0 flex-1 truncate">{t('harnessNavigation.selectAction')}</span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </SidebarChildRowButton>
      </SidebarChildRow>
    )
  }
  return (
    <SidebarChildRow active={active} className="oa-harness-studio-entry">
      <SidebarChildRowButton onClick={onOpen} aria-current={active ? 'page' : undefined}
        icon={<Layers className="size-4 text-muted-foreground" strokeWidth={1.5} />}>
        <span className="min-w-0 flex-1 truncate">{t('harnessSurface.studio')}</span>
        <ArrowRight className="oa-studio-arrow size-4 text-muted-foreground" aria-hidden />
      </SidebarChildRowButton>
    </SidebarChildRow>
  )
}
