import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { cn } from '../../lib/utils'

export const Collapsible = CollapsiblePrimitive.Root
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger

export function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel className={cn('oa-collapsible-panel', className)} {...props} />
}
