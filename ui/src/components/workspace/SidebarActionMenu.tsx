import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface SidebarActionMenuItem {
  label: string
  ariaLabel?: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
}

export function SidebarActionMenu({
  label,
  items,
}: {
  label: string
  items: readonly SidebarActionMenuItem[]
}) {
  const [open, setOpen] = useState(false)
  const focusLastOnOpenRef = useRef(false)
  const setMenuRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    queueMicrotask(() => {
      const menuItems = node.querySelectorAll<HTMLElement>('[role="menuitem"]')
      const index = focusLastOnOpenRef.current ? menuItems.length - 1 : 0
      focusLastOnOpenRef.current = false
      menuItems.item(index)?.focus({ preventScroll: true })
    })
  }, [])

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="oa-icon-action oa-workspace-row-action flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp') return
            event.preventDefault()
            focusLastOnOpenRef.current = true
            setOpen(true)
          }}
        >
          <Ellipsis size={14} strokeWidth={2.2} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={setMenuRef}
        loop
        align="end"
        sideOffset={4}
        aria-label={label}
        className="z-30 w-[220px] max-w-[calc(100vw-2rem)] rounded-lg border border-border/70 bg-secondary py-1 shadow-lg ring-0"
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            aria-label={item.ariaLabel}
            variant={item.danger ? 'destructive' : 'default'}
            className="flex min-h-9 w-full cursor-default items-center gap-2 rounded-none px-3 py-2 text-left text-[12px] transition-colors focus:bg-muted"
            onSelect={item.onSelect}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
