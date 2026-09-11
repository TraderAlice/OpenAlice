import { type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  title: string
  /**
   * Supporting context surfaced next to the title through the shared Tooltip.
   */
  info?: string | null
  right?: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
}

/**
 * Panel shell used across the Market workbench.
 * Title + optional info hint + optional right slot + content. No
 * cross-panel smarts — each panel owns its own fetch and render.
 */
export function Card({ title, info, right, className, headerClassName, contentClassName, children }: Props) {
  return (
    <section className={`oa-data-surface flex flex-col overflow-hidden rounded-lg border ${className ?? ''}`}>
      <header className={`oa-data-surface-header flex min-h-9 gap-3 border-b px-3 py-2 ${headerClassName ?? 'items-center justify-between'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="text-[13px] leading-[18px] font-medium text-foreground truncate">{title}</h3>
          {info && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 shrink-0 text-muted-foreground"
                    aria-label={info}
                  />
                }
              >
                <Info aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-sm whitespace-pre-line">
                {info}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      <div className={contentClassName ?? 'p-3'}>{children}</div>
    </section>
  )
}
