import { Fragment, useRef, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface SidebarActionMenuItem {
  label: string
  ariaLabel?: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

export function SidebarActionMenu({
  label,
  items,
}: {
  label: string
  items: readonly SidebarActionMenuItem[]
}) {
  const pendingActionRef = useRef<(() => void) | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  return (
    <DropdownMenu
      onOpenChangeComplete={(open) => {
        if (open) return
        const action = pendingActionRef.current
        pendingActionRef.current = null
        if (!action) return
        triggerRef.current?.focus()
        action()
      }}
    >
      <DropdownMenuTrigger
        render={<button
          ref={triggerRef}
          type="button"
          className="oa-icon-action oa-workspace-row-action flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={label}
        />}
      >
          <Ellipsis size={14} strokeWidth={2.2} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        aria-label={label}
        className="z-30 w-auto min-w-[184px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-border/70 bg-popover p-1 shadow-md ring-0"
      >
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {item.danger && index > 0 ? <DropdownMenuSeparator className="my-1" /> : null}
            <DropdownMenuItem
              aria-label={item.ariaLabel}
              disabled={item.disabled}
              variant={item.danger ? 'destructive' : 'default'}
              className="flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-4 transition-colors focus:bg-accent"
              onClick={() => {
                if (item.disabled) return
                // Base UI restores focus to the trigger as the menu finishes
                // closing. Run follow-up dialogs after that handoff so they
                // capture a durable return target.
                pendingActionRef.current = item.onSelect
              }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
