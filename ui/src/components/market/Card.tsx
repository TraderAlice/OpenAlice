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
    <section className={`oa-data-surface flex flex-col overflow-hidden rounded-2xl ${className ?? ''}`}>
      <header className={`oa-data-surface-header flex min-h-14 flex-wrap gap-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 ${headerClassName ?? 'items-center justify-between'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="text-lg leading-6 font-semibold text-foreground break-words">{title}</h3>
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
        {right && <div className="min-w-0 max-w-full">{right}</div>}
      </header>
      <div className={contentClassName ?? 'min-w-0 px-4 pb-4 sm:px-6 sm:pb-6'}>{children}</div>
    </section>
  )
}
