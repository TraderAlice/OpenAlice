import * as React from 'react'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

function Tabs(props: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-secondary p-0.5 text-foreground', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-8 shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold leading-5 whitespace-nowrap outline-none transition-[color,background-color,scale] duration-[var(--motion-standard)] [transition-timing-function:var(--motion-ease-out)] motion-safe:active:not-focus-visible:scale-[0.97] active:duration-[var(--motion-fast)] not-data-active:hover:bg-muted focus-visible:[box-shadow:var(--oa-focus-shadow)] focus-visible:transition-none data-active:bg-foreground data-active:text-background [@media(pointer:coarse)]:min-h-11 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
