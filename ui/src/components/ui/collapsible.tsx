import { useState } from 'react'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
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

export function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel className={cn('oa-collapsible-panel', className)} {...props} />
}
