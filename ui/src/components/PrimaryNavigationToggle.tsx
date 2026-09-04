import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useCallback, useRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** Only transfer focus after activating the control, not on route/viewport
 * changes. The next mounted copy may live in a page header portal. */
export function useNavigationToggleFocus() {
  const pending = useRef(false)
  const ref = useCallback((button: HTMLButtonElement | null) => {
    if (button && pending.current) {
      pending.current = false
      button.focus({ preventScroll: true })
    }
  }, [])
  return { ref, requestFocus: () => { pending.current = true } }
}

export function PrimaryNavigationToggle({ collapsed, onToggle, ref }: {
  collapsed: boolean
  onToggle: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  const label = t(collapsed ? 'nav.expandRail' : 'nav.collapseRail')
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button ref={ref} variant="ghost" size="icon-sm" onClick={onToggle}
          aria-label={label} aria-expanded={!collapsed} aria-controls="activity-bar"
          className="shrink-0 cursor-pointer text-muted-foreground aria-expanded:not-hover:bg-transparent aria-expanded:not-hover:text-muted-foreground" />
      }>
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
