import { AIProviderIcon } from '../lib/aiProviderIcon'
import { modelDisplayName, modelManufacturer } from '../lib/modelIdentity'
import { cn } from '../lib/utils'
import { MeasuredText } from './MeasuredText'

export function ModelIdentity({ model, label, vendor, className }: {
  model: string
  label?: string | null
  vendor?: string | null
  className?: string
}) {
  return <span className={cn('inline-flex min-w-0 items-center gap-2', className)} title={model}>
    <AIProviderIcon vendor={modelManufacturer(model, vendor)} className="size-4 shrink-0" />
    <MeasuredText className="min-w-0 [overflow-wrap:anywhere]">{modelDisplayName(model, label)}</MeasuredText>
  </span>
}
