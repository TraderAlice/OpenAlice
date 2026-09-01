import type { ReferenceMeta } from '../../api/reference'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The one meta line for board headers — single source word, not a badge
 * parade. Grammar:
 *
 *   hub-served  → "hub"
 *   local build → "<provider>"
 *   stale       → amber status chip
 *
 * Full provenance is available from the shared Tooltip.
 */
export function BoardMeta({ meta, extra }: { meta: ReferenceMeta; extra?: string }) {
  const sourceWord = meta.origin === 'hub' ? 'hub' : meta.provider
  const detail = [
    `upstream: ${meta.provider}`,
    meta.origin ? `served by: ${meta.origin}` : null,
    meta.asOf ? `asOf: ${meta.asOf}` : null,
    meta.cachedAt ? `cached: ${meta.cachedAt}` : null,
  ].filter(Boolean).join(', ')
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={detail}
            className="inline-flex items-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          />
        }
      >
        {extra && <>{extra}, </>}
        {sourceWord}
        {meta.stale && (
          <span className="ml-1.5 rounded-md bg-warning/15 px-1 py-px text-[9px] font-medium text-warning">
            Stale
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  )
}
