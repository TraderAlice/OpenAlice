import type { ComponentProps, ReactNode } from 'react'

/** Shared geometry for Harness child destinations; actions are sibling controls. */
export function SidebarChildRow({ active, className = '', children, ...props }: ComponentProps<'div'> & { active: boolean }) {
  return <div {...props} data-active={active}
    className={`oa-sidebar-child-row text-sm group relative mx-1.5 flex min-h-(--oa-nav-height) items-center gap-1 rounded-md transition-colors ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/65'} ${className}`}>
    {children}
  </div>
}

export function SidebarChildRowButton({ icon, children, className = '', ...props }: ComponentProps<'button'> & { icon: ReactNode }) {
  return <button type="button" {...props}
    className={`oa-sidebar-child-row-main flex min-w-0 flex-1 min-h-(--oa-nav-height) self-stretch items-center gap-2 px-2.5 py-1.5 text-left outline-none disabled:cursor-default ${className}`}>
    <span className="flex size-4 shrink-0 items-center justify-center text-foreground/80" aria-hidden>{icon}</span>
    {children}
  </button>
}
