import { AIProviderIcon } from '../lib/aiProviderIcon'
import { modelDisplayName, modelManufacturer } from '../lib/modelIdentity'
import { cn } from '../lib/utils'

export function ModelIdentity({ model, label, vendor, className, truncate = false }: {
  model: string
  label?: string | null
  vendor?: string | null
  className?: string
  truncate?: boolean
}) {
  return <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={model}>
    <AIProviderIcon vendor={modelManufacturer(model, vendor)} className="size-4 shrink-0" />
    <span className={cn('min-w-0', truncate ? 'truncate' : '[overflow-wrap:anywhere]')}>{modelDisplayName(model, label)}</span>
  </span>
}
