import type { ReferenceMeta } from '../../api/reference'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TriangleAlert } from 'lucide-react'

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
            className="inline-flex items-center rounded-sm text-muted-foreground outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
          />
        }
      >
        {extra && <>{extra}, </>}
        {sourceWord}
        {meta.stale && (
          <span className="ml-1.5 inline-flex items-center gap-1 text-warning">
            <TriangleAlert aria-hidden className="size-3" />
            <span>Stale</span>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  )
}
