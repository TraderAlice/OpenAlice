import { type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** One office in the primary navigation, not a tree of all Workspaces. */
export function HarnessNavigationGroup({ title, compact, compactIcon, active, newLabel, showNewAction = true, onOpen, menu, children }: {
  title: string
  compact: boolean
  compactIcon: ReactNode
  active: boolean
  newLabel: string
  showNewAction?: boolean
  onOpen: () => void
  menu: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const label = t('nav.harnessLabel', { name: title })
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger render={<button type="button" aria-label={label} aria-current={active ? 'page' : undefined} onClick={onOpen}
          className={`oa-nav-item flex h-8 w-8 items-center justify-center rounded-md ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60'}`} />}>
          {compactIcon}
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <section aria-label={label} className="min-w-0">
      <div className={`oa-harness-nav-header flex min-h-10 items-center rounded-md md:min-h-8 ${active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}>
        <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} onClick={onOpen}
          className={`oa-nav-item flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] leading-[18px] md:min-h-8 ${active ? 'text-foreground' : 'text-sidebar-foreground/75 hover:text-foreground'}`}>
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">{compactIcon}</span>
          <span className="truncate">{title}</span>
        </button>
        <div className="oa-harness-nav-actions flex shrink-0 items-center pr-1">
          {menu}
          {showNewAction && <button type="button" aria-label={`${title}: ${newLabel}`} title={newLabel} onClick={onOpen}
            className="oa-icon-action flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
            <Plus size={14} aria-hidden />
          </button>}
        </div>
      </div>
      <div className="ml-3 min-w-0 pb-2">{children}</div>
    </section>
  )
}
