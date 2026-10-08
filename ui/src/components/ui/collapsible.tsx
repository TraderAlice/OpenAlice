import { useState, type ComponentProps, type ReactNode } from 'react'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Collapsible({ onOpenChange, ...props }: CollapsiblePrimitive.Root.Props) {
  const [instant, setInstant] = useState(false)
  return (
    <CollapsiblePrimitive.Root
      {...props}
      data-slot="collapsible"
      data-instant={instant || undefined}
      onOpenChange={(open, details) => {
        const event = details.event
        setInstant(event.type.startsWith('key') || ('detail' in event && event.detail === 0))
        onOpenChange?.(open, details)
      }}
    />
  )
}

export const CollapsibleTrigger = CollapsiblePrimitive.Trigger

export function CollapsibleDetailsTrigger({ children, className, ...props }: Omit<CollapsiblePrimitive.Trigger.Props, 'render' | 'className' | 'children'> & { className?: string; children: ReactNode }) {
  return <CollapsiblePrimitive.Trigger {...props} className={cn('oa-disclosure-trigger', className)}>
    <span className="min-w-0 flex-1 break-words">{children}</span>
    <ChevronRight className="oa-disclosure-chevron" aria-hidden />
  </CollapsiblePrimitive.Trigger>
}

export function DetailsSummary({ children, className, ...props }: ComponentProps<'summary'>) {
  return <summary {...props} className={cn('oa-disclosure-trigger', className)}>
    <span className="min-w-0 flex-1 break-words">{children}</span>
    <ChevronRight className="oa-disclosure-chevron" aria-hidden />
  </summary>
}

export function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel className={cn('oa-collapsible-panel', className)} {...props} />
}
